"""Blind listening pairs for the owner: marked against unmarked, same sentence and voice.

  uv run --python 3.12 python -I -B tools/marking-listening-pairs.py --capture <capture dir> \
      --bucket <datatinder data root>/tts-output-marking --key <private key file>

Four pairs per family and speech language of configuration C (German Kale, English Kale, Voca64 German,
Voca64 English), each with another voice: 16 pairs. Both sides are plain 16-bit WAV files (no metadata
chunks, so file size and tags tell nothing), under random names; which side is marked is written only
to --key, outside the bucket. The bucket is a datatinder project (tasks.jsonl and assets/). Nobody has
listened when this runs; the ratings are the owner's.
"""
import argparse
import json
import secrets
from pathlib import Path

import numpy as np

from designed_tts.mark import wav_bytes

GROUPS = (("kale", "de"), ("kale-fresh-en", "en"), ("voca64", "de"), ("voca64", "en"))
CONTEXT = ("Same sentence, same voice, two versions. Pick the one that sounds cleaner. "
           "Tie = no difference heard; both bad = both have the same artefact.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--bucket", type=Path, required=True)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--per-group", type=int, default=4)
    args = parser.parse_args()
    if args.bucket.exists() or args.key.exists():
        raise SystemExit("bucket and key must not exist yet")
    index = [json.loads(line) for line in (args.capture / "index.jsonl").read_text().splitlines()]
    (args.bucket / "assets").mkdir(parents=True)
    tasks, key = [], []
    for family, lang in GROUPS:
        items = [i for i in index if i["family"] == family and i["lang"] == lang and i["speed"] == 1]
        chosen, voices = [], set()
        # Alternate female and male voices, one output per voice.
        for gender in "fmfmfmfm":
            for item in items:
                code = item["voice"].split("-")[2]
                if item["voice"] not in voices and code[0] == gender:
                    chosen.append(item)
                    voices.add(item["voice"])
                    break
            if len(chosen) == args.per_group:
                break
        for item in chosen:
            names = {}
            for side in ("marked", "unmarked"):
                samples = np.fromfile(args.capture / f"{item['id']}.{side}.f32", dtype="<f4")
                names[side] = secrets.token_hex(7) + ".wav"
                (args.bucket / "assets" / names[side]).write_bytes(wav_bytes(samples))
            order = ["marked", "unmarked"] if secrets.randbits(1) else ["unmarked", "marked"]
            task = "m" + secrets.token_hex(3)
            tasks.append({"id": task, "context": CONTEXT, "meta": {},
                          "variants": [{"id": "a", "asset": names[order[0]]}, {"id": "b", "asset": names[order[1]]}]})
            key.append({"task": task, "a": order[0], "b": order[1], "output": item["id"], "family": family, "lang": lang,
                        "voice": item["voice"], "textId": item["textId"]})
    order = list(range(len(tasks)))
    secrets.SystemRandom().shuffle(order)
    (args.bucket / "tasks.jsonl").write_text("".join(json.dumps(tasks[i]) + "\n" for i in order))
    args.key.parent.mkdir(parents=True, exist_ok=True)
    args.key.write_text(json.dumps({"bucket": args.bucket.name, "pairs": key}, indent=1) + "\n")
    print(json.dumps({"pairs": len(tasks), "bucket": str(args.bucket), "key": str(args.key)}))
