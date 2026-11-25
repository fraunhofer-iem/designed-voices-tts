# Dizione English frontend

Dizione and its JavaScript port in tiny-voca are Apache-2.0 licensed. The complete
licence is in `LICENSE`. Upstream projects:

- https://github.com/n4ze3m/dizione
- https://github.com/n4ze3m/tiny-voca/tree/main/js/dizione

These source Git blob IDs pin the vendored JavaScript independently of moving
branches. Every file except the explicitly adapted engine/alignment helper and
one line of `normalize.js` (see local changes) is byte-for-byte identical to its
upstream blob.

| File | Upstream Git blob SHA-1 |
| --- | --- |
| align.js | 8777ea386ef3d4f1fa2001c8889bd31bf85d8787 |
| convert.js | 2ee3454dcc01d75b085656e615225500995d8d1d |
| engine.js | 6a7fdc2d62290a62a39ec7dde8f3153797ef1f72 |
| homographs.js | 977b6050665bdb23ce57783fe085708a054906f1 |
| morphology.js | 0249e214189f21f4ed233674ffce423730150bb2 |
| normalize.js | 4f562780abcd23fe89b32ec551329c77539957f9 |
| pyre.js | 8c0d223d7920e4b43b0e3d88e79470de7407d034 |
| sentence.js | 089b5b4dd33d1105c43d455bc83af096ef9175a8 |
| symbols.js | 0738f98554fdb68b362f7a787fe15c839459b12d |
| tables.js | e3c78de6972c118365c48a97329fc693871584a0 |

`LICENSE` is Dizione blob `d645695673349e3947e8e5ae42332d0ac3164cd7`.
Python fixture expectations are from Dizione's `tests/test_dizione.py`, blob
`b8ab5d02973d6c784e6c58f708be459b9d2fe549`.

## Local changes and execution contract

- `engine.js` accepts an injected aligner and omits upstream GGUF loading and
  JavaScript neural/lexical imports. English dictionary, neural G2P and alignment
  use Phony's Rust/WASM `EnglishBackend`. `align.js` retains only the unchanged
  `base` helper needed by conversion. No JavaScript neural implementation ships.
- `vm-entry.js` is the local bridge. Full phrase normalization, morphology,
  pronunciation conversion, homograph classification, sentence stress and linking
  run inside QuickJS WebAssembly. Rules and homograph model scoring never run in
  the browser's host JavaScript engine. The upstream normalizer remains intact;
  the caller supplies NRMLZ-normalized text without any GPL normalizer dependency.
- `vm-entry.js` builds clauses itself (the same steps as `Phonemizer.analyse`)
  after `web/english-marks.mjs` removed every mark outside `, . ? ! ; :` from the
  normalizer's token stream: the acoustic models were trained on plans without
  the other marks. An ellipsis between words becomes a period. The vendored
  files are not changed for this; see `docs/browser-runtime.md`.
- `normalize.js` differs from its upstream blob in one statement: a word that
  the tokenizer attaches because it follows a hyphen also gets `hyphen: true`
  (marked with a comment in the file). Nothing in the vendored rules reads it,
  so every plan is unchanged. `vm-entry.js` uses it only when the caller asks
  for `hyphenBoundaries` (`web/english-hyphens.mjs`): the parts of a hyphenated
  word are then separate words in the plan, with the same phones, stress,
  linking and homograph choice. The English Kale model needs this; the default
  is the plan convention Voca and German Kale were trained on.
- The caller provides immutable frontend metadata, packed dictionary and neural
  weights separately; these source files do not include or relicense those assets.
- `bun tools/build-english.mjs` generates `web/dizione-rules.js` as inert source.
  Bundle `web/english.mjs` with the application. Serve the release-sync QuickJS
  0.31.0 WASM binary at `assets/quickjs.wasm` and supply its bytes to `createEnglish`.
- Call `await createEnglish({phonyModule, metadataText, weightsBytes,
  englishDictionaryBytes, quickjsWasmBytes})` after initializing Phony WASM.
  Its synchronous `phonemize(text)` returns the shared `phony-shared-v1` Output
  with 88-inventory IDs, stress, symbols and provenance details. Call `dispose()`
  when no longer needed. Metadata must contain the append-only shared inventory.
- Each isolated VM has a 64 MiB heap limit, 1 MiB stack limit and 10-second deadline
  per operation. Input is limited to 2,000 characters and output to 512 tokens.
  Rust G2P also bounds individual spellings. Cached word results are bounded.

## Verification

Provide existing registered runtime assets and the built Phony WASM directory:

```sh
ENGLISH_ASSETS_DIR=<runtime-directory> PHONY_WASM_DIR=<pkg-web-directory> \
  bun test tests/english.test.mjs
ENGLISH_ASSETS_DIR=<runtime-directory> PHONY_WASM_DIR=<pkg-web-directory> \
  bun tests/english-browser.mjs
```

Both use real QuickJS/Rust WASM and the same pinned upstream Python fixture
expectations. Chromium runs the browser-bundled production frontend, with no
inference service. Coverage includes greetings, function words, sentence stress,
phrase joining, contextual/hyphenated homographs, morphological derivation,
neural OOVs, shared IDs, punctuation, dropped untrained marks, the training plans of
all English training texts, the opt-in hyphen boundaries, bounds, recovery and
disposal.
