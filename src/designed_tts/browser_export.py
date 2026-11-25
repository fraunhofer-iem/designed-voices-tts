"""Split CPU graphs: validate predicted frame bounds before waveform allocations."""
from pathlib import Path
import json
import math
import numpy as np
import torch
from torch import nn
from .release import load_release,digest
from .kale_english_inference import shape_pitch
from .vendor.voca.onnx import Exportable
from .vendor.kale.onnx import HeadX,strip


class VocaPlan(nn.Module):
    def __init__(self,model):
        super().__init__();self.model=model
    def forward(self,tokens,stress,voice):
        m=self.model;mask=torch.ones_like(tokens,dtype=torch.bool)
        hidden=m.encoder(m.tokens(tokens)+m.stress(stress)+m.voices(voice)[:,None],mask)
        out=m.duration(hidden,mask)
        frames=torch.round(torch.exp(out[...,0].clamp(0,math.log1p(400)))-1).long().clamp_min(1)
        durations=torch.where(m.phone_tokens[tokens]|(out[...,1]>0),frames,torch.zeros_like(frames))
        return hidden,durations


class VocaWave(Exportable):
    def forward(self,tokens,voice,hidden,durations,noise):
        m=self.model;c=m.config
        pitch_range=torch.ones(1);pitch_shift=torch.zeros(1)
        # Repeat token states by duration.
        ends = durations.cumsum(1)
        total = ends[0, -1]
        frame = torch.arange(total, device=tokens.device)[None]
        index = (ends[:, None, :] <= frame[:, :, None]).sum(-1)
        owned = durations.gather(1, index).clamp_min(1)
        offset = frame - (ends.gather(1, index) - durations.gather(1, index))
        relative = (offset.to(hidden.dtype) + 0.5) / owned
        features = torch.stack((relative, 1 - relative, torch.log1p(owned.to(hidden.dtype)) / 4), dim=-1)
        expanded = hidden.gather(1, index[..., None].expand(-1, -1, hidden.shape[-1]))
        expanded = expanded + m.frame_position(features) + m.frame_voices(voice)[:, None]
        frame_mask = torch.ones_like(frame, dtype=torch.bool)
        # Pitch, voicing, energy.
        prosody_hidden = m.prosody_stack(expanded, frame_mask)
        prosody = m.prosody_head(prosody_hidden)
        vowel = m.vowel_tokens[tokens].gather(1, index)
        voicing = torch.where(vowel, prosody[..., 1].clamp_min(2.0), prosody[..., 1])
        voiced = (voicing > 0).to(prosody.dtype)
        mean = (prosody[..., 0] * voiced).sum(1, keepdim=True) / voiced.sum(1, keepdim=True).clamp_min(1)
        pitch = mean + (prosody[..., 0] - mean) * pitch_range
        condition = torch.stack((pitch.clamp(-2.0, 1.5), voiced, prosody[..., 2].clamp(-4.5, 3.0)), dim=-1)
        acoustic = m.acoustic_stack(prosody_hidden + m.prosody_projection(condition), frame_mask)
        f0 = (c.pitch_reference_hz * torch.exp(pitch + pitch_shift)).clamp(c.f0_min, c.f0_max)
        return self._vocoder(acoustic, f0, total, noise)



class KalePlan(nn.Module):
    def __init__(self,text,audio,vocab):
        super().__init__();self.text=text;self.audio=audio
        self.register_buffer("required",torch.tensor(vocab["required_ids"]))
        self.register_buffer("stress_ids",torch.tensor(vocab["stress_ids"]))
    def forward(self,tokens,voice):
        rt=self.text;p=rt.predictor;s=rt.pstyle[voice]
        d_en=rt.bert_encoder(rt.bert(tokens,attention_mask=torch.ones_like(tokens))).transpose(-1,-2)
        size=tokens.shape[1];sx=s[:,:,None].expand(-1,-1,size);x=torch.cat([d_en,sx],1)
        for block in p.text_encoder.lstms:
            if isinstance(block,nn.LSTM):x=block(x.transpose(-1,-2))[0].transpose(-1,-2)
            else:x=torch.cat([block(x.transpose(-1,-2),s).transpose(-1,-2),sx],1)
        d=x.transpose(-1,-2)
        n=p.duration_proj(p.lstm(d)[0]).sigmoid().sum(-1).round().long()
        required=(tokens[:,:,None]==self.required).any(-1)
        stress=(tokens[:,:,None]==self.stress_ids).any(-1)
        n=torch.where(stress,torch.zeros_like(n),torch.where(required,n.clamp_min(1),n.clamp_min(0)))
        e=self.audio.te;h=e.embedding(tokens).transpose(1,2)
        for conv in e.cnn:h=conv(h)
        encoded=e.lstm(h.transpose(1,2))[0].transpose(-1,-2)
        return d,s,encoded,n


