"""Export the AudioSeal watermark generator and detector as CPU-WASM ONNX graphs.

  uv run --python 3.12 --extra export --extra marker-export python -I -B tools/export-marker.py \
      --generator <download>/generator_base.pth --detector <download>/detector_base.pth --out <new dir>

Inputs are the checkpoints of facebook/audioseal at the pinned Hub revision below (MIT licence for
code and weights). They are pickles: they are loaded with torch.load(weights_only=True) and an
allowlist of the omegaconf classes of their stored configuration, never with arbitrary unpickling,
and only after their SHA-256 matches. Run this file from this repository, never from the download.

mark.onnx takes 24 kHz audio [1, N], N a multiple of 480, and returns the watermark [1, N] to add.
Inside the graph: windowed-sinc resampling to 16 kHz, the AudioSeal generator with the fixed
16-bit message of this project, and the same resampling of the watermark back to 24 kHz. The
speech above 8 kHz is never resampled or removed: only the residual passes through 16 kHz.
detect.onnx takes 16 kHz audio [1, M], M a multiple of 320, and returns the per-sample
probability that the sample is watermarked and the 16 message-bit probabilities.
"""
import os
# SEANet of the AudioSeal package compiles its forward lazily; export and reference run eager.
os.environ["NO_TORCH_COMPILE"] = "1"
import argparse
import collections
import contextlib
import copy
import hashlib
import json
import math
import typing
from pathlib import Path

import numpy as np
import onnx
import onnxruntime
import torch
from torch.nn import functional as F

from designed_tts.mark import MESSAGE, Resample, MARK_QUANTUM, DETECT_QUANTUM, DETECT_OFFSETS, DETECTION_THRESHOLD, SCORE_THRESHOLD

