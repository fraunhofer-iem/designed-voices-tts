# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Kale; Paradee export helpers, see THIRD_PARTY_NOTICES.md.
import torch
from torch import nn
from torch.nn import functional as F
from torch.nn.utils import remove_weight_norm
from torch.nn.utils.parametrize import is_parametrized, remove_parametrizations
from .vhead import SR,FHOP

def strip(m):
    for x in m.modules():
        try: remove_weight_norm(x)
        except Exception: pass
        if is_parametrized(x, "weight"):
            try: remove_parametrizations(x, "weight", leave_parametrized=True)
            except Exception: pass

class ConvSTFT(nn.Module):
    """torch.stft / torch.istft (hann, centre, reflect) as conv1d / conv_transpose1d with real and imaginary parts kept apart."""
    def __init__(self, n, hop):
        super().__init__(); self.n, self.hop, self.K = n, hop, n // 2 + 1; w = torch.hann_window(n, dtype=torch.float64); k = torch.arange(self.K, dtype=torch.float64)[:, None]
        ang = 2 * torch.pi * ((k * torch.arange(n, dtype=torch.float64)) % n) / n; c = torch.full((self.K, 1), 2.0, dtype=torch.float64); c[0] = c[-1] = 1
        self.register_buffer("fwd", (torch.cat([torch.cos(ang), -torch.sin(ang)]) * w).float()[:, None])
        self.register_buffer("inv", (torch.cat([torch.cos(ang) * c, -torch.sin(ang) * c]) / n * w).float()[:, None]); self.register_buffer("w2", (w ** 2).float()[None, None])
    def transform(self, x):   # [B,S] -> re, im [B,K,frames]
        y = F.conv1d(F.pad(x[:, None], (self.n // 2, self.n // 2), mode="reflect"), self.fwd, stride=self.hop); return y[:, :self.K], y[:, self.K:]
    def inverse(self, re, im):
        y = F.conv_transpose1d(torch.cat([re, im], 1), self.inv, stride=self.hop)[:, 0]
        env = F.conv_transpose1d(torch.ones_like(re[:1, :1]), self.w2, stride=self.hop)[:, 0]
        return (y / env.clamp_min(1e-8))[:, self.n // 2: -(self.n // 2)]

class HeadX(nn.Module):
    """SourceFilterHead2.forward with real STFT kernels and source float64 phase.

    Plain ORT CPU-WASM supports this phase path; JSEP/WebGPU is not qualified.
    Do not replace the cumulative phase with naive float32 accumulation.
    """
    def __init__(self, h):
        super().__init__(); self.h = h; self.st = ConvSTFT(h.n_fft, h.hop); self.sb = ConvSTFT(150, 75)
        self.register_buffer("k", torch.arange(1, h.K + 1).float()[None, :, None]); self.register_buffer("fr", torch.linspace(0, SR / 2, h.nb)[None, :, None])
    def forward(self, x, f0, noise=None):
        h = self.h; n = x.shape[2]; T = n * h.up; S = n * FHOP
        z = h.norm0(h.inp(x).transpose(1, 2)).transpose(1, 2)
        for b in h.blocks: z = b(z)
        hn = h.norm1(z.transpose(1, 2)); o = h.out(hn).view(1, T, h.C * h.G + 1); o = torch.cat([o, o[:, -1:]], 1)
        g = (o[..., :-1].reshape(1, T + 1, h.C, h.G) @ h.M.T).permute(0, 2, 3, 1)
        gh, gn = torch.exp(g[:, 0].clamp(max=6)), torch.exp(g[:, 3].clamp(max=6)); um = torch.sqrt(g[:, 1] ** 2 + g[:, 2] ** 2).clamp_min(1e-4); ur, ui = g[:, 1] / um, g[:, 2] / um
        # sine bank (vhead.sine_bank): running phase in float64 at frame rate, wrapped, then interpolated between frame centres
        r = f0.double() * FHOP / SR; c = torch.cumsum(r, 1); c = (c - torch.floor(c)).float(); d = torch.cat([r[:, 1:], torch.zeros_like(r[:, :1])], 1).float()
        t = torch.arange(S, device=x.device); p = (t.float() + 0.5) / FHOP - 0.5; i = torch.clamp(torch.floor(p), min=0).long(); i = torch.minimum(i, (n - 1) * torch.ones_like(i)); frac = torch.clamp(p - i.float(), 0, 1)
        cyc = c[:, i] + frac * d[:, i]; f0s = f0[:, t // FHOP]; uv = (f0s > 10).float()
        amp = ((f0s[:, None] * self.k < 11000).float() * uv[:, None])
        e = (torch.sin(2 * torch.pi * self.k * cyc[:, None]) * amp).sum(1) * 0.1
        nz = torch.randn_like(e) if noise is None else noise
        Er, Ei = self.st.transform(e); Nr, Ni = self.st.transform(nz); j = 0
        for m in range(1, h.mod + 1):
            for fn in (torch.cos, torch.sin):
                a = g[:, 4 + j]; mr, mi = self.st.transform(nz * uv * fn(2 * torch.pi * m * cyc)); Nr = Nr + a * mr; Ni = Ni + a * mi; j += 1
        f0f = torch.cat([f0[:, torch.arange(T, device=x.device) // h.up], f0[:, -1:]], 1).clamp_min(60); ang = 2 * torch.pi * (self.fr / f0f[:, None]) * (0.5 * torch.tanh(o[..., -1])[:, None])
        Hr = gh * (ur * torch.cos(ang) - ui * torch.sin(ang)); Hi = gh * (ur * torch.sin(ang) + ui * torch.cos(ang))
        y = self.st.inverse(Er * Hr - Ei * Hi + Nr * gn, Er * Hi + Ei * Hr + Ni * gn)
        if h.burst:
            gb = torch.exp((h.out_b(hn).view(1, n * 4, h.Gb) @ h.Mb.T).clamp(max=6)).transpose(1, 2); gb = torch.cat([gb, gb[..., -1:]], -1)
            br, bi = self.sb.transform(nz.flip(-1)); y = y + self.sb.inverse(br * gb, bi * gb)
        return y