class KaleWave(nn.Module):
    def __init__(self,text,audio):
        super().__init__();self.predictor=text.predictor;self.audio=audio;self.head=HeadX(audio.dec.head)
    def forward(self,hidden,style,encoded,alignment,voice,noise):
        f0,n=self.predictor.F0Ntrain(hidden.transpose(-1,-2)@alignment,style)
        f0=torch.where(f0>=25.,f0,torch.zeros_like(f0))
        trunk=self.audio.dec.trunk(encoded@alignment,f0,n,self.audio.style[voice])
        return self.head(trunk,f0,noise[:,:f0.shape[1]*300])


class KaleEnglishPlan(nn.Module):
    """Public English Nano: every token, stress marks and spaces included, gets at least one frame."""
    def __init__(self,text,audio):
        super().__init__();self.text=text;self.audio=audio
    def forward(self,tokens,voice):
        rt=self.text;p=rt.predictor;s=rt.pstyle[voice]
        d_en=rt.bert_encoder(rt.bert(tokens,attention_mask=torch.ones_like(tokens))).transpose(-1,-2)
        size=tokens.shape[1];sx=s[:,:,None].expand(-1,-1,size);x=torch.cat([d_en,sx],1)
        for block in p.text_encoder.lstms:
            if isinstance(block,nn.LSTM):x=block(x.transpose(-1,-2))[0].transpose(-1,-2)
            else:x=torch.cat([block(x.transpose(-1,-2),s).transpose(-1,-2),sx],1)
        d=x.transpose(-1,-2)
        n=p.duration_proj(p.lstm(d)[0]).sigmoid().sum(-1).round().long().clamp_min(1)
        e=self.audio.te;h=e.embedding(tokens).transpose(1,2)
        for conv in e.cnn:h=conv(h)
        encoded=e.lstm(h.transpose(1,2))[0].transpose(-1,-2)
        return d,s,encoded,n


class KaleEnglishWave(nn.Module):
    """Upstream's per-voice end clamp and unvoicing floor instead of the German 25 Hz midpoint."""
    def __init__(self,text,audio,values):
        super().__init__();self.predictor=text.predictor;self.audio=audio;self.head=HeadX(audio.dec.head)
        for name in ("pitch_floor","clamp_threshold","clamp_tail","unvoice"):self.register_buffer(name,values[name].clone())
    def forward(self,hidden,style,encoded,alignment,voice,noise):
        f0,n=self.predictor.F0Ntrain(hidden.transpose(-1,-2)@alignment,style)
        f0=shape_pitch(f0,*(getattr(self,name)[voice][:,None] for name in ("pitch_floor","clamp_threshold","clamp_tail","unvoice")))
        trunk=self.audio.dec.trunk(encoded@alignment,f0,n,self.audio.style[voice])
        return self.head(trunk,f0,noise[:,:f0.shape[1]*300])


def graph(model,args,path,inputs,outputs,axes):
    with torch.inference_mode():
        torch.onnx.export(model.eval(),args,str(path),input_names=inputs,output_names=outputs,
                          dynamic_axes=axes,opset_version=17,dynamo=False,do_constant_folding=True)


