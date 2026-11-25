// Actual ORT CPU-WASM speech parity, loopback-only ephemeral server, no inference server.
import {chromium} from 'playwright';
import {resolve,join,basename} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
const [exportsArg,proofArg,receiptArg='BROWSER-WASM.json']=process.argv.slice(2);
if(!exportsArg||!proofArg) throw Error('Usage: bun tools/check-export-browser.mjs EXPORT_ROOT PROOF_ROOT [RECEIPT]');
const exportsRoot=resolve(exportsArg),proof=resolve(proofArg),ortRoot=resolve('node_modules/onnxruntime-web/dist');
const fixtures=JSON.parse(await readFile(join(proof,'fixtures.json'),'utf8'));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
 const path=decodeURIComponent(new URL(request.url).pathname);
 let file;
 if(path==='/') return new Response('<!doctype html><title>CPU WASM parity</title>',{headers:{'content-type':'text/html'}});
 if(path.startsWith('/ort/')) file=join(ortRoot,basename(path));
 else if(/^\/models\/[a-z0-9-]+\/(plan\.onnx|wave\.onnx|config\.json|noise\.bin|noise-tails\.bin)$/.test(path)) file=join(exportsRoot,path.slice(8));
 else if(/^\/proof\/[a-z0-9-]+\.f32$/.test(path)) file=join(proof,basename(path));
 if(!file) return new Response('Not found',{status:404});
 return new Response(Bun.file(file),{headers:{'content-type':file.endsWith('.mjs')?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
}});
let browser;
const receipt={scope:'Actual Chromium ORT CPU-WASM single-threaded inference, cached phoneme inputs, no WebGPU or server inference',ort:'1.23.2',cases:[],ok:false};
try {
 browser=await chromium.launch({headless:true});receipt.browser=await browser.version();
 const page=await browser.newPage();
 page.on('console',msg=>console.log('browser:',msg.text()));
 await page.goto(`http://127.0.0.1:${server.port}`);
 // Every model directory the fixtures name: voca64 and kale by default, or the directory of another Kale export.
 for(const model of [...new Set(fixtures.map(f=>f.model))]){
  const result=await page.evaluate(async({model,fixtures})=>{
   const ort=await import('/ort/ort.wasm.min.mjs');
   ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths='/ort/';ort.env.wasm.proxy=false;
   const start=performance.now();
   const sessions=[];
   try {
    for(const part of ['plan','wave']) sessions.push(await ort.InferenceSession.create(`/models/${model}/${part}.onnx`,{executionProviders:['wasm'],graphOptimizationLevel:'all'}));
    const config=await(await fetch(`/models/${model}/config.json`)).json();
    const stream=new Float32Array(await(await fetch(`/models/${model}/noise.bin`)).arrayBuffer());
    const tails=new Float32Array(await(await fetch(`/models/${model}/noise-tails.bin`)).arrayBuffer());
    const rows=[];
    for(const fixture of fixtures.filter(f=>f.model===model)){
     const t0=performance.now(),N=fixture.tokens.length;
     const tensor=(values,dims)=>new ort.Tensor('int64',BigInt64Array.from(values,BigInt),dims);
     const tokens=tensor(fixture.tokens,[1,N]),voice=tensor([fixture.voice],[1]);
     const feeds={tokens,voice};if(model==='voca64')feeds.stress=tensor(fixture.stress,[1,N]);
     const planned=await sessions[0].run(feeds);
     const durations=Array.from(planned.durations.data,Number),frames=durations.reduce((a,b)=>a+b,0);
     if(frames<1||frames>config.browser.max_frames)throw Error('FRAME_BOUND');
     const noise=stream.slice(0,frames*config.browser.hop);
     noise.set(tails.subarray((frames-1)*16,frames*16),noise.length-16);
     const waveFeeds={...planned,voice,noise:new ort.Tensor('float32',noise,[1,noise.length])};
     if(model==='voca64')waveFeeds.tokens=tokens;
     else {
      delete waveFeeds.durations;
      const alignment=new Float32Array(N*frames);let frame=0;
      for(let token=0;token<N;token++)for(let k=0;k<durations[token];k++)alignment[token*frames+frame++]=1;
      waveFeeds.alignment=new ort.Tensor('float32',alignment,[1,N,frames]);
     }
     const {audio}=await sessions[1].run(waveFeeds);
     const reference=new Float32Array(await(await fetch('/proof/'+fixture.reference)).arrayBuffer());
     let maxabs=0,peak=0,squared=0,base=0,finite=true;
     for(let i=0;i<audio.data.length;i++){
      const value=audio.data[i],ref=reference[i],error=value-ref;
      finite&&=Number.isFinite(value);maxabs=Math.max(maxabs,Math.abs(error));peak=Math.max(peak,Math.abs(ref));squared+=error*error;base+=ref*ref;
     }
     const exact=JSON.stringify(durations)===JSON.stringify(fixture.durations),samplesExact=audio.data.length===reference.length;
     const peakRelative=maxabs/peak,relativeL2=Math.sqrt(squared/base);
     rows.push({model,id:fixture.id,frames,samples:audio.data.length,durations_exact:exact,samples_exact:samplesExact,finite,maxabs,peak,peak_relative:peakRelative,relative_l2:relativeL2,elapsed_ms:performance.now()-t0,ok:exact&&samplesExact&&finite&&peakRelative<=.02&&relativeL2<=.01});
    }
    return {model,elapsed_ms:performance.now()-start,graph_inputs:sessions.map(s=>s.inputNames),rows,ok:rows.every(r=>r.ok)};
   }catch(error){return {model,error:String(error),stack:error.stack,ok:false};}
   finally{for(const s of sessions)await s.release();}
  },{model,fixtures});
  console.log(JSON.stringify(result));receipt.cases.push(result);
 }
 receipt.ok=receipt.cases.every(c=>c.ok);
} catch(error){receipt.error=String(error);}
finally{await browser?.close();server.stop(true);await writeFile(join(proof,receiptArg),JSON.stringify(receipt,null,2)+'\n');}
if(!receipt.ok)process.exitCode=1;
