# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Kale
# Portions: the decoder losses spec_losses / harm_loss / mod_loss (from paradee train_vhead.py), paradee (Apache-2.0,
# github.com/sahilmahendrakar/paradee @ 2de547e4), see third_party/paradee/LICENSE and NOTICE.
# Dec follows Kokoro's istftnet Decoder layout (kokoro, Apache-2.0, Copyright hexgrad) built from Kokoro's AdainResBlk1d;
# SLMJudge follows StyleTTS2's speech-model discriminator layout (StyleTTS2, MIT, Copyright (c) 2023 Aaron (Yinghao) Li).
"""kale-tts-1 model pieces shared by the trainers (train.py, kline.py) and the ONNX export (onnx_export.py).
  Dec       : Kokoro-style AdaIN trunk + a frame-rate source-filter head (64-harmonic sine source + noise + iSTFT, 24 kHz, no separate
              vocoder), conditioned on an external style row. The head (SourceFilterHead2) and the trunk width presets (DEC_PRESETS)
              come from paradee (Apache-2.0, vendored unchanged in third_party/paradee/, see its NOTICE).
  mas_batch : monotonic alignment search (Glow-TTS rule), used on the teacher aligner's attention for the training durations.
  SLMJudge  : StyleTTS2's speech-model discriminator layout on frozen HuBERT-base-ls960 hidden states.
  spec_losses / harm_loss / mod_loss: the decoder's spectral, harmonic and modulation losses (paradee train_vhead.py maths, unchanged).
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.nn.utils import weight_norm

from ..kokoro.istftnet import AdainResBlk1d
DEC_PRESETS = {  # name: (adain width, upsample_initial_channel, resblock kernels)
    "teacher": (1024, 512, [3, 7, 11]),
    "A": (256, 128, [3, 7, 11]),
    "B": (256, 128, [3, 7]),
    "C": (192, 96, [3, 7]),
    "D": (128, 64, [3, 7]),
    "E": (128, 64, [3, 5]),
    "F": (96, 48, [3, 5]),
    "W": (192, 256, [3, 7, 11]),   # wider vocoder final stage (64 ch), thinner AdaIN blocks
    "W2": (128, 256, [3, 7]),
    "L": (384, 192, [3, 7, 11]),   # 7.86M: capacity probe, 1.5x wider everywhere than A
}

from .vhead import SourceFilterHead2

N_TOK = 178
HOP = 600            # one sound-feature frame = 600 samples (40 frames/s), pitch/loudness frames = 300 samples


# ---------------------------------------------------------------- decoder: Kokoro-style AdaIN trunk + external source-filter head, external style
class Dec(nn.Module):
    def __init__(self, preset, dim_in, style_dim, hdim, hblk):
        super().__init__()
        W, uic, _ = DEC_PRESETS[preset]
        self.encode = AdainResBlk1d(dim_in + 2, W, style_dim)
        self.decode = nn.ModuleList([AdainResBlk1d(W + 2 + 64, W, style_dim) for _ in range(3)]
                                    + [AdainResBlk1d(W + 2 + 64, uic, style_dim, upsample=True)])
        self.F0_conv = weight_norm(nn.Conv1d(1, 1, kernel_size=3, stride=2, padding=1))
        self.N_conv = weight_norm(nn.Conv1d(1, 1, kernel_size=3, stride=2, padding=1))
        self.asr_res = nn.Sequential(weight_norm(nn.Conv1d(dim_in, 64, kernel_size=1)))
        self.head = SourceFilterHead2(in_ch=uic, dim=hdim, blocks=hblk)

    def trunk(self, asr, F0_curve, N, s):
        F0 = self.F0_conv(F0_curve.unsqueeze(1))
        Nn = self.N_conv(N.unsqueeze(1))
        x = self.encode(torch.cat([asr, F0, Nn], 1), s)
        asr_res = self.asr_res(asr)
        res = True
        for block in self.decode:
            if res:
                x = torch.cat([x, asr_res, F0, Nn], 1)
            x = block(x, s)
            if block.upsample_type != "none":
                res = False
        return x

    def forward(self, asr, F0_curve, N, s, noise=None, c0=None):
        return self.head(self.trunk(asr, F0_curve, N, s), F0_curve, noise, c0)










# ---------------------------------------------------------------- monotonic alignment search (ours)
def mas_batch(ll, tl, fl):
    """monotonic alignment search (Glow-TTS rule) per item on a [B,T,F] log-likelihood (numpy float32) -> list of durations."""
    from numba import njit, prange

    global _mas
    if "_mas" not in globals():
        @njit(parallel=True, cache=False)
        def _m(ll, tl, fl, out):
            for b in prange(ll.shape[0]):
                tx, ty = tl[b], fl[b]
                v = np.full((tx, ty), -1e30, dtype=np.float64)
                for y in range(ty):
                    lo = max(0, tx + y - ty)
                    hi = min(tx, y + 1)
                    for x in range(lo, hi):
                        if y == 0:
                            v[x, y] = ll[b, x, y] if x == 0 else -1e30
                        else:
                            a = v[x, y - 1]
                            c = v[x - 1, y - 1] if x > 0 else -1e30
                            v[x, y] = ll[b, x, y] + (a if a > c else c)
                idx = tx - 1
                for y in range(ty - 1, -1, -1):
                    out[b, idx] += 1
                    if idx != 0 and (idx == y or v[idx, y - 1] < v[idx - 1, y - 1]):
                        idx -= 1
        _mas = _m
    out = np.zeros((ll.shape[0], ll.shape[1]), dtype=np.int32)
    _mas(ll, np.asarray(tl, dtype=np.int64), np.asarray(fl, dtype=np.int64), out)
    return [out[b, : tl[b]] for b in range(len(tl))]


# ---------------------------------------------------------------- speech-model judge (StyleTTS2 layout, HuBERT features)
class SLMJudge(nn.Module):
    def __init__(self, hidden=768, layers=13, ch=64):
        super().__init__()
        self.pre = weight_norm(nn.Conv1d(hidden * layers, ch, 1))
        self.convs = nn.ModuleList([weight_norm(nn.Conv1d(ch, ch * 2, 5, padding=2)),
                                    weight_norm(nn.Conv1d(ch * 2, ch * 4, 5, padding=2)),
                                    weight_norm(nn.Conv1d(ch * 4, ch * 4, 5, padding=2))])
        self.post = weight_norm(nn.Conv1d(ch * 4, 1, 3, padding=1))

    def forward(self, h):                # h [B, layers*hidden, T]
        x = self.pre(h)
        for c in self.convs:
            x = F.leaky_relu(c(x), 0.2)
        return self.post(x).flatten(1)


def slm_hidden(hubert, wav24):
    import torchaudio.functional as AF
    w = AF.resample(wav24, 24000, 16000)
    hs = hubert(w, output_hidden_states=True).hidden_states
    return torch.stack(hs, 1)            # [B, 13, T, 768]


# ---------------------------------------------------------------- losses (Paradee train_vhead.py, unchanged maths)
_mel_cache = {}


def spec_losses(y, t, fine=True):
    import torchaudio
    dev = y.device
    if dev not in _mel_cache:
        _mel_cache[dev] = torchaudio.transforms.MelSpectrogram(24000, n_fft=1024, hop_length=256, n_mels=80).to(dev)
    mel = _mel_cache[dev]
    lm = F.l1_loss(torch.log(mel(y).clamp_min(1e-5)), torch.log(mel(t).clamp_min(1e-5)))
    ls = 0
    SZ = (64, 128, 512, 1024, 2048) if fine else (512, 1024, 2048)
    for n in SZ:
        w = torch.hann_window(n, device=dev)
        Y = torch.stft(y, n, n // 4, window=w, return_complex=True).abs()
        T = torch.stft(t, n, n // 4, window=w, return_complex=True).abs()
        ls = ls + (T - Y).norm() / T.norm().clamp_min(1e-5) + F.l1_loss(torch.log(Y.clamp_min(1e-5)), torch.log(T.clamp_min(1e-5)))
    return lm, ls / len(SZ)


def harm_loss(y, t, f0, n=2048, hop=512):
    DEV = y.device
    w = torch.hann_window(n, device=DEV)
    nfr = y.shape[-1] // hop + 1
    idx = (torch.arange(nfr, device=DEV) * hop // 300).clamp(max=f0.shape[1] - 1)
    lo = (idx - 2).clamp(min=0)
    hi = (idx + 2).clamp(max=f0.shape[1] - 1)
    f = f0[:, idx]
    v = (torch.minimum(torch.minimum(f0[:, lo], f), f0[:, hi]) > 100).float()
    fr = torch.arange(n // 2 + 1, device=DEV) * 24000 / n
    ratio = fr[None, :, None] / f.clamp_min(60)[:, None]
    frac = (ratio - ratio.round()).abs()
    mh, mi = (frac < 0.15).float(), ((frac - 0.5).abs() < 0.15).float()
    bands = torch.stack([((fr >= 1000 * b) & (fr < 1000 * (b + 1))).float() for b in range(1, 9)])
    out = []
    for x in (y, t):
        P = torch.stft(x, n, hop, window=w, return_complex=True).abs().pow(2)
        out.append(torch.log((torch.einsum("bft,kf->bkt", P * mh, bands) + 1e-8) / (torch.einsum("bft,kf->bkt", P * mi, bands) + 1e-8)))
    return ((out[0] - out[1]).abs() * v[:, None]).sum() / (v.sum() * 8).clamp_min(1)


MODB = [(4, 8), (8, 12), (12, 16), (16, 21), (21, 29)]


def mod_loss(y, t, cyc, uv, n=64, hop=16, win=75):
    DEV = y.device
    w = torch.hann_window(n, device=DEV)
    k = y.shape[-1] // hop + 1
    ph = 2 * torch.pi * F.pad(cyc, (0, hop))[:, ::hop][:, :k]
    v = F.pad(uv, (0, hop))[:, ::hop][:, :k]
    carr = torch.stack([fn(m * ph) for m in (1, 2) for fn in (torch.cos, torch.sin)], 1)
    D = []
    for x in (y, t):
        X = torch.stft(x, n, hop, window=w, return_complex=True).abs()
        e = torch.stack([X[:, a:b].sum(1) for a, b in MODB], 1)
        num = F.avg_pool1d((e[:, :, None] * carr[:, None]).flatten(1, 2), win, win // 2)
        den = F.avg_pool1d(e, win, win // 2).clamp_min(1e-5)
        D.append(2 * num.view(e.shape[0], 5, 4, -1) / den[:, :, None])
    vm = (F.avg_pool1d(v[:, None], win, win // 2) > 0.99).float()[:, :, None]
    return ((D[0] - D[1]).abs() * vm).sum() / (vm.sum() * 20).clamp_min(1)


def nparams(m):
    return sum(p.numel() for p in m.parameters()) / 1e6
