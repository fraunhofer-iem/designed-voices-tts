# Static Space release

Published: https://huggingface.co/spaces/Fraunhofer-IEM/designed-voices-tts

Direct: https://fraunhofer-iem-designed-voices-tts.static.hf.space/

Release revision `a8ee94178a6f9b703e89e113a3354549d1bdc38d`, built from source
`203e5c1fb17610b7b6978078ebc53a66f14153e0`: 53 files, 95,695,910 bytes including
all runtime assets, notices, model cards, manifest and inventory. The host adds
504 bytes of platform HTML metadata, accounted for separately. It ships the German
Kale weights trained on 36 hours and 32,120 sentences (model repository revision
`bf8d79467f48f28325bb394c14b94239318ba1f9`); Voca64 is unchanged and its reference
output is sample-identical to the previous release. Actual Chrome direct-page and
Hub-iframe CPU-WASM synthesis verified; three reference PCM hashes match the
qualified local package exactly. Previous Space revision:
`1e732f5052d0de3b99ff307e4c0d5d85e8633870` (first Kale weights, model repository
revision `1bc837c1fbf127c5a563ed74f6fef30421c9294e`).

## Build configurations

A package contains one of four sets of model families. All use the same source,
tools and gates; they differ in the preview config and in the files the packager
adds. The release candidate is C, served on the default preview.

| | C: Voca64 with both Kale (release candidate) | Voca64 with German Kale (published Space) | German Kale with our English Kale | German Kale with the public English Kale |
| --- | --- | --- | --- | --- |
| `families` in the preview config | `["voca64", "kale", "kale-fresh-en"]` | absent, or `["voca64", "kale"]` | `["kale", "kale-fresh-en"]`, optionally `[directories] kale-fresh-en = "kale-fresh-en-sound-float16"` | `["kale", "kale-en"]` |
| Runtime root | `tts-browser-runtime/v5` (v4 and `marker/`), all full precision | version with `voca64/` and `kale/` | `tts-browser-runtime/v5` | version with `kale/` and `kale-en/` |
| Output marking | `marking` absent (`"metadata"`) or `"watermark"`; never `"off"` for the published Space | the same | the same | the same |
| Phony build | any build since `sentencePlan` | any build since `sentencePlan` | any build since `sentencePlan` | a build with `toKaleEnglish` |
| Model cards in the package | `VOCA-MODEL-CARD.md`, `KALE-MODEL-CARD.md`, `KALE-FRESH-EN-MODEL-CARD.md` | `VOCA-MODEL-CARD.md`, `KALE-MODEL-CARD.md` | `KALE-MODEL-CARD.md`, `KALE-FRESH-EN-MODEL-CARD.md` | `KALE-MODEL-CARD.md`, `KALE-EN-MODEL-CARD.md` |
| Space card | `space/README.voca-kale-de-en.md` | `space/README.md` | `space/README.kale-fresh-de-en.md` | `space/README.kale-de-en.md` |
| Identity reference | ten cases (four Kale DE, Voca64 DE and EN, four English Kale) | three cases (Kale DE, Voca64 DE, Voca64 EN) | eight cases (four Kale DE, four English) | four cases (Kale DE, three English Kale) |

Owner decision (2026-11-25): "the 100 MB limit was arbitrary and since each model
is downloaded individually there is no issue at all." There is no package size
limit. `tools/package-space.mjs` and `tools/check-space-package.mjs` measure and
report the complete size (and the bytes per family); `--budget <bytes>` or
`PACKAGE_BUDGET=<bytes>` sets a limit for anyone who wants one, default none.

The reduced English waveform graph (`kale-fresh-en-sound-float16`) and its
receipts stay registered in `tts-browser-runtime/v4` but are not served by C.
`qualification/PACKAGE-SIZES.json` there records the sizes measured under the
former limit.
## Output marking

