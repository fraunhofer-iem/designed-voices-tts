"""Contracts of the English upstream Kale path; random or hand-made weights, no model downloads."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import save_file

from designed_tts.browser_export import KaleEnglishPlan, KalePlan, reduce_precision
from designed_tts.checkpoint import UPSTREAM_ENGLISH, convert_upstream_english
from designed_tts.kale_english_inference import shape_pitch
from designed_tts.release import FORMAT, digest, load_release


class PitchRuleTests(unittest.TestCase):
    def shape(self, f0, floor=120., threshold=50., tail=3., unvoice=80.):
        return shape_pitch(torch.tensor([f0]), *(torch.tensor(v) for v in (floor, threshold, tail, unvoice)))[0].tolist()

    def test_last_voiced_frames_are_held_above_the_floor(self):
        f0 = [200., 190., 180., 100., 95., 90., 85., 0., 0.]
        # Last voiced frame is index 6; the tail covers indices 3 to 6.
        self.assertEqual(self.shape(f0), [200., 190., 180., 120., 120., 120., 120., 0., 0.])

    def test_pitch_below_the_voice_value_is_unvoiced(self):
        # 70 Hz counts as voiced for the clamp (above 50) but is outside its tail, then falls below 80.
        self.assertEqual(self.shape([70., 200., 200., 200., 200., 200., 200.], tail=1.), [0., 200., 200., 200., 200., 200., 200.])
        self.assertEqual(self.shape([60., 300., 0., 79., 81.], floor=0.), [0., 300., 0., 0., 81.])

    def test_fewer_than_five_voiced_frames_are_not_clamped(self):
        self.assertEqual(self.shape([100., 100., 100., 100., 0.]), [100., 100., 100., 100., 0.])
        self.assertEqual(self.shape([100., 100., 100., 100., 100.]), [100., 120., 120., 120., 120.])

    def test_a_voice_without_floor_only_unvoices(self):
        f0 = [200., 150., 100., 70., 65., 61., 59.]
        self.assertEqual(self.shape(f0, floor=0., unvoice=60.), [200., 150., 100., 70., 65., 61., 0.])


class EnglishReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from designed_tts.vendor.kale.model import R2Ac, R2Text
        torch.set_num_threads(4)
        torch.manual_seed(7)
        cls.text, cls.audio = R2Text(voices=2).eval(), R2Ac(voices=2).eval()

    def release(self, root, extra=None):
        tensors = {f"text.{k}": v for k, v in self.text.state_dict().items()}
        tensors.update({f"audio.{k}": v for k, v in self.audio.state_dict().items()})
        tensors.update({"voice.pitch_floor": torch.tensor([120., 0.]), "voice.clamp_threshold": torch.tensor([50., 50.]),
                        "voice.clamp_tail": torch.tensor([36., 36.]), "voice.unvoice": torch.tensor([80., 60.])})
        tensors.update(extra or {})
        root.mkdir()
        save_file({k: v.detach().contiguous().clone() for k, v in tensors.items()}, str(root / "model.safetensors"))
        metadata = {"format": FORMAT, "family": "kale-en", "default_seed": 20261120,
                    "vocabulary": {"vocab": {"$": 0, " ": 16, "a": 43, "ˈ": 156}, "voices": ["kale-en-f01", "kale-en-m01"]},
                    "weights": {"sha256": digest(root / "model.safetensors")}}
        (root / "config.json").write_text(json.dumps(metadata))
        return root

    def test_every_token_gets_a_frame_and_samples_follow_the_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            release = load_release(self.release(Path(tmp) / "kale-en"), marking=False)
            self.assertEqual(release.voices, ["kale-en-f01", "kale-en-m01"])
            ids = [0, 156, 43, 16, 43, 0]
            wave, extra = release.synthesize(ids, "kale-en-m01")
            self.assertEqual(len(extra["durations"]), len(ids))
            self.assertTrue(all(frames >= 1 for frames in extra["durations"]))
            self.assertEqual(wave.numel(), sum(extra["durations"]) * 600)
            self.assertTrue(torch.isfinite(wave).all())
            # Same seed, same audio; the global generator is not consumed.
            state = torch.random.get_rng_state()
            again, _ = release.synthesize(ids, "kale-en-m01")
            self.assertTrue(torch.equal(wave, again))
            self.assertTrue(torch.equal(state, torch.random.get_rng_state()))
            with self.assertRaisesRegex(ValueError, "TOKEN_ID_OUTSIDE_VOCABULARY"):
                release.synthesize([0, 44, 0], "kale-en-m01")
            with self.assertRaisesRegex(ValueError, "UNKNOWN_VOICE"):
                release.synthesize(ids, "fresh-de-f01")

    def test_planner_differs_from_the_german_rule_only_in_the_minimum(self):
        tokens, voice = torch.tensor([[0, 156, 43, 16, 43, 0]]), torch.tensor([0])
        vocabulary = {"required_ids": [43], "stress_ids": [156, 157]}
        with torch.inference_mode():
            english = KaleEnglishPlan(self.text, self.audio)(tokens, voice)
            german = KalePlan(self.text, self.audio, vocabulary)(tokens, voice)
        self.assertTrue(bool((english[3] >= 1).all()))
        self.assertEqual(german[3][0, 1].item(), 0)  # the German rule gives a stress mark no time
        for a, b in zip(english[:3], german[:3]):
            self.assertTrue(torch.equal(a, b))

    def test_missing_or_extra_voice_values_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "UNEXPECTED_MODEL_TENSORS"):
                load_release(self.release(Path(tmp) / "a", {"voice.unvoice": torch.tensor([80.])}), marking=False)
            with self.assertRaisesRegex(ValueError, "UNEXPECTED_MODEL_TENSORS"):
                load_release(self.release(Path(tmp) / "b", {"voice.other": torch.tensor([1., 2.])}), marking=False)
            with self.assertRaisesRegex(ValueError, "UNEXPECTED_MODEL_TENSORS"):
                load_release(self.release(Path(tmp) / "c", {"critic.weight": torch.tensor([1.])}), marking=False)

    def test_source_integrity_failure_never_creates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / "download", Path(tmp) / "release"
            for name in UPSTREAM_ENGLISH["files"]:
                (source / name).parent.mkdir(parents=True, exist_ok=True)
                (source / name).write_bytes(b"not the pinned file")
            with self.assertRaisesRegex(ValueError, "SOURCE_CHECKPOINT_INTEGRITY_FAILURE"):
                convert_upstream_english(source, output)
            self.assertFalse(output.exists())

    def test_roster_is_eight_american_voices(self):
        roster = UPSTREAM_ENGLISH["roster"]
        self.assertEqual([entry[0] for entry in roster], [f"kale-en-{sex}{n:02d}" for sex in "fm" for n in range(1, 5)])
        self.assertEqual({entry[3] for entry in roster[:4]}, {"female"})
        self.assertEqual({entry[3] for entry in roster[4:]}, {"male"})
        self.assertFalse({"d03", "d13"} & {entry[1] for entry in roster})  # the British voices
        self.assertTrue(all(f"voices/{entry[1]}.extra.bin" in UPSTREAM_ENGLISH["files"] for entry in roster))


class ReducedPrecisionTests(unittest.TestCase):
    def test_storage_rules_and_exact_outputs(self):
        import onnx
        import onnxruntime as ort
        from onnx import TensorProto, helper, numpy_helper
        rng = np.random.default_rng(3)
        weights = {"text.plan.weight": rng.standard_normal((40, 40)).astype(np.float32),     # durations depend on it
                   "audio.dec.weight": rng.standard_normal((40, 40)).astype(np.float32),     # sound generator matrix
                   "audio.dec.bias": rng.standard_normal(40).astype(np.float32),             # under 64 elements
                   "predictor.weight": rng.standard_normal((40, 40)).astype(np.float32),     # text side, not planned
                   "tiny": np.ones(8, np.float32)}
        nodes = [helper.make_node("MatMul", ["x", "text.plan.weight"], ["durations"]),
                 helper.make_node("MatMul", ["x", "audio.dec.weight"], ["a"]), helper.make_node("Add", ["a", "audio.dec.bias"], ["b"]),
                 helper.make_node("MatMul", ["b", "predictor.weight"], ["c"]), helper.make_node("Slice", ["c", "s0", "s8", "s1"], ["d"]),
                 helper.make_node("Add", ["d", "tiny"], ["audio"])]
        extra = [numpy_helper.from_array(np.array(v, np.int64), n) for n, v in (("s0", [0]), ("s8", [8]), ("s1", [1]))]
        graph = helper.make_graph(nodes, "g", [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 40])],
                                  [helper.make_tensor_value_info("durations", TensorProto.FLOAT, [1, 40]), helper.make_tensor_value_info("audio", TensorProto.FLOAT, [1, 8])],
                                  [numpy_helper.from_array(v, k) for k, v in weights.items()] + extra)
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
        model.ir_version = 9
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "float.onnx", Path(tmp) / "reduced.onnx"
            onnx.save(model, str(source))
            counts = reduce_precision(source, target, ("audio.",), ("durations",))
            self.assertEqual(counts, {"int8": 1, "float16": 1, "fourier": 0})
            stored = {i.name: i.data_type for i in onnx.load(str(target)).graph.initializer}
            self.assertEqual(stored["text.plan.weight"], TensorProto.FLOAT)
            self.assertEqual(stored["audio.dec.weight_q"], TensorProto.INT8)
            self.assertEqual(stored["audio.dec.bias"], TensorProto.FLOAT)
            self.assertEqual(stored["predictor.weight_16"], TensorProto.FLOAT16)
            self.assertEqual(stored["tiny"], TensorProto.FLOAT)
            x = rng.standard_normal((1, 40)).astype(np.float32)
            a, b = (ort.InferenceSession(str(p), providers=["CPUExecutionProvider"]).run(None, {"x": x}) for p in (source, target))
            self.assertTrue(np.array_equal(a[0], b[0]))          # planned values are bit-identical
            self.assertFalse(np.array_equal(a[1], b[1]))         # the rest is an approximation
            self.assertLess(np.abs(a[1] - b[1]).max() / np.abs(a[1]).max(), 0.05)
            self.assertLess(target.stat().st_size, source.stat().st_size)
            # Sound generator only: the text side outside the planner stays float32 too.
            sound = Path(tmp) / "sound.onnx"
            self.assertEqual(reduce_precision(source, sound, ("audio.",), ("durations",), sound_only=True), {"int8": 1, "float16": 0, "fourier": 0})
            stored = {i.name: i.data_type for i in onnx.load(str(sound)).graph.initializer}
            self.assertEqual((stored["audio.dec.weight_q"], stored["predictor.weight"]), (TensorProto.INT8, TensorProto.FLOAT))
            # Half floats instead of int8: a closer approximation, the planned values still exact.
            half = Path(tmp) / "half.onnx"
            self.assertEqual(reduce_precision(source, half, ("audio.",), ("durations",), integer=False, sound_only=True), {"int8": 0, "float16": 1, "fourier": 0})
            stored = {i.name: i.data_type for i in onnx.load(str(half)).graph.initializer}
            self.assertEqual((stored["audio.dec.weight_16"], stored["predictor.weight"], stored["text.plan.weight"]), (TensorProto.FLOAT16, TensorProto.FLOAT, TensorProto.FLOAT))
            c = ort.InferenceSession(str(half), providers=["CPUExecutionProvider"]).run(None, {"x": x})
            self.assertTrue(np.array_equal(a[0], c[0]))
            self.assertLess(np.abs(a[1] - c[1]).max(), np.abs(a[1] - b[1]).max())


if __name__ == "__main__":
    unittest.main()
