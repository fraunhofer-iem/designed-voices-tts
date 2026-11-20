# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Kale
# Portable generator-only extraction; constructor voice count is explicit.
import torch
from torch import nn
from . import decoder as M

R2W = {"r2": dict(hd=192, ah=256, al=6, an=4, sd=32, nl=3), "r2s": dict(hd=128, ah=192, al=4, an=4, sd=32, nl=2),
       "r2l": dict(hd=256, ah=320, al=6, an=4, sd=32, nl=3)}


class R2Ac(nn.Module):
    """small sound side: its own TextEncoder (trained with the decoder on real Maya audio) + the k-line decoder (preset A) with one
    learned 16-d style row per voice. Decoder layers whose shapes match a tiny (k) decoder's can be initialised from it (init_from_k)."""
    def __init__(self, width="r2", voices=4):
        super().__init__()
        from ..kokoro.modules import TextEncoder
        hd = R2W[width]["hd"]
        self.te = TextEncoder(channels=hd, kernel_size=5, depth=3, n_symbols=178)
        self.dec = M.Dec("A", hd, 16, 160, 4)
        self.style = nn.Parameter(torch.randn(voices, 16) * 0.1)

    def forward(self, asr, F0, N, noise=None, c0=None, vid=None):
        st = self.style[:1].expand(asr.shape[0], -1) if vid is None else self.style[vid]
        return self.dec(asr, F0, N, st, noise, c0)

    def init_from_k(self, sd):
        own = self.state_dict()
        hit = {k[0:]: v for k, v in sd.items() if k.startswith("dec.") and k in own and own[k].shape == v.shape}
        if "style" in sd:   # same voices -> keep each voice's row; else start every row from the first
            hit["style"] = sd["style"].clone() if sd["style"].shape == own["style"].shape else sd["style"][:1].expand_as(own["style"]).clone()
        own.update(hit)
        self.load_state_dict(own)
        return len(hit), len(own)


class R2Text(nn.Module):
    """small text side (ALBERT + prosody predictor at about a third of the teacher's width) with one learned prosody style per voice;
    trained to copy the teacher's durations, pitch and loudness on text only."""
    def __init__(self, width="r2", voices=4):
        super().__init__()
        from ..kokoro.modules import CustomAlbert, ProsodyPredictor
        from transformers import AlbertConfig
        c = R2W[width]
        self.bert = CustomAlbert(AlbertConfig(vocab_size=178, hidden_size=c["ah"], num_attention_heads=c["an"], intermediate_size=c["ah"] * 3,
                                              num_hidden_layers=c["al"], max_position_embeddings=512, embedding_size=min(128, c["ah"])))
        self.bert_encoder = nn.Linear(c["ah"], c["hd"])
        self.predictor = ProsodyPredictor(style_dim=c["sd"], d_hid=c["hd"], nlayers=c["nl"], max_dur=50, dropout=0.1)
        self.pstyle = nn.Parameter(torch.zeros(voices, c["sd"]))

    def dur_feats(self, x, L, mask, vid):
        s = self.pstyle[vid]
        d_en = self.bert_encoder(self.bert(x, attention_mask=(~mask).int())).transpose(-1, -2)
        d = self.predictor.text_encoder(d_en, s, L, mask)
        xx, _ = self.predictor.lstm(d)
        return d, self.predictor.duration_proj(xx), s

