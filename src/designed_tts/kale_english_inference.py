"""Inference rules of the public English Kale TTS 1 Nano, distinct from the German adaptation.

Every token gets at least one frame, stress marks and spaces included. The pitch of the last
voiced frames is held above a per-voice floor, and pitch below a per-voice value is unvoiced.
Source: recipe/train/onnx_export.py and recipe/export/add_end_clamp.py, add_voice_tail.py,
add_voice_unvoice.py of KaleComputer/kale-tts-1-tiny (Apache-2.0).
"""
import torch
from torch.nn import functional as F


def shape_pitch(f0, floor, threshold, tail, unvoice):
    """End clamp, then unvoicing floor. f0 is [1, frames]; the other values are scalars or [1, 1]."""
    voiced = f0 > threshold
    index = torch.arange(f0.shape[1], dtype=torch.float32)[None]
    last = torch.where(voiced, index, torch.full_like(index, -1e9)).max()
    ending = voiced & (index >= last - tail) & (index <= last) & (voiced.float().sum() >= 5)
    f0 = torch.where(ending, torch.maximum(f0, floor), f0)
    return torch.where(f0 < unvoice, torch.zeros_like(f0), f0)


@torch.inference_mode()
def synthesize(text, audio, values, ids, vid, seed=20261120):
    text.eval()
    audio.eval()
    x = torch.tensor([ids], dtype=torch.long)
    length = torch.tensor([len(ids)])
    mask = torch.zeros_like(x, dtype=torch.bool)
    voice = torch.tensor([vid])
    hidden, logits, style = text.dur_feats(x, length, mask, voice)
    durations = logits.sigmoid().sum(-1).round().long()[0].clamp_min(1)
    frames = int(durations.sum())
    if not 1 <= frames <= 1800:
        raise ValueError("UTTERANCE_OUTSIDE_45_SECOND_BOUND")
    repeat = torch.repeat_interleave(torch.arange(len(ids)), durations)
    alignment = F.one_hot(repeat, num_classes=len(ids)).transpose(0, 1).float()[None]
    f0, energy = text.predictor.F0Ntrain(hidden.transpose(-1, -2) @ alignment, style)
    f0 = shape_pitch(f0, *(values[name][vid] for name in ("pitch_floor", "clamp_threshold", "clamp_tail", "unvoice")))
    encoded = audio.te(x, length, mask) @ alignment
    noise = torch.randn(1, frames * 600, generator=torch.Generator().manual_seed(seed))
    wave = audio(encoded, f0, energy, noise=noise, vid=voice)[0]
    if wave.numel() != frames * 600 or not torch.isfinite(wave).all():
        raise ValueError("INVALID_GENERATED_WAVEFORM")
    return wave.float().cpu(), {"durations": durations.tolist(), "teacher_inputs": False}
