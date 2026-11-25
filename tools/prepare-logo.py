# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow==12.0.0", "numpy==2.2.6"]
# ///
"""Convert the official JPEG's white matte to alpha without resizing or cropping."""
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image

source = Path("web/brand/fraunhofer-iem.jpg")
target = source.with_suffix(".png")
if hashlib.sha256(source.read_bytes()).hexdigest() != "c3282d3f67c0b6ae189278b29628c6af2a90ad4e0451882670500566f2ea1138":
    raise ValueError("Unexpected institute logo source")
image = Image.open(source).convert("RGB")
rgb = np.asarray(image, dtype=np.float32) / 255
alpha = 1 - rgb.min(axis=2)
# Discard near-white JPEG noise; unmatte edges rather than leaving a white halo.
alpha[alpha < 8 / 255] = 0
foreground = np.divide(
    rgb - (1 - alpha[..., None]),
    alpha[..., None],
    out=np.zeros_like(rgb),
    where=alpha[..., None] > 0,
)
rgba = np.rint(np.clip(np.dstack((foreground, alpha)), 0, 1) * 255).astype(np.uint8)
assert rgba.shape[:2] == (825, 3000)
assert all(rgba[y, x, 3] == 0 for y, x in [(0, 0), (0, -1), (-1, 0), (-1, -1)])
Image.fromarray(rgba).save(target, optimize=True)
print(target, target.stat().st_size, hashlib.sha256(target.read_bytes()).hexdigest())
