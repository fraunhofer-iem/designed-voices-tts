"""Portable, checksum-verified CPU loaders; no pickle or network at inference."""
import hashlib
import json
from pathlib import Path

import torch
from safetensors.torch import load_file

FORMAT = "designed-tts/model/v1"
VOICE_VALUES = ("pitch_floor", "clamp_threshold", "clamp_tail", "unvoice")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_release(directory, *, marking="metadata", marker=None):
    """A fixed-roster model (docs/output-marking.md). marking="metadata" (default): WAV files written
    with synthesize_wav carry AI-generation metadata; the samples are the model output.
    marking="watermark": the samples also carry the AudioSeal watermark of the marker directory
    (marker=, or DESIGNED_TTS_MARKER; loading fails without one). marking="off": neither."""
    from .mark import Marker, marking_mode
    mode = marking_mode(marking)
    if mode == "watermark":
        marker = Marker.find(marker)
    elif marker is not None:
        raise ValueError("MARKER_GIVEN_WITHOUT_WATERMARK")
    root = Path(directory)
    metadata = json.loads((root / "config.json").read_text())
    if metadata.get("format") != FORMAT:
        raise ValueError("UNSUPPORTED_MODEL_FORMAT")
    weights = root / "model.safetensors"
    if weights.stat().st_size >= 100_000_000 or digest(weights) != metadata["weights"]["sha256"]:
        raise ValueError("WEIGHTS_INTEGRITY_FAILURE")
    tensors = load_file(str(weights), device="cpu")
    family = metadata["family"]
    if family == "voca":
        from .vendor.voca.config import Config
        from .vendor.voca.model import TinyVoca
        config = Config.from_dict(metadata["config"])
        if config != Config(speakers=config.speakers) or len(config.speakers) > 64:
            raise ValueError("MODEL_OUTSIDE_QUALIFIED_ARCHITECTURE")
        model = TinyVoca(config)
        model.load_state_dict(tensors, strict=True)
        models = (model.eval(),)
    elif family in ("kale", "kale-en"):
        english = family == "kale-en"
        if any(not key.startswith(("text.", "audio.", "voice.") if english else ("text.", "audio.")) for key in tensors):
            raise ValueError("UNEXPECTED_MODEL_TENSORS")
        from .vendor.kale.model import R2Ac, R2Text
        count = len(metadata["vocabulary"]["voices"])
        if not 1 <= count <= 64:
            raise ValueError("MODEL_OUTSIDE_RELEASE_BOUNDS")
        text, audio = R2Text(voices=count), R2Ac(voices=count)
        for module, prefix in ((text, "text."), (audio, "audio.")):
            module.load_state_dict({k[len(prefix):]: v for k, v in tensors.items() if k.startswith(prefix)}, strict=True)
            module.eval()
        models = (text, audio)
        if english:
            # Per-voice inference values of the upstream English model, one entry per voice.
            values = {name: tensors.pop(f"voice.{name}", None) for name in VOICE_VALUES}
            if any(value is None or value.shape != (count,) for value in values.values()) or \
                    any(key.startswith("voice.") for key in tensors):
                raise ValueError("UNEXPECTED_MODEL_TENSORS")
            models = (text, audio, values)
    else:
        raise ValueError("UNSUPPORTED_MODEL_FAMILY")
    return Release(metadata, models, marker=marker if mode == "watermark" else None, marking=mode)


class Release:
    def __init__(self, metadata, models, marker=None, marking=None):
        self.metadata, self.models, self.marker = metadata, models, marker
        self.marking = marking or ("watermark" if marker is not None else "metadata")

    @property
    def voices(self):
        if self.metadata["family"] == "voca":
            return self.metadata["config"]["speakers"]
        return self.metadata["vocabulary"]["voices"]

    def synthesize(self, ids, voice, *, stress=None, seed=None, marked=None):
        """Validated phoneme-plan input, not a hidden text frontend or cloning API.

        Returns the watermarked waveform when the release was loaded with marking="watermark", else the
        model output; marked=False returns the model output unchanged (parity tools), marked=True requires
        the watermark."""
        marked = self.marker is not None if marked is None else marked
        if marked and self.marker is None:
            from .mark import MarkingError
            raise MarkingError("WATERMARK_OFF: load the release with marking=\"watermark\" to watermark outputs")
        wave, extra = self.synthesize_unmarked(ids, voice, stress=stress, seed=seed)
        return (self.marker.mark(wave) if marked else wave), {**extra, "marked": marked}

    def synthesize_wav(self, ids, voice, *, stress=None, seed=None):
        """The WAV file of one output, marked as the release's mode says (metadata by default)."""
        from .mark import SAMPLE_RATE, export_wav
        wave, extra = self.synthesize(ids, voice, stress=stress, seed=seed)
        return export_wav(wave.numpy(), SAMPLE_RATE, family=self.metadata["family"], voice=voice, marking=self.marking), extra

    @torch.inference_mode()
    def synthesize_unmarked(self, ids, voice, *, stress=None, seed=None):
        """The model output, unchanged: what the parity and identity gates compare."""
        if voice not in self.voices:
            raise ValueError("UNKNOWN_VOICE")
        if not 1 <= len(ids) <= 512:
            raise ValueError("TOKEN_LENGTH_OUTSIDE_BOUNDS")
        limit = 88 if self.metadata["family"] == "voca" else 178
        if any(not isinstance(i, int) or not 0 <= i < limit for i in ids):
            raise ValueError("TOKEN_ID_OUTSIDE_VOCABULARY")
        vid = self.voices.index(voice)
        seed = self.metadata["default_seed"] if seed is None else seed
        if self.metadata["family"] == "kale":
            from .kale_inference import synthesize
            return synthesize(*self.models, ids, vid, self.metadata["vocabulary"], seed=seed)
        if self.metadata["family"] == "kale-en":
            from .kale_english_inference import synthesize
            if any(i not in self.metadata["vocabulary"]["vocab"].values() for i in ids):
                raise ValueError("TOKEN_ID_OUTSIDE_VOCABULARY")
            return synthesize(*self.models, ids, vid, seed=seed)
        model, = self.models
        stress = [0] * len(ids) if stress is None else stress
        if len(stress) != len(ids) or any(type(i) is not int or i not in (0, 1, 2) for i in stress):
            raise ValueError("INVALID_STRESS_PLAN")
        tokens = torch.tensor([ids], dtype=torch.long)
        wave, lengths, extra = model.synthesize(
            tokens, torch.tensor([stress], dtype=torch.long), torch.tensor([len(ids)]), torch.tensor([vid]), seed=seed)
        return wave[0, :int(lengths[0])].cpu(), {"durations": extra["durations"][0].tolist()}
