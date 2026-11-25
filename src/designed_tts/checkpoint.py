"""One-way, allowlisted conversion of checksum-pinned training checkpoints."""
import json
import struct
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


# Public English Kale TTS 1 Nano, shipped with unchanged weights. Every input file is pinned.
UPSTREAM_ENGLISH = {
    "repository": "KaleComputer/kale-tts-1-nano",
    "revision": "b6ce1887268c3667994fc3b0b2c82887c069915c",
    "files": {
        "pytorch/nano/student_text_side_flt.pt": "17e53cd240ef15b1ffadf25b5ac17fe9c10cb35cdea2309a025408cc5348ddcc",
        "pytorch/nano/sound_side_flrd.pt": "97786fd704865fdc15b695eb9bb0bd902d42e02994b202b92f51915b50a658fd",
        "voices.json": "b4ceadf14b655bc39d1fbb76571a5ad46007585e8883af8a9962cae6b2b83669",
        "tokenizer.json": "61188314434d9972e42677fb71dba9e19aa8698e980541b1c06a1f9f16086e60",
        "voices/s057b.extra.bin": "35c0e00f2c3500914c791a21af160a4058f3ee30a00cbd0c29941d2503210e89",
        "voices/f06.extra.bin": "942559c27e4e8ea0d371a1d022ac65561b0e8754e8d12c16231f52026e1d3fea",
        "voices/w165.extra.bin": "d1eef8616667f68f4254aa4d955fdc4fb424ea9d73db6661fd02c2cea45e5258",
        "voices/w602.extra.bin": "490375c1b576a69c7fea5089cb97d70e74e53e6afb05a216ff04bf5901bffbb3",
        "voices/m3.extra.bin": "89a0e683a5027278ca7f2ba4aafe8a22e8f0038bc4cc0d34c859f028a2272b7d",
        "voices/t071.extra.bin": "f4951a1399ce8ba81491df1378ae39c7b6417d661b82c563f138ec81aecf5101",
        "voices/x328.extra.bin": "e8fa93b6e16ec168e29e685d72e53d171ec468b9045f8d16705c584cd5d5dedc",
        "voices/h013f.extra.bin": "a64252df624e57a5a55c037a41316939df348f65b3e52dea582940e17a1cee94",
    },
    # Our id, upstream id, upstream name, sex as upstream documents it. American voices only:
    # Amy (d03) and Jack (d13) were trained on British phone ids, which our frontend does not produce.
    "roster": [
        ("kale-en-f01", "s057b", "Kenzie", "female"), ("kale-en-f02", "f06", "Simone", "female"),
        ("kale-en-f03", "w165", "Frankie", "female"), ("kale-en-f04", "w602", "Darlene", "female"),
        ("kale-en-m01", "m3", "Owen", "male"), ("kale-en-m02", "t071", "Toby", "male"),
        ("kale-en-m03", "x328", "Earl", "male"), ("kale-en-m04", "h013f", "Magnus", "male"),
    ],
}
VOICE_SCALARS = {"voice_pitch_floor": "pitch_floor", "voice_clamp_thr": "clamp_threshold",
                 "voice_clamp_tail": "clamp_tail", "voice_unvoice_hz": "unvoice"}


def convert_upstream_english(source, destination, *, pins=UPSTREAM_ENGLISH):
    """Unchanged public network tensors plus the released rows and inference values of eight voices.

    The checkpoint voice tables hold ten rows; upstream releases them rounded through half floats
    in voices/<id>.extra.bin and feeds those to its graphs. The released rows are used here.
    """
    source, destination = Path(source), Path(destination)
    for name, expected in pins["files"].items():
        if digest(source / name) != expected:
            raise ValueError("SOURCE_CHECKPOINT_INTEGRITY_FAILURE")
    text = torch.load(source / "pytorch/nano/student_text_side_flt.pt", map_location="cpu", weights_only=True)
    audio = torch.load(source / "pytorch/nano/sound_side_flrd.pt", map_location="cpu", weights_only=True)
    declared = json.loads((source / "voices.json").read_text())
    order = list(text["voices"])
    listed = {v["id"]: v for v in declared["voices"]}
    if declared.get("phonemes") != "kokoro-native" or order != list(listed) or (text["width"], audio["size"]) != ("r2", "r2"):
        raise ValueError("UNSUPPORTED_UPSTREAM_ENGLISH_ABI")
    layout = [(item["name"], item["dims"]) for item in declared["voice_inputs"]]
    rows, roster = {name: [] for name, _ in layout}, []
    for ours, upstream, name, sex in pins["roster"]:
        entry = listed[upstream]
        if entry["name"] != name or entry["accent"] != "en-us":
            raise ValueError("UNSUPPORTED_UPSTREAM_ENGLISH_ABI")
        raw = (source / f"voices/{upstream}.extra.bin").read_bytes()
        values = list(struct.unpack(f"<{len(raw) // 4}f", raw))
        for key, dims in layout:
            count = 1
            for size in dims:
                count *= size
            rows[key].append(values[:count])
            values = values[count:]
        if values or rows["voice_prosody"][-1] != rows["voice_prosody_col"][-1]:
            raise ValueError("UNSUPPORTED_UPSTREAM_ENGLISH_ABI")
        roster.append({"id": ours, "upstream_id": upstream, "name": name, "sex": sex, "accent": "en-us",
                       "upstream_row": order.index(upstream)})
    tensors = {f"text.{key}": value for key, value in text["model"].items()}
    tensors.update({f"audio.{key}": value for key, value in audio["model"].items()})
    public = {"text.pstyle": torch.tensor(rows["voice_prosody"]), "audio.style": torch.tensor(rows["voice_sound"])}
    for key, value in public.items():
        kept = tensors[key][[entry["upstream_row"] for entry in roster]]
        # Half-float rounding of the checkpoint rows; anything larger is a different voice table.
        if value.shape != kept.shape or (value - kept).abs().max() > 2e-4:
            raise ValueError("VOICE_ROWS_DIFFER_FROM_CHECKPOINT")
        tensors[key] = value
    for key, short in VOICE_SCALARS.items():
        tensors[f"voice.{short}"] = torch.tensor(rows[key]).reshape(len(roster))
    if any(not isinstance(t, torch.Tensor) or not torch.isfinite(t).all() for t in tensors.values()):
        raise ValueError("INVALID_MODEL_TENSORS")
    vocab = json.loads((source / "tokenizer.json").read_text())["model"]["vocab"]
    metadata = {"format": FORMAT, "family": "kale-en", "sample_rate": 24000,
                "source": {"repository": pins["repository"], "revision": pins["revision"], "files": pins["files"],
                           "training_steps": {"text": text["step"], "audio": audio["step"]},
                           "voice_rows": "released voices/<id>.extra.bin of the eight American voices"},
                "vocabulary": {"version": "kokoro-native-en-us", "vocab": vocab, "voices": [entry["id"] for entry in roster],
                               "duration_hop": 600, "prosody_hop": 300, "sample_rate": 24000},
                "roster": roster,
                "inference": {"minimum_frames_per_token": 1, "end_clamp": "per voice", "unvoice_floor": "per voice",
                              "teacher_inputs": False},
                "default_seed": 20261120}
    destination.mkdir(parents=True, exist_ok=False)
    weights = destination / "model.safetensors"
    save_file({key: value.detach().cpu().contiguous().clone() for key, value in tensors.items()}, str(weights))
    metadata["weights"] = {"file": weights.name, "bytes": weights.stat().st_size, "sha256": digest(weights)}
    (destination / "config.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    return metadata
