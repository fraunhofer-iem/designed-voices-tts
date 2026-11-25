"""Output marking: AI-generation metadata in WAV files (the default) and, as an option, an AudioSeal
watermark in the samples (docs/output-marking.md).

Modes: "metadata" (default): every exported WAV file carries RIFF LIST/INFO and XMP entries saying
that it is AI-generated speech and naming the generator; the samples are the model output.
"watermark": the samples also carry the AudioSeal watermark. "off": neither.

The watermark is computed at 16 kHz, the rate of the AudioSeal models, but the speech is never
resampled: the 24 kHz output is resampled down only to compute the watermark, and the watermark
itself is resampled up and added to the unchanged 24 kHz samples. The ONNX graphs of the marker
directory (``tools/export-marker.py``) contain both resampling steps; the browser runs the same files.

Detector, for anyone who wants to check a file::

    python -m designed_tts.mark detect FILE... [--marker DIRECTORY]

Each result is one JSON line: "metadata" (what the WAV metadata says, or null when it has none) and
"watermark" (score, decision and matching message bits, or null when no watermark model is given).
The watermark model is the marker directory from ``--marker`` or ``DESIGNED_TTS_MARKER``. WAV files
are read directly; other formats are decoded with ffmpeg when it is installed.
"""
import argparse
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

FORMAT = "designed-tts/marker/v1"
SAMPLE_RATE = 24000
WATERMARK_RATE = 16000
# mark.onnx takes a multiple of 480 samples at 24 kHz (320 at 16 kHz, the encoder hop); the caller
# pads with zeros and trims. detect.onnx takes a multiple of 320 samples at 16 kHz.
MARK_QUANTUM = 480
DETECT_QUANTUM = 320
# The detector finds the watermark at some sample offsets modulo the 320-sample hop and misses it at
# others (measured: a cut 80 samples off at 16 kHz drops the score to about 0.1). Detection therefore
# runs at four offsets, a quarter hop apart, and keeps the best; one of them is always near the
# offset the watermark was made at. docs/output-marking.md has the measurements.
DETECT_OFFSETS = (0, 80, 160, 240)
# The 16-bit message of this project: the ASCII letters "DV", most significant bit first.
MESSAGE = [int(bit) for bit in format(0x4456, "016b")]
# A sample counts as watermarked above this detector probability (AudioSeal's own rule); a file is
# reported as marked when at least SCORE_THRESHOLD of its samples are. See docs/output-marking.md.
DETECTION_THRESHOLD = 0.5
SCORE_THRESHOLD = 0.5
GENERATOR = "Designed Voices TTS"
DIGITAL_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"


MODES = ("metadata", "watermark", "off")


class MarkingError(ValueError):
    pass


def marking_mode(marking):
    """The marking mode; False means "off" and True "watermark" (the earlier boolean switch)."""
    mode = {False: "off", True: "watermark"}.get(marking, marking) if isinstance(marking, bool) else marking
    if mode not in MODES:
        raise MarkingError("UNKNOWN_MARKING_MODE: use one of " + ", ".join(MODES))
    return mode


