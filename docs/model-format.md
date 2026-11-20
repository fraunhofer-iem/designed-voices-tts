# Portable model format v1

Each model directory contains `config.json` and `model.safetensors`. The config
identifies `designed-tts/model/v1`, family, the original checkpoint SHA-256,
training steps, architecture/vocabulary, default seed and safe-weight hash/size.
No training paths, optimizer state, private frontend caches or executable pickle
are copied into the inference release. Tensor loading is strict and CPU-only.

`designed_tts.release.load_release(directory)` returns a fixed-roster model with
`voices` and `synthesize(ids, voice, stress=...)`. Inputs are a phoneme plan, not
raw text or reference audio. Text normalization and phonemization are separate
nrmlz/Phony stages; the browser release must perform them locally too.

Voca uses the append-only 88-symbol bilingual inventory. Both rosters share the
architecture, but their embeddings are not interchangeable. Default neutral noise
seed: 20261119. Preserve the original oscillator and phase behavior.

German Kale has separate text/audio generators, 178 token rows, real-phone
minimum-one-frame durations, zero-time stress markers, a 600-sample acoustic hop,
300-sample prosody hop and fixed 25 Hz unvoiced midpoint. No teacher acoustics,
end clamp, pitch/gender rule or upstream English wrapper is introduced. A local
noise generator preserves the original fixed-seed waveform without changing
PyTorch's global RNG. Default seed: 20261120. English Kale is not qualified.

The native loader is not evidence that the exported browser graph works. Export
parity, complete inference-asset bytes and real browser/backend tests remain
separate gates. Random-weight unit fixtures prove code contracts, not voice
quality or minimum device requirements.
