"""Detection, robustness and objective audibility measures of the output marking. Silent: nothing is played.

  uv run --python 3.12 python -I -B tools/evaluate-marking.py --capture <capture dir> --marker <marker dir> \
      --out <new dir> [--human <dir of real speech WAVs> --human-count 200]

--capture is the output of tools/capture-marking-eval.mjs (page outputs, unmarked and marked).
Transformations use ffmpeg (MP3 128 and 64 kbit/s with libmp3lame, resampling to 16 and 44.1 kHz) and
numpy (gain, white noise at 30 dB SNR, trimming at both ends, at a random start sample and a
1-second excerpt), all applied to the page's 16-bit WAV export and, for
the false-positive rate, to the 16-bit WAV of the unmarked model output. The detector is the Python
one (designed_tts.mark, the same detect.onnx as the page). Writes RESULT.json and TABLE.md.
"""
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from designed_tts.mark import Marker, read_wav, wav_bytes

RATE = 24000


def logmel(y, n=1024, h=256):
    """The log-mel measure of tools/check-reduced-precision.py (recipe/export/export_check.py, Kale, Apache-2.0)."""
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(y, (n // 2, n // 2)), n)[::h] * np.hanning(n)
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    fr = np.fft.rfftfreq(n, 1 / RATE)
    mel = lambda f: 2595 * np.log10(1 + f / 700)  # noqa: E731
    edges = np.linspace(mel(0), mel(12000), 82)
    hz = 700 * (10 ** (edges / 2595) - 1)
    bank = np.stack([np.clip(np.minimum((fr - hz[i]) / (hz[i + 1] - hz[i] + 1e-9), (hz[i + 2] - fr) / (hz[i + 2] - hz[i + 1] + 1e-9)), 0, None) for i in range(80)])
    return np.log(power @ bank.T + 1e-5)


def band_energy(y, low, high):
    spectrum = np.abs(np.fft.rfft(y)) ** 2
    f = np.fft.rfftfreq(len(y), 1 / RATE)
    return float(spectrum[(f >= low) & (f < high)].sum())


def ffmpeg(data, *codec, rate=None, fmt="wav"):
    with tempfile.TemporaryDirectory() as tmp:
        source, middle, back = Path(tmp) / "in.wav", Path(tmp) / ("mid." + fmt), Path(tmp) / "out.wav"
        source.write_bytes(data)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), *codec, *(["-ar", str(rate)] if rate else []), str(middle)], check=True)
        if fmt == "wav":
            return read_wav(middle.read_bytes())
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(middle), "-c:a", "pcm_s16le", str(back)], check=True)
        return read_wav(back.read_bytes())


def transforms(data, seed):
    """(name, samples, rate) for one 16-bit WAV file."""
    audio, rate = read_wav(data)
    rng = np.random.default_rng(seed)
    yield "none", audio, rate
    yield "mp3-128k", *ffmpeg(data, "-c:a", "libmp3lame", "-b:a", "128k", fmt="mp3")
    yield "mp3-64k", *ffmpeg(data, "-c:a", "libmp3lame", "-b:a", "64k", fmt="mp3")
    yield "resample-16k", *ffmpeg(data, "-c:a", "pcm_s16le", rate=16000)
    yield "resample-44.1k", *ffmpeg(data, "-c:a", "pcm_s16le", rate=44100)
    yield "gain-6dB", audio * 10 ** (-6 / 20), rate
    yield "gain+6dB-clipped", np.clip(audio * 10 ** (6 / 20), -1, 1), rate
    power = float(np.mean(audio ** 2))
    yield "noise-30dB", audio + rng.standard_normal(audio.size).astype(np.float32) * np.sqrt(power / 10 ** 3), rate
    cut = int(0.5 * rate)
    if audio.size > 2 * cut + rate:
        yield "trim-0.5s-both-ends", audio[cut:-cut], rate
    shift = int(rng.integers(1, cut))
    if audio.size > shift + rate:
        yield "trim-start-random", audio[shift:], rate
    if audio.size >= 2 * rate:
        start = (audio.size - rate) // 2
        yield "excerpt-1s", audio[start:start + rate], rate


