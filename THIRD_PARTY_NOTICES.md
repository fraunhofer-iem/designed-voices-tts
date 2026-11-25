# Third-party notices

## Build configurations

The browser application is built with one of these sets of models: German Kale
with Voca64 (the published Space), German Kale with English Kale in our own four
voices, or German Kale with the public English Kale model. The notices below
apply to the components a build contains: the tiny-voca entries concern builds
with Voca64, the entries on the public English Kale model concern builds with
that model. `manifest.json` of a package lists the files it contains, and the
package carries the model cards of exactly its models. The reference code in
this repository contains all families.

## Reference code

- tiny-voca, https://github.com/n4ze3m/tiny-voca, source revision `62e2ade`,
  Apache-2.0. The Voca architecture and ONNX waveform wrapper are derived from
  that source. Changes: append-only German phone inventory, portable token-only
  interface and separate safetensors release loader. `LICENSES/tiny-voca.txt`
  retains its licence. These Voca weights were trained from scratch, not
  initialized with upstream pretrained weights.
- Kale Computer, `KaleComputer/kale-tts-1-nano` revision
  `b6ce1887268c3667994fc3b0b2c82887c069915c`, Apache-2.0.
  Generator source comes from the shared recipe in `KaleComputer/kale-tts-1-tiny`
  revision `69011009e3380f1cc8fe990cbb55b799bde8455a`; imports are package
  relative and the voice count is explicit. German inference uses its own
  trained atomic-phone/duration/physical-F0 ABI, not the upstream English wrapper.
  The English Kale family follows upstream's English inference rules instead:
  `kale_english_inference.py` and the English export classes re-implement the
  duration minimum, the end clamp and the unvoicing floor of the recipe's
  `train/onnx_export.py` and `export/add_end_clamp.py`, `add_voice_tail.py`,
  `add_voice_unvoice.py`; the reduced-precision storage rules in
  `browser_export.py` are ported from `small_copy` in `train/onnx_export.py`, and
  the log-mel measure in `tools/check-reduced-precision.py` from
  `export/export_check.py` (all Apache-2.0, copyright Kale).
- Paradee, https://github.com/sahilmahendrakar/paradee, revision
  `2de547e45da92840a636c499eb0782e988be1e47`, Apache-2.0. Its source-filter
  head and decoder presets are redistributed through Kale; no Paradee weights
  are used.
- Kokoro, https://github.com/hexgrad/kokoro, Apache-2.0, copyright hexgrad.
  Selected Kokoro 0.9.4 neural components are vendored with their licence in
  `LICENSES/kokoro.txt`. No Kokoro pipeline, Misaki, phonemizer or eSpeak is
  required or redistributed by this neural path. StyleTTS2
  layouts are MIT, copyright 2023 Aaron (Yinghao) Li; kikiri-tts is Apache-2.0.

`LICENSES/kale-upstream-notices.md` retains the upstream family-wide notice.
The Nano path does **not** include the Tiny variant's Ettin encoder/tokenizer.
The upstream notice describes optional frontends too; they are not silently
substituted for this release's nrmlz/Phony frontend.

## Weights and training inputs

The public English Kale model (builds that contain it) is
`KaleComputer/kale-tts-1-nano` at the revision above with unchanged weights and
eight of its ten voices, Apache-2.0, trained by Kale Computer. Nothing was
retrained. The browser loads a reduced-precision copy of the export; this is a
storage step, described with the other differences from the upstream release
(own text frontend, split graphs, fixed noise, voice selection) in
`KALE-EN-MODEL-CARD.md`, which also quotes upstream's credits and its request to
tell listeners that the speech is AI-generated. Upstream's own English frontend
and its pronunciation data (CMUdict-derived lexicon, Britfone) are not included.

German Kale and English Kale with our own voices start from the pinned public
Nano generators. Their lineage includes
Kokoro, StyleTTS2/kikiri and synthetic Maya-1 audio (Maya Research; Apache-2.0),
decoded with SNAC (MIT; Descript and Hubert Siuzdak). Follow the stated Maya-1
use policy: no impersonation and do not present synthetic audio as human recordings.

English Kale with our own voices (builds that contain it; family id
`kale-fresh-en`) is a new adaptation with the German recipe, inference rule and
token table and four English synthetic voices of this project. It does not
contain the voices or the voice values of the public English model. In a package
its waveform graph can be a reduced-precision copy (half floats in the sound
generator); `config.json` of the model records which graph and which rule.

