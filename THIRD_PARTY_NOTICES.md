# Third-party notices

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

German Kale starts from the pinned public Nano generators. Their lineage includes
Kokoro, StyleTTS2/kikiri and synthetic Maya-1 audio (Maya Research; Apache-2.0),
decoded with SNAC (MIT; Descript and Hubert Siuzdak). Follow the stated Maya-1
use policy: no impersonation and do not present synthetic audio as human recordings.

The new voice supervision uses Qwen3-TTS VoiceDesign/Base; retain exact teacher
revisions and the dataset's attribution with the reviewed model payloads.
Upstream Qwen model cards declare Apache-2.0; that declaration is distinct from
verification of a separate licence file or entitlement-specific output terms.
CC BY 4.0 training texts and MFA German dictionary inputs keep their attribution
and change notices; they are not blanket-relicensed by the code's Apache licence.

Runtime frontend and ONNX Runtime notices accompany the actual browser asset
manifest when those assets are exported. This source notice is not a substitute
for reviewing the final model/dataset/runtime payloads.
