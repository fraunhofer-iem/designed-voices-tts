import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
import onnx
from onnx import TensorProto, helper
import torch

from designed_tts import mark
from designed_tts.checkpoint import convert
from designed_tts.release import digest, load_release
from designed_tts.vendor.voca.config import Config
from designed_tts.vendor.voca.model import TinyVoca

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "wav-metadata.json").read_text())


def stand_in_marker(directory, scale=0.01):
    """A marker directory with the interface of the real one: watermark = scale * audio (not AudioSeal)."""
    directory.mkdir()
    graph = helper.make_graph([helper.make_node("Mul", ["audio", "scale"], ["watermark"])], "stand-in",
                              [helper.make_tensor_value_info("audio", TensorProto.FLOAT, [1, "samples"])],
                              [helper.make_tensor_value_info("watermark", TensorProto.FLOAT, [1, "samples"])],
                              [helper.make_tensor("scale", TensorProto.FLOAT, [], [scale])])
    onnx.save(helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=8), directory / "mark.onnx")
    (directory / "detect.onnx").write_bytes(b"not used here")
    files = {name: {"bytes": (directory / name).stat().st_size, "sha256": digest(directory / name)} for name in ("mark.onnx", "detect.onnx")}
    (directory / "marker.json").write_text(json.dumps({"format": mark.FORMAT, "message": mark.MESSAGE, "files": files}))
    return directory


class MarkingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(4)
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        model = TinyVoca(Config(speakers=("synthetic-fixture",))).eval()
        source = root / "synthetic.pt"
        torch.save({"config": model.config.to_dict(), "step": 0, "model": model.state_dict()}, source)
        convert(source, root / "release", family="voca", expected_sha256=digest(source))
        cls.release, cls.marker = root / "release", stand_in_marker(root / "marker")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_metadata_is_the_default_and_the_watermark_is_never_silently_off(self):
        environment = os.environ.pop("DESIGNED_TTS_MARKER", None)
        try:
            default = load_release(self.release)
            self.assertEqual(default.marking, "metadata")
            with self.assertRaisesRegex(mark.MarkingError, "MARKER_UNAVAILABLE"):
                load_release(self.release, marking="watermark")
        finally:
            if environment is not None:
                os.environ["DESIGNED_TTS_MARKER"] = environment
        marked = load_release(self.release, marking="watermark", marker=self.marker)
        raw = load_release(self.release, marking=False)
        ids = [1, 22, 40, 2]
        # The default writes the model output with the metadata chunks.
        data, extra = default.synthesize_wav(ids, "synthetic-fixture")
        self.assertFalse(extra["marked"])
        self.assertTrue(mark.read_metadata(data)["ai_generated"])
        self.assertNotIn(b"AudioSeal", data[data.index(b"LIST"):])
        self.assertEqual(data[:44 + 2 * len(default.synthesize(ids, "synthetic-fixture")[0])][44:],
                         mark.wav_bytes(raw.synthesize(ids, "synthetic-fixture")[0].numpy())[44:])
        self.assertIsNone(mark.read_metadata(raw.synthesize_wav(ids, "synthetic-fixture")[0]))
        self.assertIn(b"AudioSeal watermark", marked.synthesize_wav(ids, "synthetic-fixture")[0])
        with self.assertRaisesRegex(mark.MarkingError, "UNKNOWN_MARKING_MODE"):
            load_release(self.release, marking="loud")
        wave, extra = marked.synthesize(ids, "synthetic-fixture")
        plain, plain_extra = raw.synthesize(ids, "synthetic-fixture")
        unmarked, _ = marked.synthesize(ids, "synthetic-fixture", marked=False)
        self.assertTrue(extra["marked"] and not plain_extra["marked"])
        # The model output stays available unchanged; the marked output is output plus watermark.
        self.assertTrue(torch.equal(plain, unmarked))
        self.assertTrue(torch.equal(wave, unmarked + unmarked * np.float32(0.01)))
        self.assertTrue(torch.equal(marked.synthesize_unmarked(ids, "synthetic-fixture")[0], plain))
        with self.assertRaisesRegex(mark.MarkingError, "WATERMARK_OFF"):
            raw.synthesize(ids, "synthetic-fixture", marked=True)
        with self.assertRaisesRegex(ValueError, "MARKER_GIVEN_WITHOUT_WATERMARK"):
            load_release(self.release, marking=False, marker=self.marker)

    def test_environment_names_the_marker(self):
        previous = os.environ.get("DESIGNED_TTS_MARKER")
        os.environ["DESIGNED_TTS_MARKER"] = str(self.marker)
        try:
            self.assertIsNotNone(load_release(self.release, marking="watermark").marker)
        finally:
            if previous is None:
                del os.environ["DESIGNED_TTS_MARKER"]
            else:
                os.environ["DESIGNED_TTS_MARKER"] = previous

    def test_changed_marker_file_fails_before_any_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = stand_in_marker(Path(tmp) / "marker")
            (directory / "mark.onnx").write_bytes((directory / "mark.onnx").read_bytes() + b"\0")
            release = load_release(self.release, marking="watermark", marker=directory)
            with self.assertRaisesRegex(mark.MarkingError, "MARKER_INTEGRITY_FAILURE"):
                release.synthesize([1, 22, 40, 2], "synthetic-fixture")
            with self.assertRaisesRegex(mark.MarkingError, "MARKER_UNAVAILABLE"):
                mark.Marker(Path(tmp) / "missing")

    def test_watermark_input_is_padded_to_the_quantum_and_trimmed(self):
        marker = mark.Marker(self.marker)
        for n in (1, 479, 480, 481, 24001):
            audio = np.linspace(-0.5, 0.5, n, dtype=np.float32)
            self.assertEqual(marker.watermark(audio).shape, (n,))
            np.testing.assert_array_equal(marker.mark(audio), audio + audio * np.float32(0.01))
        with self.assertRaisesRegex(mark.MarkingError, "INVALID_AUDIO_TO_MARK"):
            marker.watermark(np.array([np.nan], dtype=np.float32))

    def test_wav_and_metadata_bytes_equal_the_browser(self):
        i = np.arange(1001)
        samples = (np.sin(i * 0.05) * 1.2 * np.where(i % 7 == 0, -1, 1)).astype(np.float32)
        chunks = mark.metadata(FIXTURE["family"], FIXTURE["voice"])
        sha = lambda b: hashlib.sha256(b).hexdigest()  # noqa: E731
        self.assertEqual(sha(chunks), FIXTURE["metadataSha256"])
        self.assertEqual(sha(mark.metadata(FIXTURE["family"], FIXTURE["voice"], watermark=True)), FIXTURE["watermarkMetadataSha256"])
        self.assertEqual(sha(mark.export_wav(samples, family=FIXTURE["family"], voice=FIXTURE["voice"])), FIXTURE["wavSha256"])
        self.assertEqual(sha(mark.wav_bytes(samples, 24000, chunks)), FIXTURE["wavSha256"])
        self.assertEqual(sha(mark.wav_bytes(samples, 24000)), FIXTURE["plainWavSha256"])
        self.assertIn(b"trainedAlgorithmicMedia", chunks)
        import xml.etree.ElementTree as ElementTree
        start = chunks.index(b"_PMX") + 8
        packet = ElementTree.fromstring(chunks[start:start + int.from_bytes(chunks[start - 4:start], "little")])
        description = packet.find(".//{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Description")
        self.assertEqual(description.get("{http://iptc.org/std/Iptc4xmpExt/2008-02-29/}DigitalSourceType"), mark.DIGITAL_SOURCE_TYPE)
        self.assertNotIn(b"\xc3", chunks)  # ASCII only, nothing of an entered text

    def test_wav_reader_reads_written_and_float_files(self):
        samples = np.linspace(-0.9, 0.9, 2401, dtype=np.float32)
        audio, rate = mark.read_wav(mark.wav_bytes(samples, 24000, mark.metadata("kale", "fresh-de-f01")))
        self.assertEqual(rate, 24000)
        self.assertLess(float(np.abs(audio - samples).max()), 1 / 16384)
        import struct
        data = samples.tobytes()
        header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, 16000, 64000, 4, 32)
        audio, rate = mark.read_wav(header + b"data" + struct.pack("<I", len(data)) + data)
        self.assertEqual(rate, 16000)
        np.testing.assert_array_equal(audio, samples)
        with self.assertRaisesRegex(mark.MarkingError, "NOT_A_WAV_FILE"):
            mark.read_wav(b"ID3 not a wav")

    def test_resampling_lengths_and_band(self):
        down, up = mark.Resample(24000, 16000), mark.Resample(16000, 24000)
        x = torch.randn(1, 4800)
        y = down(x)
        self.assertEqual(y.shape[-1], 3200)
        torch.testing.assert_close(y, down.resample(x))
        self.assertEqual(up(y).shape[-1], 4800)
        self.assertEqual(mark.Resample(44100, 16000).resample(torch.randn(1, 44100)).shape[-1], 16000)
        # A 1 kHz tone passes, a 10 kHz tone (above the 16 kHz Nyquist) is removed.
        t = torch.arange(24000) / 24000
        for f, low, high in ((1000, 0.95, 1.05), (10000, 0, 0.01)):
            tone = torch.sin(2 * torch.pi * f * t)[None]
            ratio = float(down(tone)[0, 2000:-2000].pow(2).mean() / tone[0].pow(2).mean())
            self.assertTrue(low <= ratio <= high, (f, ratio))

    def test_detector_cli_reads_metadata_without_a_watermark_model(self):
        environment = {k: v for k, v in os.environ.items() if k != "DESIGNED_TTS_MARKER"}
        with tempfile.TemporaryDirectory() as tmp:
            marked, plain = Path(tmp) / "marked.wav", Path(tmp) / "plain.wav"
            samples = np.linspace(-0.5, 0.5, 4800, dtype=np.float32)
            marked.write_bytes(mark.export_wav(samples, family="kale", voice="fresh-de-f01"))
            plain.write_bytes(mark.export_wav(samples, marking="off"))
            result = subprocess.run([sys.executable, "-I", "-m", "designed_tts.mark", "detect", str(marked), str(plain)],
                                    capture_output=True, text=True, env=environment, check=True)
            first, second = map(json.loads, result.stdout.splitlines())
            self.assertTrue(first["metadata"]["ai_generated"] and first["metadata"]["generator"] == "Designed Voices TTS")
            self.assertIsNone(first["watermark"])
            self.assertIsNone(second["metadata"])
            missing = subprocess.run([sys.executable, "-I", "-m", "designed_tts.mark", "detect", str(Path(tmp) / "missing.wav")],
                                     capture_output=True, text=True, env=environment)
            self.assertEqual(missing.returncode, 1)


@unittest.skipUnless(os.environ.get("DESIGNED_TTS_MARKER"), "set DESIGNED_TTS_MARKER to the AudioSeal marker directory")
class AudioSealMarkerTests(unittest.TestCase):
    def test_marked_noise_is_detected_and_plain_noise_is_not(self):
        marker = mark.Marker(os.environ["DESIGNED_TTS_MARKER"])
        rng = np.random.default_rng(1)
        audio = (0.05 * rng.standard_normal(24000 * 3)).astype(np.float32)
        marked = marker.mark(audio)
        self.assertTrue(marker.detect(marked, 24000)["marked"])
        self.assertEqual(marker.detect(marked, 24000)["message_bits_matching"], 16)
        self.assertFalse(marker.detect(audio, 24000)["marked"])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "marked.wav"
            path.write_bytes(mark.export_wav(marked, marking="watermark"))
            result = subprocess.run([sys.executable, "-I", "-m", "designed_tts.mark", "detect", str(path), "--marker", os.environ["DESIGNED_TTS_MARKER"]],
                                    capture_output=True, text=True, check=True)
            self.assertTrue(json.loads(result.stdout)["watermark"]["marked"])


if __name__ == "__main__":
    unittest.main()