`marking` in the preview config (`docs/output-marking.md`): `"metadata"`
(default) marks every exported WAV with AI-generation metadata and serves no
marker file; `"watermark"` also serves the AudioSeal marker (`marker_root`,
default `runtime_root/marker`; options `marker_variant = "float16"` with
`tts-browser-runtime/v6`, `marking_worker = true`); `"off"` marks nothing. The
packager records the mode in `PACKAGE.json` and writes the Space card's marking
section to match it (no section with `"off"`); `tools/upload-space.py` accepts
`metadata` and `watermark` and refuses `off`. Self-deployers set
`marking = "off"` before packaging. The marker graphs come from
`tools/export-marker.py` (pinned AudioSeal checkpoints, MIT).

Serve each configuration from its own config file and port:
`bun tools/serve-preview.mjs --config <file>`. `tools/package-space.mjs` reads
the families from the preview's manifest, takes the matching cards and Space
card, and refuses a Space card that names a model the package does not contain
or omits one it does. The browser checks read the manifest too
(`tools/preview-profile.mjs`): `PREVIEW_URL=<preview> just check-preview` and
`tools/check-runtime-identity.mjs` run against either configuration, and
`tools/check-space-package.mjs` against either package.

`space/KALE-EN-MODEL-CARD.md` is the card of the English Kale family. The weights
are upstream's and are not republished as a model repository of this project;
put a copy of the file into the cards directory for packaging.

Which configuration the public Space carries is the owner's decision. Replacing
Voca64 removes its 32 German and 32 English voices from the Space. Upstream asks
that listeners are told the speech is AI-generated; whether and how the page
says so is also decided by the owner, and nothing is added without that.

## German Kale and English Kale with our own voices (tts-browser-runtime/v4)

Both are fits of the German family type, so the steps of "Replacing model
weights" apply to each, with these additions:

1. Convert each pinned checkpoint with `designed_tts.checkpoint.convert(...,
   family="kale")` and require the weights hash of the training-host conversion
   whose native parity was measured. The English fit gets its own directory,
   `kale-fresh-en`, never `kale-en`.
2. Gate inputs: token ids of the held-out sentences from the browser frontend,
   `tools/german-plans.mjs` and `tools/english-plans.mjs --kale <config>`, written
   as `<directory>-cases.json` for `tools/check-export-parity.py --models
   kale,kale-fresh-en`, plus the four frozen German cases.
3. A reduced copy: `tools/export-browser.py --from-export <runtime>/<model>
   --reduced <runtime>/<model>-sound-float16 --parts wave --storage
   sound-float16`, then `tools/check-reduced-precision.py --model <directory>`
   and `tools/check-export-browser.mjs`. Variants that fail the bar are not kept
   in the runtime root; their receipts are.
4. Measure every configuration with the packager before choosing precisions.

## Adding the English Kale family

Same order as for replaced weights, with these steps:

1. `tools/convert-upstream-english.py --source <pinned download> --out
   <release>/kale-en`: every input file is checked against its pinned SHA-256.
   Run it with `python -I -B` from this repository, never from the download.
2. `tools/export-browser.py --release <release>/kale-en --out
   <runtime>/kale-en-float32 --reduced <runtime>/kale-en`: the float32 export
   and the reduced-precision copy the browser loads.
3. Float gates: `tools/check-export-parity.py --models kale-en` with
   `kale-en-cases.json` (token ids as the browser sends them) and
   `tools/check-export-browser.mjs`. Unchanged thresholds: exact durations and
   sample counts, rewrite peak 1 %, ONNX peak 2 %, relative L2 1 %.
4. Reduced-precision gates: `tools/check-reduced-precision.py` (same length on
   every case, log-mel distance at most 0.20 against the float32 export) and
   `tools/check-export-browser.mjs` with the fixtures it writes.
5. Build Phony from a revision with `toKaleEnglish`, point a preview config with
   `families = ["kale", "kale-en"]` at the runtime root and that build, then
   `just check`, `just check-english <assets> <phony build>`,
   `PREVIEW_URL=<preview> just check-preview`, the identity check, packaging
   and the static package check.

## Replacing model weights

