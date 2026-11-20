"""One-way, allowlisted conversion of checksum-pinned training checkpoints."""
import json
from pathlib import Path

import torch
from safetensors.torch import save_file

from .release import FORMAT, digest

VOCABULARY_FIELDS = (
    "version", "vocab", "phones", "punctuation", "stress_ids", "required_ids", "voices",
    "duration_hop", "prosody_hop", "sample_rate", "pYIN_source_hop", "source_tokenizer_sha256",
)


def convert(checkpoint, destination, *, family, expected_sha256):
    checkpoint, destination = Path(checkpoint), Path(destination)
    if len(expected_sha256) != 64 or digest(checkpoint) != expected_sha256:
        raise ValueError("SOURCE_CHECKPOINT_INTEGRITY_FAILURE")
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    metadata = {"format": FORMAT, "family": family, "sample_rate": 24000,
                "source_checkpoint_sha256": expected_sha256}
    if family == "voca":
        tensors = state["model"]
        metadata.update(config=state["config"], training_steps=state["step"], default_seed=20261119)
    elif family == "kale":
        if state["f0_floor_hz"] != 25. or state["teacher_acoustic_inputs_at_inference"]:
            raise ValueError("UNSUPPORTED_KALE_INFERENCE_ABI")
        tensors = {f"{part}.{key}": value for part in ("text", "audio") for key, value in state[part].items()}
        metadata.update(vocabulary={key: state["vocabulary"][key] for key in VOCABULARY_FIELDS},
                        training_steps=state["steps"], f0_floor_hz=25., default_seed=20261120)
    else:
        raise ValueError("UNSUPPORTED_MODEL_FAMILY")
    if not tensors or any(not isinstance(t, torch.Tensor) or not torch.isfinite(t).all() for t in tensors.values()):
        raise ValueError("INVALID_MODEL_TENSORS")
    destination.mkdir(parents=True, exist_ok=False)
    weights = destination / "model.safetensors"
    save_file({key: value.detach().cpu().contiguous().clone() for key, value in tensors.items()}, str(weights))
    metadata["weights"] = {"file": weights.name, "bytes": weights.stat().st_size, "sha256": digest(weights)}
    (destination / "config.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    return metadata
