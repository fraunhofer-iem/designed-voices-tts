import json
from pathlib import Path
import tempfile
import unittest

import torch

from designed_tts.checkpoint import convert
from designed_tts.release import Release, digest, load_release
from designed_tts.vendor.voca.config import Config
from designed_tts.vendor.voca.model import TinyVoca


class PortableReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(4)
        cls.model = TinyVoca(Config(speakers=("synthetic-fixture",))).eval()

    def test_safetensors_roundtrip_and_cpu_synthesis(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "synthetic.pt"
            torch.save({"config": self.model.config.to_dict(), "step": 0, "model": self.model.state_dict()}, source)
            metadata = convert(source, root / "release", family="voca", expected_sha256=digest(source))
            loaded = load_release(root / "release", marking=False)
            self.assertEqual(metadata["default_seed"], 20261119)
            for key, value in self.model.state_dict().items():
                self.assertTrue(torch.equal(value, loaded.models[0].state_dict()[key]), key)
            wave, extra = loaded.synthesize([1, 22, 40, 2], "synthetic-fixture")
            self.assertEqual(wave.device.type, "cpu")
            self.assertTrue(wave.numel() > 0 and torch.isfinite(wave).all())
            self.assertEqual(len(extra["durations"]), 4)

    def test_source_integrity_failure_never_creates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "input"
            source.write_bytes(b"not a checkpoint")
            output = Path(tmp) / "release"
            with self.assertRaisesRegex(ValueError, "SOURCE_CHECKPOINT_INTEGRITY_FAILURE"):
                convert(source, output, family="voca", expected_sha256="0" * 64)
            self.assertFalse(output.exists())

    def test_nonfinite_weights_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "input.pt"
            torch.save({"model": {"bad": torch.tensor([float("nan")])}, "config": {}, "step": 0}, source)
            with self.assertRaisesRegex(ValueError, "INVALID_MODEL_TENSORS"):
                convert(source, Path(tmp) / "release", family="voca", expected_sha256=digest(source))

    def test_corrupt_release_rejected_before_tensor_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "model.safetensors").write_bytes(b"corrupt")
            (root / "config.json").write_text(json.dumps({
                "format": "designed-tts/model/v1", "weights": {"sha256": "0" * 64}}))
            with self.assertRaisesRegex(ValueError, "WEIGHTS_INTEGRITY_FAILURE"):
                load_release(root, marking=False)

    def test_input_validation(self):
        model = Release({"family": "voca", "default_seed": 20261119,
                         "config": {"speakers": ["voice"]}}, (self.model,))
        for ids, voice in [([], "voice"), ([999], "voice"), ([1], "absent")]:
            with self.assertRaises(ValueError):
                model.synthesize(ids, voice)
        with self.assertRaisesRegex(ValueError, "INVALID_STRESS_PLAN"):
            model.synthesize([1, 2], "voice", stress=[0.0, 0])

    def test_kale_neural_components_without_frontend_dependency(self):
        import sys
        from designed_tts.vendor.kale.model import R2Ac, R2Text
        models = (R2Text(), R2Ac())
        self.assertEqual(sum(p.numel() for model in models for p in model.parameters()), 7163442)
        for name in ("kokoro", "misaki", "espeakng_loader", "phonemizer"):
            self.assertNotIn(name, sys.modules)

    def test_qualified_parameter_counts(self):
        for voices, count in [(8, 4541899), (64, 4563403)]:
            model = TinyVoca(Config(speakers=tuple(f"voice-{i}" for i in range(voices))))
            self.assertEqual(sum(p.numel() for p in model.parameters()), count)


if __name__ == "__main__":
    unittest.main()
