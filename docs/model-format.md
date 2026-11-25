# Portable model format v1

Each model directory contains `config.json` and `model.safetensors`. The config
identifies `designed-tts/model/v1`, family, the original checkpoint SHA-256,
training steps, architecture/vocabulary, default seed and safe-weight hash/size.
No training paths, optimizer state, private frontend caches or executable pickle
are copied into the inference release. Tensor loading is strict and CPU-only.

`designed_tts.release.load_release(directory, marking="metadata", marker=None)`
returns a fixed-roster model with `voices`, `synthesize(ids, voice, stress=...,
marked=None)` and `synthesize_wav(...)`. Inputs are a phoneme plan, not raw text
or reference audio. By default the waveform is the model output and
`synthesize_wav` writes it with the AI-generation metadata chunks.
`marking="watermark"` adds the AudioSeal watermark of the marker directory
(`marker=` or `DESIGNED_TTS_MARKER`; loading fails without one); `marking="off"`
(or `False`) writes plain files. `synthesize_unmarked` always returns the model
output; parity tools use it (`docs/output-marking.md`). Text normalization and phonemization are separate
nrmlz/Phony stages; the browser release must perform them locally too.

Voca uses the append-only 88-symbol bilingual inventory. Both rosters share the
architecture, but their embeddings are not interchangeable. Default neutral noise
seed: 20261119. Preserve the original oscillator and phase behavior.

German Kale has separate text/audio generators, 178 token rows, real-phone
minimum-one-frame durations, zero-time stress markers, a 600-sample acoustic hop,
300-sample prosody hop and fixed 25 Hz unvoiced midpoint. No teacher acoustics,
end clamp, pitch/gender rule or upstream English wrapper is introduced. A local
noise generator preserves the original fixed-seed waveform without changing
PyTorch's global RNG. Default seed: 20261120.

English Kale with our own voices (`tts-portable-model-releases/v5` directory
`kale-fresh-en`) is a model of this German family type: `"family": "kale"`, the
same vocabulary block and inference rule, four English voices `fresh-en-f03`,
`fresh-en-f14`, `fresh-en-m03`, `fresh-en-m08`. It is told apart from German Kale
by its voices, not by its format, and it is not the upstream English family below.

The English Kale family (`"family": "kale-en"`) is the public model
`KaleComputer/kale-tts-1-nano` with unchanged weights, not an adaptation.
`designed_tts.checkpoint.convert_upstream_english` reads the pinned download
(every input file by SHA-256) and writes the same release layout: the network
tensors of the text side and the sound generator bit for bit, the released rows
of eight voices in the two voice tables, and four per-voice values as `voice.*`
tensors (pitch floor, clamp threshold, clamp tail, unvoicing value). The two
British voices are left out: they were trained on phone ids this project's
frontend does not produce. `config.json` records the source repository, revision
and file hashes, the upstream id, name and documented sex of each voice, and the
token id table (64 Kokoro-native characters). Voice ids are `kale-en-f01` to
`kale-en-f04` and `kale-en-m01` to `kale-en-m04`.

Its inference rules are upstream's English ones and differ from German Kale:
every token gets at least one frame (stress marks and spaces too), the pitch of
the last voiced frames is held above a per-voice floor, and pitch below a
per-voice value is unvoiced; there is no 25 Hz midpoint. The German rules must
not be applied to these weights, and the other way round. Token ids come from a
separate mapping (`toKaleEnglish` in Phony), one id per upstream character.
Default seed: 20261120, the same fixed noise stream as German Kale.

The native loader is not evidence that the exported browser graph works. Export
parity, complete inference-asset bytes and real browser/backend tests remain
separate gates. Random-weight unit fixtures prove code contracts, not voice
quality or minimum device requirements.