def rate_of(rows):
    return {"n": len(rows), "positive": sum(r["marked"] for r in rows), "rate": round(sum(r["marked"] for r in rows) / len(rows), 4) if rows else None,
            "score_min": min((r["score"] for r in rows), default=None), "score_max": max((r["score"] for r in rows), default=None),
            "score_median": float(np.median([r["score"] for r in rows])) if rows else None,
            "all_16_bits": sum(r["message_bits_matching"] == 16 for r in rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--marker", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--human", type=Path)
    parser.add_argument("--human-count", type=int, default=200)
    # A marker variant with the served detector: the false-positive side depends on the detector only,
    # so --sides marked evaluates the marked outputs alone.
    parser.add_argument("--sides", choices=("both", "marked"), default="both")
    args = parser.parse_args()
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required for the MP3 and resampling transformations")
    args.out.mkdir(parents=True, exist_ok=False)
    marker = Marker(args.marker)
    index = [json.loads(line) for line in (args.capture / "index.jsonl").read_text().splitlines()]
    detections, audibility, parity = [], [], []
    for n, item in enumerate(index):
        unmarked = np.fromfile(args.capture / (item["id"] + ".unmarked.f32"), dtype="<f4")
        marked = np.fromfile(args.capture / (item["id"] + ".marked.f32"), dtype="<f4")
        page_wav = (args.capture / (item["id"] + ".wav")).read_bytes()
        residual = marked - unmarked
        audibility.append({"id": item["id"], "family": item["family"], "lang": item["lang"],
                           "snr_db": float(10 * np.log10(np.sum(unmarked.astype(np.float64) ** 2) / np.sum(residual.astype(np.float64) ** 2))),
                           "logmel_l1": float(np.abs(logmel(marked) - logmel(unmarked)).mean()),
                           "residual_above_8k_share": band_energy(residual, 8000, 12000) / max(band_energy(residual, 0, 12000), 1e-30),
                           "speech_above_8k_ratio": band_energy(marked, 8000, 12000) / max(band_energy(unmarked, 8000, 12000), 1e-30)})
        # Native marking (onnxruntime CPU) of the page's unmarked output against the page's marked output
        # (onnxruntime-web CPU WASM); one segment, since the page marks every segment on its own.
        if item["chunks"] == 1:
            native = marker.mark(unmarked)
            parity.append({"id": item["id"], "peak_relative": float(np.abs(native - marked).max() / max(np.abs(residual).max(), 1e-12))})
        for label, data in (("marked", page_wav), ("unmarked", wav_bytes(unmarked)))[:2 if args.sides == "both" else 1]:
            for name, samples, rate in transforms(data, seed=n):
                result = marker.detect(samples, rate)
                detections.append({"id": item["id"], "family": item["family"], "lang": item["lang"], "voice": item["voice"], "speed": item["speed"],
                                   "source": label, "transform": name, **result})
        if n % 20 == 0:
            print(n + 1, "/", len(index), flush=True)
    human = []
    if args.human:
        files = sorted(args.human.rglob("*.wav"))[:args.human_count]
        for n, path in enumerate(files):
            audio, rate = read_wav(path.read_bytes())
            # The same transformations, starting from a 16-bit WAV at the file's own rate.
            data = wav_bytes(audio, rate)
            for name, samples, r in transforms(data, seed=10_000 + n):
                human.append({"file": path.name, "transform": name, **marker.detect(samples, r)})
    names = list(dict.fromkeys(d["transform"] for d in detections))
    table = {name: {"tpr": rate_of([d for d in detections if d["transform"] == name and d["source"] == "marked"]),
                    **({"fpr_unmarked_outputs": rate_of([d for d in detections if d["transform"] == name and d["source"] == "unmarked"])} if args.sides == "both" else {}),
                    **({"fpr_human_speech": rate_of([h for h in human if h["transform"] == name])} if human else {})} for name in names}
    families = sorted({d["family"] for d in detections})
    per_family = {f: {"voices": len({d["voice"] for d in detections if d["family"] == f}),
                      "tpr_none": rate_of([d for d in detections if d["family"] == f and d["source"] == "marked" and d["transform"] == "none"]),
                      **({"fpr_none": rate_of([d for d in detections if d["family"] == f and d["source"] == "unmarked" and d["transform"] == "none"])} if args.sides == "both" else {})} for f in families}
    voices_missed = sorted({d["voice"] for d in detections if d["source"] == "marked" and d["transform"] == "none" and not d["marked"]})
    snr = [a["snr_db"] for a in audibility]
    summary = {"outputs": len(index), "families": per_family, "voices_missed_untransformed": voices_missed, "transforms": table,
               "audibility": {"snr_db_min": min(snr), "snr_db_median": float(np.median(snr)), "snr_db_max": max(snr),
                              "logmel_l1_median": float(np.median([a["logmel_l1"] for a in audibility])), "logmel_l1_max": max(a["logmel_l1"] for a in audibility),
                              "residual_above_8k_share_max": max(a["residual_above_8k_share"] for a in audibility),
                              "speech_above_8k_ratio_min": min(a["speech_above_8k_ratio"] for a in audibility),
                              "speech_above_8k_ratio_max": max(a["speech_above_8k_ratio"] for a in audibility)},
               "native_vs_page_marking": {"outputs": len(parity), "peak_relative_max": max((p["peak_relative"] for p in parity), default=None)},
               "human": {"files": len({h["file"] for h in human})} if human else None,
               "marker": {name: marker.config["files"][name]["sha256"] for name in ("mark.onnx", "detect.onnx")}, "sides": args.sides}
    (args.out / "RESULT.json").write_text(json.dumps({"summary": summary, "audibility": audibility, "parity": parity, "detections": detections, "human": human}, indent=1) + "\n")
    both = args.sides == "both"
    lines = ["| Transformation | TPR marked outputs |" + (" FPR unmarked outputs |" if both else "") + (" FPR human speech |" if human else ""),
             "| --- | --- |" + (" --- |" if both else "") + (" --- |" if human else "")]
    cell = lambda r: f"{r['positive']}/{r['n']} ({100 * r['rate']:.1f} %), score median {r['score_median']:.3f}"  # noqa: E731
    for name, row in table.items():
        lines.append(f"| {name} | {cell(row['tpr'])} |" + (f" {cell(row['fpr_unmarked_outputs'])} |" if both else "") + (f" {cell(row['fpr_human_speech'])} |" if human else ""))
    (args.out / "TABLE.md").write_text("\n".join(lines) + "\n")
    print(json.dumps(summary, indent=1))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