New weights for an existing family (same architecture, voices and vocabulary) go
through the same gates as the first export, in this order: convert the checksum-
pinned checkpoint with `designed_tts.checkpoint.convert` into a new registered
release version; check the portable loader sample-exact against the training
code on fixed cases; export with `designed_tts.browser_export.export_release`
into a new runtime version (unchanged families are hardlinked, never re-exported);
run `tools/check-export-parity.py` and `tools/check-export-browser.mjs`; point the
preview config at the new runtime root and run `just check` and
`just check-preview`; then package and publish as below. The model repository gets
the new `config.json`, `model.safetensors`, model card and attribution; earlier
weights stay reachable at their previous revision.

## Build and package

1. Run the source/browser checks and build `dist` with `just build-web`.
2. Rust/WASM release builds must remap private build paths. Build both Phony and
   nrmlz from their pinned source revisions with:
   `CARGO_ENCODED_RUSTFLAGS=$(printf '%s\037%s\037%s' '-C' 'target-feature=+simd128' "--remap-path-prefix=$HOME=/build")`.
   Supply that environment to Phony's `just wasm-build` and nrmlz's `just wasm`.
3. Capture `tools/check-runtime-identity.mjs` before and after rebuilding; normalized
   text, phones, sample counts, chunk counts and SHA-256 of raw PCM must be identical.
   Re-run the actual browser suite. Do not suppress a mismatch as a packaging change.
   `REFERENCE=<RESULT.json>` makes the check compare every case itself. The hashes
   are those of the unmarked model output; with the watermark, `markedSha256` records
   the marked output as a separate stage.
4. Collect the two public model cards at the revisions recorded in the model
   publication receipts into an explicit cards directory.
5. Run `bun tools/package-space.mjs --preview <preview-url> --out <new-directory>
   --cards <cards-directory>`. The destination must not already exist. It copies
   only checksum-verified mapped assets and the explicit licence/card files.

The packager rejects known private path/host markers, checks every asset size and
hash, writes a static `manifest.json`, and counts all files including README,
licences, manifest and inventory into the reported complete size (no limit by
default; until 2026-11-25 this was a strict 100,000,000-byte budget).
`PACKAGE.json` lists every other file, not its own self-referential hash. Original
model graphs, noise inputs and frontend data are not rewritten. Copyright notices
and identity-asset provenance remain separate from the code's primary licence.

## Publish and verify

Create `Fraunhofer-IEM/designed-voices-tts` with the static SDK. Upload only the
fresh package directory with `just upload-space <package-directory>`. This verifies
the inventory and uses
an existing public **static** Space plus a parent-commit guard. `HF_TOKEN` is used
only by the uploader, never placed in the runtime package. No runtime secrets,
inference API or GPU deployment are needed. Public Space authorization is not
authority to replace unrelated repos.

The tested `hf upload` 1.21.0 calls repository creation before uploading and triggers
a misleading organization Gradio/Docker plan check, even for an existing free
static Space. The direct SDK uploader does not recreate the repository or request
paid hardware; it uses the same authorized static repository. Do not subscribe to
a paid plan or change SDK/hardware to work around that CLI preflight.

Verify the real HTTPS direct page and the Hub iframe: cold asset hashes/MIME,
DE/EN synthesis, state/locale handling, cancellation, model switching, phone zeros,
umlauts, sentence boundaries, branding and new-text synthesis after going offline.
Compare raw PCM hashes with the qualified local build. Record the Space commit,
static package inventory, public test evidence and exact source/runtime revisions.
Browser platform results are not a claim of physical-phone/Safari qualification.

The static host decorates HTML with its creator-variable bootstrap and social
metadata. The index manifest entry therefore marks `integrityScope =
"repository-source"`: verify its raw bytes through the public pinned Hub revision,
then compare hosted HTML after accounting for those specific platform additions.
`README.md` is the Hub card, not a static runtime asset URL; it belongs in the package
inventory, not the browser asset map. Other asset URLs must return exact original
bytes. Count hosting HTML additions separately from the versioned package size.