HUB_REVISION = "3c19eba53390776cf2cc9ed5f6c9ac67ce72ecba"
PINNED = {"generator_base.pth": "7a845b5fbe9364a63a3909d8ab3fe064d13a76ae4c2e983573e08c69b7b51748",
          "detector_base.pth": "8a78e8a83584113523e161fc599fcab10fd0e94c04d2eb9d2fa1e9ec91ab69d9"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def checkpoint(path):
    if sha256(path) != PINNED[Path(path).name]:
        raise ValueError("MARKER_SOURCE_INTEGRITY_FAILURE:" + str(path))
    from omegaconf.base import ContainerMetadata, Metadata
    from omegaconf.dictconfig import DictConfig
    from omegaconf.listconfig import ListConfig
    from omegaconf.nodes import AnyNode
    allowed = [Metadata, ContainerMetadata, ListConfig, DictConfig, AnyNode, list, int, dict, typing.Any,
               collections.defaultdict]
    with torch.serialization.safe_globals(allowed):
        return torch.load(path, map_location="cpu", weights_only=True)


@contextlib.contextmanager
def export_friendly():
    """Three shape computations of the package code become constants of a traced graph. The graphs take
    lengths that are a multiple of the encoder hop (320 samples at 16 kHz); for those the extra
    padding of every strided convolution is zero and the slices below are the package's slices."""
    from audioseal.libs.moshi.modules import conv, seanet

    def unpad1d(x, paddings):
        left, right = paddings
        return x[..., left:-right] if right else x[..., left:]

    def keep_dimension(self, x):
        # The reverse convolution returns hop * frames samples, the input length for a multiple of the hop.
        return self.reverse_convolution(self.model(x))
    saved = conv.get_extra_padding_for_conv1d, conv.unpad1d, seanet.SEANetEncoderKeepDimension.forward
    conv.get_extra_padding_for_conv1d = lambda x, kernel_size, stride, padding_total=0: 0
    conv.unpad1d = unpad1d
    seanet.SEANetEncoderKeepDimension.forward = keep_dimension
    try:
        yield
    finally:
        conv.get_extra_padding_for_conv1d, conv.unpad1d, seanet.SEANetEncoderKeepDimension.forward = saved


def build(kind, path):
    from audioseal import builder, loader
    from audioseal.models import AudioSealDetector, AudioSealWM
    card = "audioseal_wm_16bits" if kind == "generator" else "audioseal_detector_16bits"
    config = loader.load_local_model_config(card)
    from omegaconf import OmegaConf
    config = OmegaConf.to_container(config)
    config.pop("checkpoint")
    stored = checkpoint(path)
    config = {**stored["xp.cfg"], **config}
    if kind == "generator":
        parsed = loader.AudioSeal.parse_config(config, config_type=builder.AudioSealWMConfig, nbits=16)
        model = builder.create_generator(parsed)
        assert isinstance(model, AudioSealWM)
    else:
        parsed = loader.AudioSeal.parse_config(config, config_type=builder.AudioSealDetectorConfig, nbits=16)
        model = builder.create_detector(parsed)
        assert isinstance(model, AudioSealDetector)
    state = loader.convert_state_dict_for_scriptable_model(stored["model"])
    loader.load_state_dict(model, state)
    if model.normalizer is not None:
        raise ValueError("UNEXPECTED_MARKER_NORMALIZER")
    return model.eval()


class Polyphase(torch.nn.Module):
    """ConvTranspose1d with kernel 2 * stride as an ordinary Conv1d (kernel 2) and an interleave.

    y[:, o, j*s + p] = W[:, o, p] . x[:, j] + W[:, o, p + s] . x[:, j - 1] + b[o]: the same sums as the
    transposed convolution in another order, so the result equals it up to float rounding. Used by the
    `polyphase` marker variant because ConvTranspose is the slowest operator of the generator.
    """

    def __init__(self, convtr):
        super().__init__()
        weight, s = convtr.weight.detach(), convtr.stride[0]
        assert convtr.kernel_size[0] == 2 * s and convtr.groups == 1 and convtr.padding[0] == 0 and convtr.dilation[0] == 1
        cin, cout, _ = weight.shape
        kernel = torch.stack((weight[:, :, s:], weight[:, :, :s]), dim=-1)  # [in, out, s, 2]: tap 0 = x[j-1], tap 1 = x[j]
        self.register_buffer("kernel", kernel.permute(2, 1, 0, 3).reshape(s * cout, cin, 2).contiguous())
        self.register_buffer("bias", convtr.bias.detach().repeat(s))
        self.step, self.out = s, cout
        # Read by the package's StreamingConvTranspose1d to compute its trim.
        self.kernel_size, self.stride, self.padding, self.dilation = (2 * s,), (s,), (0,), (1,)

    def forward(self, x):
        z = F.conv1d(F.pad(x, (1, 1)), self.kernel, self.bias)  # [B, s * out, L + 1]
        return z.unflatten(1, (self.step, self.out)).permute(0, 2, 3, 1).flatten(2)


def polyphase(module):
    """Replace every transposed convolution of a module by Polyphase; returns how many."""
    count = 0
    for name, child in list(module.named_children()):
        if isinstance(child, torch.nn.ConvTranspose1d) and child.kernel_size[0] == 2 * child.stride[0]:
            setattr(module, name, Polyphase(child))
            count += 1
        else:
            count += polyphase(child)
    return count


def reduce_storage(source, destination, storage, keep):
    """A smaller copy of a graph: float tensors stored as half floats, or conv weights as int8 with one
    half-float scale per output channel (the rest half floats). The graph expands every stored tensor to
    float32 itself (Cast, DequantizeLinear); inputs, outputs and arithmetic stay float32. keep: tensors
    left as they are (the resampling kernels)."""
    from onnx import TensorProto, helper, numpy_helper
    model = onnx.load(str(source))
    graph, added, counts = model.graph, [], {"int8": 0, "float16": 0, "kept": 0}
    lstm_weights = {node.input[i] for node in graph.node if node.op_type == "LSTM" for i in (1, 2)}
    for init in list(graph.initializer):
        w = numpy_helper.to_array(init)
        if w.dtype != np.float32 or w.size < 64:
            continue
        if any(w.shape == k.shape and np.array_equal(w, k) for k in keep):
            counts["kept"] += 1
            continue
        name = init.name
        graph.initializer.remove(init)
        if storage == "int8" and w.ndim == 3 and w.size >= 1024 and name not in lstm_weights:
            scale = np.abs(w).reshape(w.shape[0], -1).max(1) / 127
            scale[scale == 0] = 1
            scale = scale.astype(np.float16).astype(np.float32)
            q = np.clip(np.round(w / scale[:, None, None]), -127, 127).astype(np.int8)
            graph.initializer.extend([numpy_helper.from_array(q, name + "_q"), numpy_helper.from_array(scale.astype(np.float16), name + "_s16"),
                                      numpy_helper.from_array(np.zeros(len(scale), np.int8), name + "_z")])
            added += [helper.make_node("Cast", [name + "_s16"], [name + "_s"], to=TensorProto.FLOAT),
                      helper.make_node("DequantizeLinear", [name + "_q", name + "_s", name + "_z"], [name], axis=0)]
            counts["int8"] += 1
        else:
            graph.initializer.append(numpy_helper.from_array(w.astype(np.float16), name + "_16"))
            added.append(helper.make_node("Cast", [name + "_16"], [name], to=TensorProto.FLOAT))
            counts["float16"] += 1
    for node in reversed(added):
        graph.node.insert(0, node)
    onnx.checker.check_model(model)
    onnx.save(model, str(destination))
    return counts


class Mark(torch.nn.Module):
    """24 kHz audio in, 24 kHz watermark out; the message is a constant of the graph."""

    def __init__(self, generator, message):
        super().__init__()
        self.encoder, self.decoder = generator.encoder, generator.decoder
        bits = torch.tensor(message, dtype=torch.long)
        with torch.no_grad():
            aux = generator.msg_processor.msg_processor(2 * torch.arange(len(message)) + bits).sum(0)
        self.register_buffer("aux", aux.view(1, -1, 1))
        self.down, self.up = Resample(24000, 16000), Resample(16000, 24000)

    def forward(self, audio):
        x = self.down(audio)[:, None]
        watermark = self.decoder(self.encoder(x) + self.aux)[..., :x.shape[-1]]
        return self.up(watermark[:, 0])


class Detect(torch.nn.Module):
    def __init__(self, detector):
        super().__init__()
        self.detector = detector.detector

    def forward(self, audio):
        result = self.detector(audio[:, None])
        probability = torch.softmax(result[:, :2], dim=1)[:, 1]
        return probability, torch.sigmoid(result[:, 2:].mean(-1))


def export(model, example, path, outputs):
    torch.onnx.export(model, (example,), str(path), input_names=["audio"], output_names=outputs,
                      dynamic_axes={"audio": {1: "samples"}, **{name: {1: "samples"} for name in outputs[:1]}},
                      opset_version=17, dynamo=False, do_constant_folding=True)
    onnx.checker.check_model(str(path))


@torch.inference_mode()
def qualify(generator, detector, mark_path, detect_path):
    """The graphs against the unmodified eager AudioSeal modules at lengths the export example did not have."""
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    mark = onnxruntime.InferenceSession(str(mark_path), options, providers=["CPUExecutionProvider"])
    detect = onnxruntime.InferenceSession(str(detect_path), options, providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(20261125)
    rows = []
    down, up = Resample(24000, 16000), Resample(16000, 24000)
    for n in (480, 4800, 24000 * 3 + 480 * 7, 24000 * 11 + 480):
        audio = (0.1 * rng.standard_normal((1, n))).astype(np.float32)
        onnx_wm = mark.run(None, {"audio": audio})[0]
        x = down(torch.from_numpy(audio))[:, None]
        reference16 = generator.get_watermark(x, message=torch.tensor([MESSAGE]))
        reference = up(reference16[:, 0]).numpy()
        peak = float(np.abs(onnx_wm - reference).max() / max(np.abs(reference).max(), 1e-12))
        marked = audio + onnx_wm
        marked16 = down(torch.from_numpy(marked)).numpy()
        probability, bits = detect.run(None, {"audio": marked16})
        eager_result, eager_bits = detector(torch.from_numpy(marked16)[:, None])
        detect_peak = float(np.abs(probability - eager_result[:, 1].numpy()).max())
        rows.append({"samples": n, "mark_shape": list(onnx_wm.shape), "mark_peak_relative": peak,
                     "detect_peak": detect_peak, "score": float((probability > DETECTION_THRESHOLD).mean()),
                     "bits": "".join(str(int(b > 0.5)) for b in bits[0])})
        if onnx_wm.shape != audio.shape or peak > 1e-3 or detect_peak > 1e-3:
            raise ValueError("MARKER_EXPORT_PARITY_FAILURE:" + json.dumps(rows[-1]))
    return rows


def storage_difference(mark_a, mark_b, detect_a, detect_b):
    sessions = [onnxruntime.InferenceSession(str(p), providers=["CPUExecutionProvider"]) for p in (mark_a, mark_b, detect_a, detect_b)]
    audio = (0.1 * np.random.default_rng(7).standard_normal((1, 24000 * 4))).astype(np.float32)
    a, b = (s.run(None, {"audio": audio})[0] for s in sessions[:2])
    x = Resample(24000, 16000)(torch.from_numpy(audio + a)).numpy()
    p, q = (s.run(None, {"audio": x})[0] for s in sessions[2:])
    return {"watermark_peak_relative": float(np.abs(a - b).max() / np.abs(a).max()),
            "watermark_snr_db": float(10 * np.log10(np.sum(a.astype(np.float64) ** 2) / np.sum((a - b).astype(np.float64) ** 2))),
            "detector_probability_peak": float(np.abs(p - q).max())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--generator", type=Path, required=True)
    parser.add_argument("--detector", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    # Qualification variants (docs/output-marking.md); the defaults are the served marker.
    parser.add_argument("--polyphase", action="store_true", help="transposed convolutions of the generator as Conv1d")
    parser.add_argument("--mark-storage", choices=("float32", "float16", "int8"), default="float32")
    parser.add_argument("--detect-storage", choices=("float32", "float16", "int8"), default="float32")
    args = parser.parse_args()
    torch.manual_seed(0)
    torch.set_num_threads(1)
    generator, detector = build("generator", args.generator), build("detector", args.detector)
    args.out.mkdir(parents=True, exist_ok=False)
    mark_path, detect_path = args.out / "mark.onnx", args.out / "detect.onnx"
    variant = {"polyphase": args.polyphase, "mark_storage": args.mark_storage, "detect_storage": args.detect_storage}
    reduced = args.mark_storage != "float32" or args.detect_storage != "float32"
    mark_float, detect_float = (args.out / "mark.float32.onnx", args.out / "detect.float32.onnx") if reduced else (mark_path, detect_path)
    with export_friendly():
        marker = Mark(generator, MESSAGE).eval()
        if args.polyphase:
            # A copy: the qualification compares against the unmodified generator.
            marker = copy.deepcopy(marker)
            variant["polyphase_layers"] = polyphase(marker.decoder)
        export(marker, torch.zeros(1, 24000 * 2), mark_float, ["watermark"])
        export(Detect(detector).eval(), torch.zeros(1, 16000 * 2), detect_float, ["probability", "bits"])
    rows = qualify(generator, detector, mark_float, detect_float)
    if reduced:
        # The reduced copies against the float32 graphs of the same export; the gate is the detection table.
        keep = [marker.down.kernel.numpy(), marker.up.kernel.numpy()]
        variant["tensors"] = {"mark.onnx": reduce_storage(mark_float, mark_path, args.mark_storage, keep),
                              "detect.onnx": reduce_storage(detect_float, detect_path, args.detect_storage, keep)}
        variant["difference_to_float32"] = storage_difference(mark_float, mark_path, detect_float, detect_path)
        mark_float.unlink()
        detect_float.unlink()
    import audioseal
    config = {"format": "designed-tts/marker/v1", "method": "AudioSeal 16-bit (audioseal_wm_16bits, audioseal_detector_16bits)",
              "sample_rate": 24000, "watermark_rate": 16000, "mark_quantum": MARK_QUANTUM, "detect_quantum": DETECT_QUANTUM, "detect_offsets": list(DETECT_OFFSETS),
              "message": MESSAGE, "detection_threshold": DETECTION_THRESHOLD, "score_threshold": SCORE_THRESHOLD,
              "resampler": "windowed sinc, 24 zero crossings, rolloff 0.945, Hann-squared window (julius ResampleFrac rule)",
              "files": {name: {"bytes": (args.out / name).stat().st_size, "sha256": sha256(args.out / name)} for name in ("mark.onnx", "detect.onnx")},
              "source": {"repository": "https://huggingface.co/facebook/audioseal", "revision": HUB_REVISION, "licence": "MIT (code and weights)",
                         "files": PINNED, "package": "audioseal " + audioseal.__version__,
                         "code_repository": "https://github.com/facebookresearch/audioseal", "code_revision": "1496f7662d6aa625602bb0dcd1b4997b63b47609"},
              "generators": ["torch " + torch.__version__, "onnx " + onnx.__version__ + ", opset 17", "onnxruntime " + onnxruntime.__version__],
              "qualification": rows, **({"variant": variant} if any((args.polyphase, reduced)) else {})}
    (args.out / "marker.json").write_text(json.dumps(config, indent=1) + "\n")
    print(json.dumps({k: config[k] for k in ("files", "qualification")}, indent=1))
