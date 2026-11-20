"""German adaptation inference ABI, distinct from the upstream English wrapper."""
import torch
from torch.nn import functional as F


@torch.inference_mode()
def synthesize(text, audio, ids, vid, vocabulary, seed=20261120):
    text.eval()
    audio.eval()
    x = torch.tensor([ids], dtype=torch.long)
    length = torch.tensor([len(ids)])
    mask = torch.zeros_like(x, dtype=torch.bool)
    voice = torch.tensor([vid])
    hidden, logits, style = text.dur_feats(x, length, mask, voice)
    durations = logits.sigmoid().sum(-1).round().long()[0]
    required = torch.isin(x[0], torch.tensor(vocabulary["required_ids"]))
    durations = torch.where(required, durations.clamp_min(1), durations.clamp_min(0))
    durations[torch.isin(x[0], torch.tensor(vocabulary["stress_ids"]))] = 0
    frames = int(durations.sum())
    if not 1 <= frames <= 1800:
        raise ValueError("UTTERANCE_OUTSIDE_45_SECOND_BOUND")
    repeat = torch.repeat_interleave(torch.arange(len(ids)), durations)
    alignment = F.one_hot(repeat, num_classes=len(ids)).transpose(0, 1).float()[None]
    f0, energy = text.predictor.F0Ntrain(hidden.transpose(-1, -2) @ alignment, style)
    f0 = torch.where(f0 >= 25., f0, torch.zeros_like(f0))
    encoded = audio.te(x, length, mask) @ alignment
    noise = torch.randn(1, frames * 600, generator=torch.Generator().manual_seed(seed))
    wave = audio(encoded, f0, energy, noise=noise, vid=voice)[0]
    if wave.numel() != frames * 600 or not torch.isfinite(wave).all():
        raise ValueError("INVALID_GENERATED_WAVEFORM")
    return wave.float().cpu(), {"durations": durations.tolist(), "f0_floor_hz": 25., "teacher_inputs": False}