The pitch targets of the current German Kale weights and of English Kale with
our own voices were computed with the JDC pitch extractor of StyleTTS2 (MIT,
copyright 2023 Aaron (Yinghao) Li; https://github.com/semidark/StyleTTS2 at
commit `b1956da84bf4a6ccc88f2440078024f1c4bfec7d`, `Utils/JDC`, the files of
https://github.com/yl4579/StyleTTS2 ). It was used in training only: neither its
code nor its weights are in this repository, in the model files or in a package.
`LICENSES/StyleTTS2.txt` is the licence text of that project.

The new voice supervision uses Qwen3-TTS VoiceDesign/Base; retain exact teacher
revisions and the dataset's attribution with the reviewed model payloads.
Upstream Qwen model cards declare Apache-2.0; that declaration is distinct from
verification of a separate licence file or entitlement-specific output terms.
CC BY 4.0 training texts and MFA German dictionary inputs keep their attribution
and change notices; they are not blanket-relicensed by the code's Apache licence.

## Browser runtime

- Phony Rust/WASM is MIT, with Apache-2.0 Dizione-derived English primitives.
  `LICENSES/phony-MIT.txt` and the frontend's six original notice files accompany
  the package (with a corrected dictionary also the list of its changes, see the
  next entry). Dizione's detailed source/change notice is retained in
  `LICENSES/dizione-NOTICE.md`; it lists the local changes, including the one
  line in its normalizer that records a hyphen.
- The German pronunciation dictionary in the frontend assets is the German MFA
  dictionary v3.0.0 by Michael McAuliffe and Morgan Sonderegger (Montreal Corpus
  Tools), CC BY 4.0,
  https://github.com/MontrealCorpusTools/mfa-models/tree/main/dictionary/german/mfa/v3.0.0 .
  It has been modified. Every build uses the most probable variant of each word
  in a binary encoding. Builds whose `assets/frontend/frontend.json` records
  `german_corrections` (version 3 of the Phony browser assets and later)
  additionally contain Phony's reviewed corrections: 84 pronunciations were
  changed and 3 words were added. `assets/frontend/NOTICE.md` states this for
  the package, and `assets/frontend/german-corrections.toml` lists every change
  with the original phones, the new phones and the reason. Builds with earlier
  assets, including the Space as published before this change, contain it without
  these corrections. The changes are not endorsed by the dictionary's authors.
- nrmlz Rust/WASM is Apache-2.0; its upstream German-rule attribution and change
  notice is retained verbatim in `LICENSES/nrmlz-NOTICE`.
- ONNX Runtime Web/Common 1.23.2 are declared MIT by their npm packages and retain
  their original Microsoft copyright banners. `LICENSES/onnxruntime-MIT.txt` and
  `LICENSES/onnxruntime-ThirdPartyNotices.txt` are copied from the official ONNX
  Runtime 1.23.1 CPU wheel accompanying the export reference. This records their
  provenance; it does not claim a separately retrieved 1.23.2 source tag. The
  upstream third-party list covers optional components too, not an inventory of
  activated inference providers in this browser.
- QuickJS and quickjs-emscripten 0.31.0 are MIT; their full bundled copyright
  texts are in `LICENSES/quickjs-emscripten-and-quickjs-MIT.txt` and
  `LICENSES/quickjs-emscripten-core-MIT.txt`.
- The SHA-256 implementation from noble-hashes 2.0.1 is MIT, copyright Paul Miller;
  its full text is in `LICENSES/noble-hashes-MIT.txt`.
- Output watermark (builds with `marking = "watermark"`, not the default;
  `docs/output-marking.md`):
  `assets/marker/mark.onnx` and `detect.onnx` are ONNX exports of the AudioSeal
  16-bit generator and detector, Meta Platforms, Inc. and affiliates, weights
  `facebook/audioseal` at Hub revision `3c19eba53390776cf2cc9ed5f6c9ac67ce72ecba`
  (model card: MIT) and model code `audioseal` 0.2.1 / facebookresearch/audioseal
  revision `1496f7662d6aa625602bb0dcd1b4997b63b47609` (MIT). No weight was
  retrained; the graphs add a fixed 16-bit message and resampling between 24 and
  16 kHz. Text in `LICENSES/audioseal-MIT.txt`. The resampling rule is that of
  julius `ResampleFrac` (MIT, copyright 2020 Alexandre Défossez), re-implemented
  in `designed_tts.mark`; text in `LICENSES/julius-MIT.txt`. A build with
  `"metadata"` (the default) or `"off"` contains neither graph.

The official Fraunhofer IEM identity image is separately documented in
`LICENSES/institute-logo-provenance.md`; the project licence does not relicense
institutional identity/trademarks. Funding acknowledgement is separate from
component licences.

The static package contains the full component texts, original frontend notices
and model cards alongside its checksum manifest. No Python inference server,
eSpeak fallback, pretrained Ettin encoder or hidden remote synthesizer is included.