def export_release(release_dir,destination):
    r=load_release(release_dir,marking=False);out=Path(destination);out.mkdir(parents=True,exist_ok=False)
    family=r.metadata["family"];voice=torch.tensor([0]);seed=r.metadata["default_seed"]
    if family=="voca":
        m,=r.models;plan=VocaPlan(m);wave=VocaWave(m,True)
        tokens=torch.tensor([[1,31,76,2]]);stress=torch.zeros_like(tokens)
        with torch.inference_mode():hidden,durations=plan(tokens,stress,voice)
        frames=int(durations.sum());noise=torch.randn(1,frames*256,generator=torch.Generator().manual_seed(seed))
        graph(plan,(tokens,stress,voice),out/"plan.onnx",["tokens","stress","voice"],["hidden","durations"],
              {"tokens":{1:"tokens"},"stress":{1:"tokens"},"hidden":{1:"tokens"},"durations":{1:"tokens"}})
        graph(wave,(tokens,voice,hidden,durations,noise),out/"wave.onnx",["tokens","voice","hidden","durations","noise"],["audio"],
              {"tokens":{1:"tokens"},"hidden":{1:"tokens"},"durations":{1:"tokens"},"noise":{1:"samples"},"audio":{1:"samples"}})
        hop,max_frames=256,3000
    else:
        if family=="kale-en":
            text,audio,values=r.models;strip(text);strip(audio)
            plan=KaleEnglishPlan(text,audio);wave=KaleEnglishWave(text,audio,values)
            # Enough voiced frames for the end clamp to be traced on a real ending.
            tokens=torch.tensor([[0,50,156,86,54,31,4,0]])
        else:
            text,audio=r.models;strip(text);strip(audio)
            plan=KalePlan(text,audio,r.metadata["vocabulary"]);wave=KaleWave(text,audio)
            tokens=torch.tensor([[0,r.metadata["vocabulary"]["required_ids"][0],0]])
        with torch.inference_mode():hidden,style,encoded,durations=plan(tokens,voice)
        frames=int(durations.sum());alignment=torch.zeros(1,tokens.shape[1],frames)
        owner=torch.repeat_interleave(torch.arange(tokens.shape[1]),durations[0]);alignment[0,owner,torch.arange(frames)]=1
        noise=torch.randn(1,frames*600,generator=torch.Generator().manual_seed(seed))
        graph(plan,(tokens,voice),out/"plan.onnx",["tokens","voice"],["hidden","style","encoded","durations"],
              {"tokens":{1:"tokens"},"hidden":{1:"tokens"},"encoded":{2:"tokens"},"durations":{1:"tokens"}})
        graph(wave,(hidden,style,encoded,alignment,voice,noise),out/"wave.onnx",["hidden","style","encoded","alignment","voice","noise"],["audio"],
              {"hidden":{1:"tokens"},"encoded":{2:"tokens"},"alignment":{1:"tokens",2:"frames"},"noise":{1:"samples"},"audio":{1:"samples"}})
        hop,max_frames=600,1800
    meta={**r.metadata,"browser":{"hop":hop,"max_frames":max_frames,"noise_seed":seed,"threads":1}}
    (out/"config.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n")
    # Preserve torch's neutral default stream including length-dependent SIMD tails.
    full=torch.randn(hop*max_frames,generator=torch.Generator().manual_seed(seed)).numpy()
    full.tofile(out/"noise.bin")
    tails=np.stack([torch.randn(hop*n,generator=torch.Generator().manual_seed(seed))[-16:].numpy() for n in range(1,max_frames+1)])
    tails.tofile(out/"noise-tails.bin")
    return {p.name:{"bytes":p.stat().st_size,"sha256":digest(p)} for p in out.iterdir()}


