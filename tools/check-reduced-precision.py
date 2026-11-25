"""Reduced-precision Kale graphs (either Kale family) against the float32 export of the same weights.

Bar (upstream's for its int8 CPU file, here without its one-frame allowance): the same length on
every case and a log-mel distance of at most 0.20 on every case, with the same noise on both sides.
Writes browser fixtures whose reference is the reduced graph on CPU ONNX Runtime; --model is the
directory name of the reduced graphs under the root that tools/check-export-browser.mjs serves.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from designed_tts.release import digest


def logmel(y, n=1024, h=256):
    """recipe/export/export_check.py of KaleComputer/kale-tts-1-tiny (Apache-2.0)."""
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(y, (n // 2, n // 2)), n)[::h] * np.hanning(n)
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    fr = np.fft.rfftfreq(n, 1 / 24000)
    mel = lambda f: 2595 * np.log10(1 + f / 700)  # noqa: E731
    edges = np.linspace(mel(0), mel(12000), 82)
    hz = 700 * (10 ** (edges / 2595) - 1)
    bank = np.stack([np.clip(np.minimum((fr - hz[i]) / (hz[i + 1] - hz[i] + 1e-9), (hz[i + 2] - fr) / (hz[i + 2] - hz[i + 1] + 1e-9)), 0, None) for i in range(80)])
    return np.log(power @ bank.T + 1e-5)


def sessions(directory):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    return [ort.InferenceSession(str(directory / f"{part}.onnx"), options, providers=["CPUExecutionProvider"]) for part in ("plan", "wave")]


def render(pair, ids, voice, seed, durations=None):
    tokens, vid = np.array([ids], np.int64), np.array([voice], np.int64)
    hidden, style, encoded, planned = pair[0].run(None, {"tokens": tokens, "voice": vid})
    counts = planned[0] if durations is None else np.asarray(durations)
    frames = int(counts.sum())
    alignment = np.zeros((1, len(ids), frames), np.float32)
    alignment[0, np.repeat(np.arange(len(ids)), counts), np.arange(frames)] = 1
    noise = torch.randn(1, frames * 600, generator=torch.Generator().manual_seed(seed)).numpy()
    audio = pair[1].run(None, {"hidden": hidden, "style": style, "encoded": encoded, "alignment": alignment, "voice": vid, "noise": noise})[0].reshape(-1)
    return planned[0].tolist(), audio


def qualify(reference, reduced, cases, duration_cases, output, voices, model="kale-en"):
    output.mkdir(parents=True, exist_ok=False)
    meta = json.loads((reduced / "config.json").read_text())
    seed = meta["default_seed"]
    names = meta["vocabulary"]["voices"]
    a, b = sessions(reference), sessions(reduced)
    rows, fixtures = [], []
    for number, case in enumerate(cases):
        voice = names.index(case["voice"])
        d0, y0 = render(a, case["ids"], voice, seed)
        d1, y1 = render(b, case["ids"], voice, seed)
        row = {"id": case["id"], "voice": case["voice"], "tokens": len(case["ids"]), "frames": sum(d0), "durations_identical": d0 == d1,
               "same_length": y0.size == y1.size, "finite": bool(np.isfinite(y1).all())}
        if row["same_length"]:
            error = ((y0.astype(np.float64) - y1) ** 2).sum()
            row["snr_db"] = float(10 * np.log10((y0.astype(np.float64) ** 2).sum() / max(error, 1e-30)))
            row["logmel_l1"] = float(np.abs(logmel(y0) - logmel(y1)).mean())
        row["ok"] = bool(row["same_length"] and row["finite"] and row.get("logmel_l1", 9) <= 0.20)
        rows.append(row)
        if case.get("browser"):
            filename = f"{model}-{number}-reduced-cpu.f32"
            y1.astype("<f4").tofile(output / filename)
            fixtures.append({"model": model, "id": case["id"], "tokens": case["ids"], "stress": [0] * len(case["ids"]), "voice": voice, "durations": d1, "reference": filename})
        print(json.dumps(row), flush=True)
    # Planner only, on a larger set: do the reduced graphs ever plan a different length?
    plans = {"cases": 0, "durations_identical": 0, "same_frames": 0, "differences": []}
    for case in duration_cases:
        for voice in range(len(names)) if voices == "all" else [names.index(case["voice"])]:
            feed = {"tokens": np.array([case["ids"]], np.int64), "voice": np.array([voice], np.int64)}
            d0, d1 = a[0].run(None, feed)[3][0], b[0].run(None, feed)[3][0]
            plans["cases"] += 1
            plans["durations_identical"] += int((d0 == d1).all())
            plans["same_frames"] += int(d0.sum() == d1.sum())
            if d0.sum() != d1.sum():
                plans["differences"].append({"id": case["id"], "voice": names[voice], "frames": [int(d0.sum()), int(d1.sum())]})
    measured = [r for r in rows if "logmel_l1" in r]
    summary = {"bar": "same length on every case and log-mel L1 <= 0.20 on every case, same noise, float32 export as reference",
               "cases": len(rows), "same_length": sum(r["same_length"] for r in rows), "durations_identical": sum(r["durations_identical"] for r in rows),
               "logmel_l1_median": float(np.median([r["logmel_l1"] for r in measured])) if measured else None,
               "logmel_l1_max": max((r["logmel_l1"] for r in measured), default=None),
               "snr_db_median": float(np.median([r["snr_db"] for r in measured])) if measured else None,
               "snr_db_min": min((r["snr_db"] for r in measured), default=None),
               "planner_only": plans,
               "graphs": {kind: {part: {"bytes": (root / f"{part}.onnx").stat().st_size, "sha256": digest(root / f"{part}.onnx")} for part in ("plan", "wave")}
                          for kind, root in (("float32", reference), ("reduced", reduced))},
               "onnxruntime": ort.__version__}
    summary["ok"] = bool(rows and all(r["ok"] for r in rows) and plans["same_frames"] == plans["cases"])
    (output / "REDUCED-PRECISION.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=1) + "\n")
    (output / "fixtures.json").write_text(json.dumps(fixtures, indent=2) + "\n")
    print(json.dumps(summary, indent=1))
    return summary["ok"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--float", type=Path, required=True, dest="reference")
    parser.add_argument("--reduced", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--duration-cases", type=Path)
    parser.add_argument("--duration-voices", choices=("all", "listed"), default="all")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="kale-en")
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text())["cases"]
    more = json.loads(args.duration_cases.read_text())["cases"] if args.duration_cases else []
    raise SystemExit(0 if qualify(args.reference, args.reduced, cases, more, args.output, args.duration_voices, args.model) else 1)
