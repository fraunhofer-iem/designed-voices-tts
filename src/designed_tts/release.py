"""Portable, checksum-verified CPU loaders; no pickle or network at inference."""
import hashlib
import json
from pathlib import Path

import torch
from safetensors.torch import load_file

FORMAT = "designed-tts/model/v1"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_release(directory):
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
    elif family == "kale":
        if any(not key.startswith(("text.", "audio.")) for key in tensors):
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
    else:
        raise ValueError("UNSUPPORTED_MODEL_FAMILY")
    return Release(metadata, models)


class Release:
    def __init__(self, metadata, models):
        self.metadata, self.models = metadata, models

    @property
    def voices(self):
        if self.metadata["family"] == "voca":
            return self.metadata["config"]["speakers"]
        return self.metadata["vocabulary"]["voices"]

    @torch.inference_mode()
    def synthesize(self, ids, voice, *, stress=None, seed=None):
        """Validated phoneme-plan input, not a hidden text frontend or cloning API."""
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
        model, = self.models
        stress = [0] * len(ids) if stress is None else stress
        if len(stress) != len(ids) or any(type(i) is not int or i not in (0, 1, 2) for i in stress):
            raise ValueError("INVALID_STRESS_PLAN")
        tokens = torch.tensor([ids], dtype=torch.long)
        wave, lengths, extra = model.synthesize(
            tokens, torch.tensor([stress], dtype=torch.long), torch.tensor([len(ids)]), torch.tensor([vid]), seed=seed)
        return wave[0, :int(lengths[0])].cpu(), {"durations": extra["durations"][0].tolist()}
