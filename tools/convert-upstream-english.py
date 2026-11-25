"""Convert the pinned public English Kale TTS 1 Nano download into a portable release directory.

Reads the download as data only. Run with `python -I -B` from this repository, never from the
download directory:  ... tools/convert-upstream-english.py --source <download> --out <new directory>
"""
import argparse
import json
from pathlib import Path

from designed_tts.checkpoint import convert_upstream_english

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    metadata = convert_upstream_english(args.source, args.out)
    print(json.dumps({"family": metadata["family"], "voices": metadata["vocabulary"]["voices"], "weights": metadata["weights"]}))