class Resample(torch.nn.Module):
    """Windowed-sinc polyphase resampling, the rule of julius.ResampleFrac (MIT, A. Defossez).

    forward() is the export form: for a length that is a multiple of the reduced source rate it
    returns exactly length * new / old samples. resample() takes any length.
    """

    def __init__(self, old_sr, new_sr, zeros=24, rolloff=0.945):
        super().__init__()
        common = math.gcd(old_sr, new_sr)
        self.old, self.new = old_sr // common, new_sr // common
        cutoff = min(self.old, self.new) * rolloff
        self.width = math.ceil(zeros * self.old / cutoff)
        index = torch.arange(-self.width, self.width + self.old, dtype=torch.float64) / self.old
        kernels = []
        for phase in range(self.new):
            t = ((-phase / self.new + index) * cutoff).clamp(-zeros, zeros) * math.pi
            window = torch.cos(t / zeros / 2) ** 2
            sinc = torch.where(t == 0, torch.ones_like(t), torch.sin(t) / torch.where(t == 0, torch.ones_like(t), t))
            kernel = sinc * window
            kernels.append(kernel / kernel.sum())
        self.register_buffer("kernel", torch.stack(kernels).view(self.new, 1, -1).float())

    def frames(self, x):
        y = F.pad(x[:, None], (self.width, self.width + self.old), mode="replicate")
        return F.conv1d(y, self.kernel, stride=self.old)

    def forward(self, x):
        return self.frames(x)[..., :-1].transpose(1, 2).flatten(1)

    @torch.inference_mode()
    def resample(self, x):
        if self.old == self.new:
            return x
        return self.frames(x).transpose(1, 2).flatten(1)[..., :int(self.new * x.shape[-1] / self.old)]


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Marker:
    """The marker directory: mark.onnx, detect.onnx and marker.json, checked against their hashes."""

    def __init__(self, directory, threads=None):
        self.directory = Path(directory)
        config = self.directory / "marker.json"
        if not config.is_file():
            raise MarkingError("MARKER_UNAVAILABLE: no marker.json in " + str(self.directory))
        self.config = json.loads(config.read_text())
        if self.config.get("format") != FORMAT or self.config.get("message") != MESSAGE:
            raise MarkingError("UNSUPPORTED_MARKER_FORMAT")
        self.threads, self.sessions, self.verified = threads, {}, set()

    @classmethod
    def find(cls, marker=None):
        """A Marker, a marker directory, or DESIGNED_TTS_MARKER; never a silent fallback."""
        if isinstance(marker, Marker):
            return marker
        path = marker or os.environ.get("DESIGNED_TTS_MARKER")
        if not path:
            raise MarkingError("MARKER_UNAVAILABLE: output marking is on by default; pass marker=<directory> "
                               "or set DESIGNED_TTS_MARKER, or switch marking off with marking=False")
        return cls(path)

    def session(self, name):
        if name not in self.sessions:
            import onnxruntime
            path, expected = self.directory / name, self.config["files"][name]
            if path.stat().st_size != expected["bytes"] or _sha256(path) != expected["sha256"]:
                raise MarkingError("MARKER_INTEGRITY_FAILURE:" + name)
            options = onnxruntime.SessionOptions()
            if self.threads:
                options.intra_op_num_threads = self.threads
            self.sessions[name] = onnxruntime.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
        return self.sessions[name]

    def watermark(self, samples):
        """The watermark to add to 24 kHz float32 samples (one dimension)."""
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        if not audio.size or not np.isfinite(audio).all():
            raise MarkingError("INVALID_AUDIO_TO_MARK")
        padded = np.zeros((1, -(-audio.size // MARK_QUANTUM) * MARK_QUANTUM), dtype=np.float32)
        padded[0, :audio.size] = audio
        watermark = self.session("mark.onnx").run(None, {"audio": padded})[0][0, :audio.size]
        if not np.isfinite(watermark).all():
            raise MarkingError("INVALID_WATERMARK")
        return watermark

    def mark(self, samples):
        """Marked samples of the same type: numpy in, numpy out; a torch tensor in, a tensor out."""
        if isinstance(samples, torch.Tensor):
            audio = samples.detach().cpu().float()
            return audio + torch.from_numpy(self.watermark(audio.numpy())).view_as(audio)
        audio = np.asarray(samples, dtype=np.float32)
        return audio + self.watermark(audio).reshape(audio.shape)

    def detect(self, samples, sample_rate):
        """Score and decision for mono float samples at any rate."""
        audio = torch.as_tensor(np.asarray(samples, dtype=np.float32).reshape(1, -1))
        if audio.shape[1] < 1:
            raise MarkingError("EMPTY_AUDIO")
        audio = Resample(int(sample_rate), WATERMARK_RATE).resample(audio).numpy()
        valid = audio.shape[1]
        best = None
        for offset in DETECT_OFFSETS:
            padded = np.zeros((1, -(-(valid + offset) // DETECT_QUANTUM) * DETECT_QUANTUM), dtype=np.float32)
            padded[0, offset:offset + valid] = audio
            probability, bits = self.session("detect.onnx").run(None, {"audio": padded})
            score = float((probability[0, offset:offset + valid] > DETECTION_THRESHOLD).mean())
            if best is None or score > best[0]:
                best = score, [int(bit > 0.5) for bit in bits[0]]
        score, decoded = best
        return {"score": round(score, 4), "threshold": SCORE_THRESHOLD, "marked": score >= SCORE_THRESHOLD,
                "message_bits_matching": sum(a == b for a, b in zip(decoded, MESSAGE)), "seconds": round(valid / WATERMARK_RATE, 3)}

    def detect_file(self, path):
        samples, rate = read_audio(path)
        return {"file": str(path), "sample_rate": rate, **self.detect(samples, rate)}


def metadata(family=None, voice=None, watermark=False):
    """The two metadata chunks of exported WAV files: RIFF LIST/INFO and XMP (_PMX). The comment names
    the watermark only when the samples carry it."""
    model = " ".join(part for part in (family, voice) if part)
    comment = "AI-generated speech" + (" (" + model + ")" if model else "") + ", generated by " + GENERATOR + "." + \
        (" AudioSeal watermark, message DV." if watermark else "") + " Check: python -m designed_tts.mark detect"
    info = b""
    for tag, text in ((b"ISFT", GENERATOR), (b"ICMT", comment)):
        value = text.encode("ascii") + b"\0"
        info += tag + struct.pack("<I", len(value)) + value + (b"\0" if len(value) % 2 else b"")
    xmp = ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
           '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" '
           'xmlns:xmp="http://ns.adobe.com/xap/1.0/" Iptc4xmpExt:DigitalSourceType="' + DIGITAL_SOURCE_TYPE +
           '" xmp:CreatorTool="' + GENERATOR + '"/></rdf:RDF></x:xmpmeta>').encode("ascii")
    chunks = b"LIST" + struct.pack("<I", 4 + len(info)) + b"INFO" + info
    chunks += b"_PMX" + struct.pack("<I", len(xmp)) + xmp + (b"\0" if len(xmp) % 2 else b"")
    return chunks


def export_wav(samples, sample_rate=SAMPLE_RATE, *, family=None, voice=None, marking="metadata"):
    """The WAV file of an output as the browser app exports it: with the metadata chunks unless
    marking is "off". The samples are written as given (mark them first in the "watermark" mode)."""
    mode = marking_mode(marking)
    return wav_bytes(samples, sample_rate, b"" if mode == "off" else metadata(family, voice, mode == "watermark"))


def read_metadata(data):
    """What the metadata chunks of a WAV file say, or None when it has none."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    at, info, xmp = 12, {}, None
    while at + 8 <= len(data):
        tag, size = data[at:at + 4], struct.unpack("<I", data[at + 4:at + 8])[0]
        body = data[at + 8:at + 8 + size]
        if tag == b"LIST" and body[:4] == b"INFO":
            sub = 4
            while sub + 8 <= len(body):
                key, length = body[sub:sub + 4].decode("latin1"), struct.unpack("<I", body[sub + 4:sub + 8])[0]
                info[key] = body[sub + 8:sub + 8 + length].rstrip(b"\0").decode("utf-8", "replace")
                sub += 8 + length + (length % 2)
        elif tag == b"_PMX":
            xmp = body.decode("utf-8", "replace")
        at += 8 + size + (size % 2)
    if not info and xmp is None:
        return None
    import re
    source = re.search(r'DigitalSourceType="([^"]*)"', xmp or "")
    tool = re.search(r'CreatorTool="([^"]*)"', xmp or "")
    source = source.group(1) if source else None
    return {"ai_generated": source == DIGITAL_SOURCE_TYPE or "AI-generated" in info.get("ICMT", ""),
            "generator": info.get("ISFT") or (tool.group(1) if tool else None), "comment": info.get("ICMT"),
            "digital_source_type": source}


def wav_bytes(samples, sample_rate=SAMPLE_RATE, chunks=b""):
    """16-bit mono WAV, the rule of the browser: attenuate only to avoid clipping; chunks after the data."""
    audio = np.asarray(samples, dtype=np.float32).reshape(-1).astype(np.float64)
    peak = max(float(np.abs(audio).max(initial=0.0)), 0.0001)
    gain = min(1.0, 0.97 / peak)
    pcm = np.floor(np.clip(audio * gain, -1, 1) * 32767 + 0.5).astype("<i2").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm) + len(chunks)) + b"WAVEfmt " + \
        struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm + chunks


def read_wav(data):
    """Mono float samples and rate of a PCM (8, 16, 24, 32 bit) or IEEE float WAV; channels are averaged."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise MarkingError("NOT_A_WAV_FILE")
    at, fmt, payload, chunks = 12, None, None, {}
    while at + 8 <= len(data):
        tag, size = data[at:at + 4], struct.unpack("<I", data[at + 4:at + 8])[0]
        body = data[at + 8:at + 8 + size]
        chunks[tag] = body
        if tag == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif tag == b"data":
            payload = body
        at += 8 + size + (size % 2)
    if fmt is None or payload is None:
        raise MarkingError("INCOMPLETE_WAV_FILE")
    code, channels, rate, _, align, bits = fmt
    if code == 0xFFFE and len(chunks[b"fmt "]) >= 26:
        code = struct.unpack("<H", chunks[b"fmt "][24:26])[0]
    frames = len(payload) // align
    raw = payload[:frames * align]
    if code == 3 and bits in (32, 64):
        audio = np.frombuffer(raw, dtype="<f4" if bits == 32 else "<f8").astype(np.float32)
    elif code == 1 and bits == 8:
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif code == 1 and bits == 16:
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    elif code == 1 and bits == 24:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        audio = (((b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)) ^ 0x800000) - 0x800000).astype(np.float32) / 8388608
    elif code == 1 and bits == 32:
        audio = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648
    else:
        raise MarkingError("UNSUPPORTED_WAV_ENCODING")
    return audio.reshape(-1, channels).mean(1), rate


def read_audio(path):
    data = Path(path).read_bytes()
    if data[:4] == b"RIFF":
        return read_wav(data)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise MarkingError("NOT_A_WAV_FILE: install ffmpeg to check other formats")
    rate = _ffmpeg_rate(path)
    decoded = subprocess.run([ffmpeg, "-v", "error", "-i", str(path), "-ac", "1", "-f", "f32le", "-"],
                             check=True, capture_output=True).stdout
    return np.frombuffer(decoded, dtype="<f4"), rate


def _ffmpeg_rate(path):
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise MarkingError("FFPROBE_UNAVAILABLE")
    out = subprocess.run([ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate",
                          "-of", "csv=p=0", str(path)], check=True, capture_output=True, text=True).stdout
    return int(out.strip())


def check_file(path, marker=None):
    """Metadata and, with a marker, the watermark of one file."""
    data = Path(path).read_bytes()
    result = {"file": str(path), "metadata": read_metadata(data), "watermark": None}
    if marker is not None:
        samples, rate = read_audio(path)
        result["watermark"] = {"sample_rate": rate, **marker.detect(samples, rate)}
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m designed_tts.mark", description="Check audio files for the marking of Designed Voices TTS.")
    sub = parser.add_subparsers(dest="command", required=True)
    detect = sub.add_parser("detect", help="report metadata and, with a watermark model, the watermark score; one JSON line per file")
    detect.add_argument("files", nargs="+", type=Path)
    detect.add_argument("--marker", help="watermark model directory (default: DESIGNED_TTS_MARKER; without one only metadata is read)")
    args = parser.parse_args(argv)
    path = args.marker or os.environ.get("DESIGNED_TTS_MARKER")
    marker = Marker(path) if path else None
    failed = False
    for path in args.files:
        try:
            print(json.dumps(check_file(path, marker)))
        except (MarkingError, OSError, subprocess.CalledProcessError) as error:
            failed = True
            print(json.dumps({"file": str(path), "error": str(error)}))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
