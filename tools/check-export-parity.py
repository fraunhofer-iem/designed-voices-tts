"""Prepare native/split/ORT parity receipts and browser fixtures; no source writes."""
import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from designed_tts.browser_export import VocaPlan, VocaWave, KalePlan, KaleWave, KaleEnglishPlan, KaleEnglishWave
from designed_tts.release import load_release, digest
from designed_tts.vendor.kale.onnx import strip
from designed_tts.vendor.voca.text import SYMBOLS


def metrics(actual, reference):
    if actual.shape != reference.shape:
        return {"ok": False, "shape": list(actual.shape), "reference_shape": list(reference.shape)}
    error = actual.astype(np.float64) - reference
    peak = float(np.max(np.abs(reference)))
    return {"maxabs": float(np.max(np.abs(error))), "peak": peak,
            "peak_relative": float(np.max(np.abs(error)) / max(peak, 1e-30)),
            "relative_l2": float(np.linalg.norm(error) / max(np.linalg.norm(reference.astype(np.float64)), 1e-30)),
            "samples": int(actual.size), "finite": bool(np.isfinite(actual).all())}


def qualify(releases, exports, inputs, output, models=("voca64", "kale")):
    torch.set_num_threads(4)
    output.mkdir(parents=True, exist_ok=False)
    cache = {r["text"]: r for r in map(json.loads, (inputs / "phony-cache.jsonl").read_text().splitlines())} if set(models) & {"voca64", "kale"} else {}
    receipt = {"scope": "Fixed cached phoneme plans; native source versus split rewrite and CPU ONNX; browser evaluated separately", "gates": {"rewrite_peak_relative": .01, "onnx_peak_relative": .02, "relative_l2": .01, "durations": "exact", "samples": "exact"}, "phase_policy": {"voca64": "upstream export frame-local float32 and Q24 inter-frame phase", "kale": "unchanged upstream float64 frame-rate cumulative phase; plain CPU-WASM, not JSEP", "kale-en": "as kale"}, "models": {}}
    fixtures = []
    for name in models:
        release = load_release(releases / name, marking=False)  # parity is measured on the unmarked model output
        family = release.metadata["family"]
        listed = name not in ("voca64", "kale")
        if listed:
            # Token ids as the browser sends them (<directory>-cases.json): the English upstream family and
            # the English fit of the German family type. Every listed case is gated.
            selected = [{**r, "lang": "en", "normalized": None} for r in json.loads((inputs / f"{name}-cases.json").read_text())["cases"]]
        else:
            rows = json.loads((inputs / f"{name}-listen.json").read_text())["rows"]
            # Two languages and both sexes for Voca; every German Kale voice.
            voices = [release.voices[i] for i in ([0, 16, 32, 48] if name == "voca64" else range(4))]
            selected = [next(r for r in rows if r["voice"] == voice and r["tag"] == "plain") for voice in voices]
        if name == "voca64":
            model, = release.models
            plan, wave = VocaPlan(model).eval(), VocaWave(model, True).eval()
        elif family == "kale-en":
            text, audio, values = release.models
            strip(text); strip(audio)
            plan, wave = KaleEnglishPlan(text, audio).eval(), KaleEnglishWave(text, audio, values).eval()
        else:
            text, audio = release.models
            strip(text); strip(audio)
            plan, wave = KalePlan(text, audio, release.metadata["vocabulary"]).eval(), KaleWave(text, audio).eval()
        options = ort.SessionOptions(); options.intra_op_num_threads = 1
        sessions = [ort.InferenceSession(str(exports / name / f"{part}.onnx"), options, providers=["CPUExecutionProvider"]) for part in ("plan", "wave")]
        info = {"native_config_sha256": digest(releases / name / "config.json"), "native_weights_sha256": release.metadata["weights"]["sha256"], "seed": release.metadata["default_seed"], "assets": {p.name: {"bytes": p.stat().st_size, "sha256": digest(p)} for p in (exports / name).iterdir() if p.is_file()}, "graph_inputs": {part: [{"name": i.name, "type": i.type, "shape": i.shape} for i in session.get_inputs()] for part, session in zip(("plan", "wave"), sessions)}, "cases": []}
        receipt["models"][name] = info
        for number, row in enumerate(selected):
            phonemes = {"stress": [0] * len(row["ids"])} if listed else cache[row["normalized"]]
            ids = [SYMBOLS.index(s) for s in phonemes["symbols"]] if name == "voca64" else row["ids"]
            stress = phonemes["stress"]
            tokens = torch.tensor([ids]); voice = torch.tensor([release.voices.index(row["voice"])]); stresses = torch.tensor([stress])
            reference, extra = release.synthesize(ids, row["voice"], stress=stress)
            with torch.inference_mode():
                predicted = plan(tokens, stresses, voice) if name == "voca64" else plan(tokens, voice)
                durations = predicted[-1]
                frames = int(durations.sum())
                hop = 256 if name == "voca64" else 600
                noise = torch.randn(1, frames * hop, generator=torch.Generator().manual_seed(release.metadata["default_seed"]))
                if name == "voca64":
                    rewritten = wave(tokens, voice, predicted[0], durations, noise)
                else:
                    alignment = torch.nn.functional.one_hot(torch.repeat_interleave(torch.arange(len(ids)), durations[0]), num_classes=len(ids)).T.float()[None]
                    rewritten = wave(*predicted[:3], alignment, voice, noise)
            planner = {"tokens": tokens.numpy(), "voice": voice.numpy()}
            if name == "voca64": planner["stress"] = stresses.numpy()
            planned = dict(zip([i.name for i in sessions[0].get_outputs()], sessions[0].run(None, planner)))
            waveform = {**planned, "voice": voice.numpy(), "noise": noise.numpy()}
            if name == "voca64": waveform["tokens"] = tokens.numpy()
            else:
                waveform.pop("durations")
                waveform["alignment"] = alignment.numpy()
            actual = sessions[1].run(None, waveform)[0].reshape(-1)
            native = reference.numpy().reshape(-1)
            rewrite_metrics, onnx_metrics = metrics(rewritten.numpy().reshape(-1), native), metrics(actual, native)
            exact = durations[0].tolist() == extra["durations"] == planned["durations"][0].tolist()
            ok = exact and rewrite_metrics.get("finite", False) and onnx_metrics.get("finite", False) and rewrite_metrics["peak_relative"] <= .01 and onnx_metrics["peak_relative"] <= .02 and rewrite_metrics["relative_l2"] <= .01 and onnx_metrics["relative_l2"] <= .01
            case = {"id": row["id"], "voice_index": int(voice[0]), "language": row["lang"], "frames": frames, "durations_exact": exact, "rewrite": rewrite_metrics, "onnx_cpu": onnx_metrics, "ok": ok}
            info["cases"].append(case)
            if row.get("browser", True):
                filename = f"{name}-{number}-native.f32"
                native.astype("<f4").tofile(output / filename)
                fixtures.append({"model": name, "id": row["id"], "tokens": ids, "stress": stress, "voice": int(voice[0]), "durations": extra["durations"], "reference": filename})
            print(json.dumps(case), flush=True)
        (output / "NATIVE-ONNX.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (output / "fixtures.json").write_text(json.dumps(fixtures, indent=2) + "\n")
    receipt["ok"] = all(c["ok"] for m in receipt["models"].values() for c in m["cases"])
    (output / "NATIVE-ONNX.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt["ok"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--releases", type=Path, required=True)
    parser.add_argument("--exports", type=Path, required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", default="voca64,kale")
    args = parser.parse_args()
    raise SystemExit(0 if qualify(args.releases, args.exports, args.inputs, args.output, tuple(args.models.split(","))) else 1)
