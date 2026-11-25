"""Upload a verified package to an existing static Space, without creating a Gradio repo."""
import argparse
import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import HfApi

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("package", type=Path)
parser.add_argument("--repo", default="Fraunhofer-IEM/designed-voices-tts")
parser.add_argument("--message", required=True, help="commit subject describing this release")
parser.add_argument("--description", default="", help="commit body; the Source-Commit trailer is appended")
args = parser.parse_args()
root = args.package.resolve()
inventory = json.loads((root / "PACKAGE.json").read_text())
for item in inventory["files"]:
    path = (root / item["path"]).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Invalid package path")
    body = path.read_bytes()
    if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
        raise ValueError(f"Package changed: {item['path']}")
# The published Space marks its outputs (docs/output-marking.md): metadata (the default) or metadata
# with the watermark. A build with marking off is for deployments of others, not for this Space.
manifest = json.loads((root / "manifest.json").read_text())
mode = manifest.get("marking", {}).get("mode")
if inventory.get("marking") not in ("metadata", "watermark") or mode != inventory["marking"] \
        or (mode == "watermark" and not {"marker.mark.onnx", "marker.detect.onnx"} <= set(manifest["assets"])):
    raise ValueError("The published Space must be built with output marking (metadata or watermark), not off")
api = HfApi(endpoint="https://huggingface.co", token=os.environ["HF_TOKEN"])
info = api.space_info(args.repo)
if info.sdk != "static" or info.private:
    raise ValueError("Expected the existing public static Space")
result = api.upload_folder(
    repo_id=args.repo,
    repo_type="space",
    folder_path=root,
    parent_commit=info.sha,
    commit_message=args.message,
    commit_description=(args.description + "\n\n" if args.description else "") + f"Source-Commit: {inventory['sourceCommit']}",
)
print(json.dumps({"repo": args.repo, "commit": result.oid, "url": result.commit_url}))