def _fourier_basis(n,inverse):
    w=torch.hann_window(n,dtype=torch.float64);k=torch.arange(n//2+1,dtype=torch.float64)[:,None]
    ang=2*torch.pi*((k*torch.arange(n,dtype=torch.float64))%n)/n;c=torch.full((n//2+1,1),2.0,dtype=torch.float64);c[0]=c[-1]=1
    basis=torch.cat([torch.cos(ang)*c,-torch.sin(ang)*c])/n*w if inverse else torch.cat([torch.cos(ang),-torch.sin(ang)])*w
    return basis.float()[:,None].numpy()


def reduce_precision(source,destination,sound_prefixes,exact_outputs=(),integer=True,sound_only=False):
    """Smaller copy of one exported graph; the float graph stays the reference.

    Storage rules of upstream's CPU file (recipe/train/onnx_export.py, small_copy): weight matrices
    of the sound generator as int8 with one scale per first-axis slice, recurrent weights and the
    text side as half floats, and the four Fourier bases rebuilt from a few operators. One
    difference: a tensor that an output named in exact_outputs depends on is left as it is.
    Upstream stores the whole text side as half floats; in the planner that moved a planned
    duration by one frame in 17 of 1,672 checked calls, so everything the durations depend on
    stays float32 and the reduced planner plans exactly what the float export plans. Every stored
    tensor is expanded to float32 by the graph itself; inputs, outputs and operators are unchanged.
    No weight is retrained or re-fitted.

    sound_only=True leaves every tensor outside the sound generator as it is, so the pitch and
    energy predictor in the waveform graph stays float32 like the planner. For the fits of the German
    family type with the larger teacher, half floats in that predictor alone moved the output by a
    log-mel distance of up to 0.14 (the same storage in the sound generator: 0.01), and with
    upstream's rule the files did not meet the bar of tools/check-reduced-precision.py.
    integer=False also leaves the int8 step out: the weight matrices of the sound generator are
    stored as half floats.
    """
    import onnx
    from onnx import numpy_helper,helper,TensorProto
    model=onnx.load(str(source));g=model.graph;added=[];counts={"int8":0,"float16":0,"fourier":0}
    users={}
    for node in g.node:
        for name in node.input:users.setdefault(name,[]).append(node)
    recurrent={node.input[i] for node in g.node if node.op_type=="LSTM" for i in (1,2)}
    producer={name:node for node in g.node for name in node.output};exact=set();pending=list(exact_outputs)
    while pending:
        name=pending.pop()
        if name in exact:continue
        exact.add(name);pending+=list(producer[name].input) if name in producer else []
    def sound(name):
        return name.startswith(sound_prefixes) or any(node.name.startswith(tuple("/"+p.replace(".","/") for p in sound_prefixes)) for node in users.get(name,[]))
    def generated(name,n,inverse):
        p=name+"_gen_";half=n//2+1;row=np.ones((2*half,1),np.float32)
        if inverse:row[:]=2/n;row[[0,half-1,half,2*half-1]]=1/n
        g.initializer.extend([numpy_helper.from_array(np.arange(half,dtype=np.int64)[:,None],p+"k"),numpy_helper.from_array(np.arange(n,dtype=np.int64)[None],p+"n"),
            numpy_helper.from_array(np.array(n,np.int64),p+"N"),numpy_helper.from_array(np.array(2*np.pi/n,np.float32),p+"c"),
            numpy_helper.from_array(torch.hann_window(n).numpy()[None],p+"w"),numpy_helper.from_array(row,p+"row"),numpy_helper.from_array(np.array([1],np.int64),p+"ax")])
        return [helper.make_node("Mul",[p+"k",p+"n"],[p+"kn"]),helper.make_node("Mod",[p+"kn",p+"N"],[p+"m"]),
                helper.make_node("Cast",[p+"m"],[p+"mf"],to=TensorProto.FLOAT),helper.make_node("Mul",[p+"mf",p+"c"],[p+"a"]),
                helper.make_node("Cos",[p+"a"],[p+"cos"]),helper.make_node("Sin",[p+"a"],[p+"sin"]),helper.make_node("Neg",[p+"sin"],[p+"nsin"]),
                helper.make_node("Concat",[p+"cos",p+"nsin"],[p+"cs"],axis=0),helper.make_node("Mul",[p+"cs",p+"w"],[p+"b0"]),helper.make_node("Mul",[p+"b0",p+"row"],[p+"b"]),
                helper.make_node("Unsqueeze",[p+"b",p+"ax"],[name])]
    for init in list(g.initializer):
        w=numpy_helper.to_array(init);name=init.name
        if w.dtype!=np.float32 or name in exact or (sound_only and not sound(name)):continue
        hit=[(n,inverse) for n in (600,150) for inverse in (False,True) if w.shape==(n+2,1,n) and np.abs(w-_fourier_basis(n,inverse)).max()<1e-4*np.abs(w).max()]
        if hit:
            g.initializer.remove(init);added+=generated(name,*hit[0]);counts["fourier"]+=1
        elif integer and w.ndim>=2 and w.size>=1024 and name not in recurrent and sound(name):
            scale=np.abs(w).reshape(w.shape[0],-1).max(1)/127;scale[scale==0]=1
            q=np.clip(np.round(w/scale.reshape((-1,)+(1,)*(w.ndim-1))),-127,127).astype(np.int8);g.initializer.remove(init)
            g.initializer.extend([numpy_helper.from_array(q,name+"_q"),numpy_helper.from_array(scale.astype(np.float16),name+"_s16"),numpy_helper.from_array(np.zeros(len(scale),np.int8),name+"_z")])
            added+=[helper.make_node("Cast",[name+"_s16"],[name+"_s"],to=TensorProto.FLOAT),helper.make_node("DequantizeLinear",[name+"_q",name+"_s",name+"_z"],[name],axis=0)];counts["int8"]+=1
        elif w.size>=64 and np.abs(w).max()<6e4:
            g.initializer.remove(init);g.initializer.append(numpy_helper.from_array(w.astype(np.float16),name+"_16"))
            added.append(helper.make_node("Cast",[name+"_16"],[name],to=TensorProto.FLOAT));counts["float16"]+=1
    for node in reversed(added):g.node.insert(0,node)
    onnx.checker.check_model(model);onnx.save(model,str(destination))
    return counts


# Storage rules of a reduced copy: description, int8 step, sound generator only.
RULES={"int8":("sound generator weight matrices int8 per slice, recurrent weights and the text side float16, Fourier bases generated; every tensor the planned durations depend on stays float32",True,False),
       "sound-int8":("sound generator weight matrices int8 per slice, its recurrent weights float16, Fourier bases generated; the text side (planner, pitch and energy predictor) stays float32",True,True),
       "sound-float16":("sound generator tensors of at least 64 elements float16, no int8, Fourier bases generated; the text side (planner, pitch and energy predictor) stays float32",False,True)}


def reduce_release(export_dir,destination,parts=("plan","wave"),storage="int8"):
    """Reduced-precision copy of a Kale export (either Kale family); noise assets are the same files.

    parts names the graphs that are reduced. A graph that is not named is the float32 file itself.
    storage is "int8" (the rule of upstream's CPU file), "sound-int8" (the same for the sound
    generator, the whole text side float32) or "sound-float16" (half floats in the sound generator only).
    """
    import os
    source=Path(export_dir);out=Path(destination);meta=json.loads((source/"config.json").read_text());parts=tuple(parts)
    if meta["family"] not in ("kale","kale-en") or "precision" in meta["browser"]:raise ValueError("UNSUPPORTED_PRECISION_SOURCE")
    if not parts or len(set(parts))!=len(parts) or any(part not in ("plan","wave") for part in parts):raise ValueError("UNSUPPORTED_PRECISION_PARTS")
    if storage not in RULES:raise ValueError("UNSUPPORTED_PRECISION_STORAGE")
    out.mkdir(parents=True,exist_ok=False)
    counts={part:reduce_precision(source/f"{part}.onnx",out/f"{part}.onnx",("audio.","head."),("durations",) if part=="plan" else (),integer=RULES[storage][1],sound_only=RULES[storage][2]) for part in ("plan","wave") if part in parts}
    meta["browser"]["precision"]={"rule":RULES[storage][0],"storage":storage,
                                  "float_reference":{part:digest(source/f"{part}.onnx") for part in ("plan","wave")},"tensors":counts}
    # A build may reduce one graph only; the config names the reduced graphs and the other file is the float32 one.
    if len(parts)<2:meta["browser"]["precision"]["reduced_graphs"]=list(parts)
    (out/"config.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n")
    for name in ["noise.bin","noise-tails.bin"]+[f"{part}.onnx" for part in ("plan","wave") if part not in parts]:os.link(source/name,out/name)
    return {p.name:{"bytes":p.stat().st_size,"sha256":digest(p)} for p in out.iterdir()}
