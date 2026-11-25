"""Export one portable release directory to split browser graphs, optionally with a reduced-precision copy.

  ... python -I -B tools/export-browser.py --release <release>/kale-en --out <new dir> [--reduced <new dir> [--parts wave] [--storage sound-int8]]

--parts names the graphs of the reduced copy that are reduced (default plan,wave); the others are the float32 files.
--storage is int8 (default, the rule of upstream's CPU file), sound-int8 (the same, text side float32) or
sound-float16 (half floats in the sound generator only).
--from-export reduces an existing float32 export instead of exporting again.
"""
import argparse
import json
from pathlib import Path

from designed_tts.browser_export import export_release, reduce_release

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", type=Path)
    parser.add_argument("--from-export", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--reduced", type=Path)
    parser.add_argument("--parts", default="plan,wave")
    parser.add_argument("--storage", choices=("int8", "sound-int8", "sound-float16"), default="int8")
    args = parser.parse_args()
    if (args.release is None) == (args.from_export is None) or (args.release is None) != (args.out is None):
        parser.error("give --release with --out, or --from-export with --reduced")
    result = {"float": export_release(args.release, args.out)} if args.release else {}
    if args.reduced:
        result["reduced"] = reduce_release(args.out or args.from_export, args.reduced, tuple(args.parts.split(",")), args.storage)
    print(json.dumps(result, indent=1))
