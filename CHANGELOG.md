# Changelog

## Unreleased

- Owner decision (2026-11-25): metadata marking, clearly stated, plus a
  Prohibited use section; the audio watermark is not on by default. Marking
  modes: `metadata` (default: every WAV the page exports, `window.tts.wav` and
  the Python WAV writer `synthesize_wav`/`export_wav` carry RIFF INFO and XMP
  saying AI-generated speech and the generator; no marker file is downloaded and
  the audio equals the unmarked output), `watermark` (AudioSeal, opt-in, float32
  or the float16 variant) and `off` (self-deployers; the uploader refuses it).
  The page's runtime paragraph says "Downloaded WAV files contain metadata that
  marks them as AI-generated speech." in both languages; the watermark row of the
  timing table appears only with the watermark. `detect` (CLI and page) reports
  the metadata and, with the watermark model, the watermark score. Prohibited use
  section in the README, the Space cards and the model card drafts.
  `docs/output-marking.md` is rewritten as the record of the assessment (no
  compliance claim).
- Owner listening result on the marking blind pairs (9 of 16 rated): unmarked
  preferred 6, marked 0, tie 2, both bad 1; a faint higher-frequency sound is
  heard on the marked versions. Marking stays as built and on by default; the
  variant work is stopped pending an owner decision.
- Two qualified build options for cheaper marking, both off by default:
  `marker_variant = "float16"` (half-float storage of the marker graphs,
  29.5 MB instead of 58.8 MB, from `tts-browser-runtime/v6`) and
  `marking_worker = true` (the generator in a second worker, loading while the
  model loads and marking in parallel with synthesis; byte-identical marked
  output). Both passed the detection, false-alarm, SNR and identity gate of the
  float32 marker; int8 storage and a polyphase rewrite of the transposed
  convolutions also passed but are not wired (no further gain). Measured on this
  Mac: first output 3.46 s with the default marker, 2.34 s with both
  options, 1.88 s without marking. `docs/output-marking.md`.
- Output marking, on by default (owner decision 2026-11-25: "Let's add marking to
  the space and code but people can freely choose to deactivate when they deploy
  themselves."). Every output carries an AudioSeal watermark (MIT code and
  weights, pinned; fixed 16-bit message `DV`), computed at 16 kHz on a resampled
  copy and added at 24 kHz to the unchanged samples; exported WAV files add RIFF
  INFO and XMP metadata (IPTC digital source type for AI-generated media). The
  worker marks every segment before listing, playback and export, including
  speaking-rate and comparison outputs; a marker that fails stops the synthesis
  with a plain error, never unmarked output. Detector: `just detect FILE...`,
  `python -m designed_tts.mark detect`, `window.tts.detect(arrayBuffer)` (no new
  control). Off switch for self-deployers: `marking = false` in the preview
  config, `load_release(..., marking=False)` in Python; the uploader refuses a
  package without marking. The page text of the model paragraph names the
  marking. The unmarked model output stays in `result.audio` and keeps every
  identity hash; marked hashes are a separate stage. Runtime
  `tts-browser-runtime/v5` (v4 plus `marker/`). Costs on this Mac: 58.8 MB more
  for the first synthesis, 107 ms marking per second of audio. No claim of legal
  compliance; nobody has listened yet. `docs/output-marking.md`.
- Drop the 100,000,000-byte package limit. Owner decision (2026-11-25): "the
  100 MB limit was arbitrary and since each model is downloaded individually
  there is no issue at all." The packager and the static package check measure
  and report the complete size and the bytes per family; `--budget <bytes>` and
  `PACKAGE_BUDGET=<bytes>` set a limit on request, default none. The manifest
  no longer carries `packageWithinBudget`, and the page no longer shows the
  "exceeds the 100 MB target" status. All other packager checks are unchanged.
- Release candidate C: Voca64, German Kale (new weights) and English Kale with our
  own four voices, all at full precision, on the default preview. New Space card
  `space/README.voca-kale-de-en.md`; model copy for the three families. The
  reduced English waveform graph stays registered and is not served. Voca64
  output is unchanged.

- New German Kale weights and an English Kale model with our own four English
  voices, preview only; nothing is published. Owner decision (2026-11-24): the
  new German Kale is released together with the English voices.
  - German Kale (`tts-kale-german-model/v7`): the same four voices, architecture
    and inference rule; trained on 32,261 takes (35.87 h) rendered again with the
    larger teacher Qwen3-TTS-12Hz-1.7B-Base, pitch targets from the JDC extractor
    of StyleTTS2 (training only). The owner compared it with the released weights
    by ear.
  - English Kale with our own voices, family id `kale-fresh-en`
    (`tts-kale-english-model/v2`): four General American voices `fresh-en-f03`,
    `fresh-en-f14`, `fresh-en-m03`, `fresh-en-m08`, 31,916 takes (37.15 h). It is
    the German family type (same token table, German rules, `toKale`, default
    English plans without a word break inside hyphenated words), not the public
    English model `kale-en`, whose code and files stay but are no longer served.
  - Release `tts-portable-model-releases/v5`: both converted on the Mac from the
    pinned checkpoints, byte-identical to the training-host conversions whose
    native parity is sample-exact. Browser export `tts-browser-runtime/v4`: float32
    gates on the four frozen German cases, 64 German and 68 English held-out
    calls (durations and sample counts exact, error at most 0.3 % of the peak);
    Chrome CPU-WASM exact durations and samples for every voice.
  - Reduced precision: the int8 rule of the public English model fails the bar
    for both new fits (log-mel distance up to 0.22 against 0.20), so it is not
    used. New storage rules in `reduce_release`: `sound-int8` and `sound-float16`
    leave the whole text side float32; `parts` reduces only some graphs. German
    Kale with our English Kale fits the budget only with the English waveform
    graph as `sound-float16` (log-mel distance at most 0.009, 97.3 MB of served
    assets); at full precision the package is 107,354,853 bytes. Voca64 with both
    Kale families does not fit with any qualified variant (smallest 107,917,653
    bytes); only the failing int8 rule would fit.
  - Preview configs: `[directories]` maps a family to a reduced copy; the default
    preview serves Voca64 with the new German weights. New Space card
    `space/README.kale-fresh-de-en.md`, model card drafts in the release root,
    model copy `Kale Nano DE` / `Kale Nano EN` with four English voices. The
    packager reports the complete size when it exceeds the budget.
  - New: `tools/check-kale-fresh-english.mjs` (in `just check-preview`): 200 of
    200 held-out sentences give exactly the training symbols, stress and token
    ids through the served WASM frontend in Chrome. `tools/german-plans.mjs`,
    `tests/fixtures/english-kale-held-out.jsonl`.
  - Runtime identity: Voca64 hashes unchanged; German Kale hashes change by
    design (new weights). Nobody has listened to the exported graphs.

- Fix German words that the pronunciation dictionary had wrong, preview only:
  "räum" and "träum" were read as two vowels ("re-um"), "Fräulein" with a plain
  o, French plurals such as "Ingenieure" with the German diphthong, and some
  entries had no vowel for ä or the phones of another word. The previews now
  take version 3 of the Phony browser assets, whose packed German
  dictionary contains 87 reviewed corrections (84 entries replaced, 3 words
  added, among them "Linoleum") on top of the unmodified upstream dictionary.
  The Phony WASM builds are unchanged: the corrections are data, and
  `frontend.json` records their count and the hash of the corrections file.
  Words that are right stay as they are (Jubiläum, Museum, beurteilen, geübt,
  Friseur). New `tools/check-german-corrections.mjs` (in `just check-preview`)
  reads corrected and untouched words through the served WASM frontend in
  Chrome, checks planned durations and synthesises four sentences with German
  Kale; it fails on assets without the corrections. The reference of
  `tools/check-runtime-identity.mjs` is unchanged (no corrected word in it).
  The package now carries the list of dictionary changes
  (`assets/frontend/german-corrections.toml`) next to the frontend notice, which
  states that the dictionary was modified (CC BY 4.0). Nobody has listened to
  the corrected words. The models were trained on the old phones of these
  words (61 of 48,891 training sentences contain one, "räum" in 43). Nothing is
  published. Audit, list and open questions (among them "für", which the
  dictionary reads as a weak form): Phony `docs/german-dictionary-audit.md`.

- Add the public English model Kale TTS 1 Nano (Kale Computer, Apache-2.0) as a
  third model family, `kale-en`, preview only: nothing is published and the
  default build is unchanged. The weights are upstream's, not retrained; eight
  American English voices (the two British voices need phones this frontend does
  not produce). What is new here:
  - Model release and loader: `convert_upstream_english` reads the pinned public
    download (every file by hash) into the portable layout; all 335 network
    tensors are bit-identical, the voice tables hold the released rows.
    `kale_english_inference.py` implements upstream's English inference rules
    (at least one frame per token, per-voice end clamp and unvoicing floor),
    which differ from German Kale.
  - Export: split planner and waveform graphs with fixed noise, as for German
    Kale, and a reduced-precision copy for the browser (14.6 MB instead of
    31.9 MB): int8 weight matrices in the sound generator, half floats for its
    recurrent weights and the pitch and energy predictor, generated Fourier
    bases. Everything the planned durations depend on stays float32; with
    upstream's rule (half floats there too) 17 of 1,672 planner calls changed
    length by one frame. Gates: float export against PyTorch on 136 calls
    (durations exact, error at most 0.10 % of the peak), reduced files against
    the float export (same length 136 of 136, log-mel distance at most 0.150,
    bar 0.20), Chromium CPU-WASM for both.
  - Frontend: the English plans are mapped to upstream's token ids in Phony
    (`toKaleEnglish`: several ids per unit, space after marks, syllabic rule;
    ids identical to the reference mapping on 200 held-out sentences). For this
    family only, the parts of a hyphenated word are separate words in the plan
    (`twenty-nine` as two words), because the model was trained with a space
    there and runs the parts together without it. Phones and stress are
    unchanged, and so are the plans of Voca64 and German Kale: the option is off
    by default and the 404 training plans still match. One line of the vendored
    Dizione normalizer now records that a word followed a hyphen.
  - Configuration: the families a build serves are set in the preview config
    (`families`). The default stays Voca64 with German Kale. A second
    configuration, German Kale with English Kale, has literal model names (`Kale
    Nano DE`, `Kale Nano EN`), its own Space card and model card, and passes the
    same browser suite, which now reads the families from the manifest. All
    three families together exceed the package budget.
  - New: `tools/convert-upstream-english.py`, `tools/export-browser.py`,
    `tools/check-reduced-precision.py`, `tools/check-kale-english.mjs`,
    `tools/english-plans.mjs`, `tools/preview-profile.mjs`,
    `web/english-hyphens.mjs`, `tests/test_kale_english.py`,
    `tests/english-hyphens.test.mjs`.
  Open and not decided here: whether Voca64 leaves the Space, whether the page
  says that the speech is AI-generated (upstream asks for that), and how the
  English voices are named.

- Fix the English browser frontend passing punctuation symbols to the models that
  no training plan contains. Dizione emits `"`, `'` (as a quotation mark or after
  a plural possessive), `(`, `)`, the dash and the ellipsis as plan symbols; the
  Python frontend that produced every training plan kept only `, . ? ! ; :` and
  read the words around any other mark as one phrase. The English path now does
  the same: marks outside `, . ? ! ; :` are removed from Dizione's token stream
  before clauses are built, so the words on both sides share sentence stress and
  linking as in training (`sir--about` has its linking r again). An ellipsis
  stays a sentence end: between words it is read as a period, next to another
  mark it is dropped. Apostrophes inside words and Dizione's reduced forms
  (`'em`, `'n'`) are unchanged, and accented letters keep the browser reading
  (`café`), which the training frontend cut short. Text without these marks
  gives the same plan and the same audio as before. German, Phony, nrmlz and all
  model files are unchanged.
  The plans of all 404 English training texts are a committed fixture
  (`tests/fixtures/english-training-plans.jsonl`); the English path reproduces
  404 of 404 (385 before). New unit tests `tests/english-marks.test.mjs`, new
  fixtures in `just check-english`, new browser check
  `tools/check-english-marks.mjs` in `just check-preview`.

- Extend the browser app, preview only until the owner has reviewed it:
  - Speaking rate from 0.75 to 1.5 in steps of 0.05. The planner's integer frame
    counts are rescaled before the waveform model (`round(d / rate)`, silent
    tokens stay silent, spoken tokens keep at least one frame). At 1.0 the
    planner output is passed on untouched and the audio is bit-identical to the
    previous release. Frame and one-minute limits still apply; a rate that would
    exceed them fails with a localized error instead of a shortened output.
    `window.tts.synthesize` accepts `speed`; results and the measurements export
    record it, and the real-time factor uses the actual audio length.
  - Outputs list: the last eight outputs of the session with model, voice, speech
    language, rate, duration and the beginning of the text, each with play and
    WAV download. Selecting a row shows its waveform, reading display and
    measurements. The list lives in page memory only and can be cleared.
  - Optional comparison voice from either model for the chosen speech language:
    one Generate renders the same text with both voices and lists them together.
  - Reading display: the normalized text that was read and, collapsed, the
    phonemes.
  - Five example sentences per speech language instead of one sample each, and
    Ctrl/Cmd+Enter in the text field as the keyboard path to Generate.
  - New browser checks `tools/check-speaking-rate.mjs` and `tools/check-outputs.mjs`
    in `just check-preview`; unit tests for the rate rule and the examples.

- Ship new German Kale weights in the browser: the same four voices, trained on
  36 hours of filtered takes covering 32,120 different sentences instead of 372.
  The owner compared it with the previous weights on held-out sentences and
  approved the release (slightly better rhythm, slightly less robotic). Native
  conversion is bit-exact, the split ONNX export passes the unchanged native and
  browser parity gates, and the full browser suite passes. Voca64 is unchanged.
  The export and runtime code did not change; only the Kale model files did.

- Remove the institute logo’s white background as requested. Derive a transparent
  PNG from the retained official JPEG, without resizing or cropping, unmatte the
  edges to avoid white halos, and keep its bottom-right placement. Verify decoded
  transparency, source hash, aspect ratio and offline display in both UI locales.

- Publish to the existing static Space through the verified-package SDK uploader,
  avoiding the CLI's unrelated Gradio/Docker organization-plan preflight. Account
  for the host's HTML metadata additions and reserved Hub README route when
  verifying source checksums versus served runtime bodies.

- Package the owner-authorized static Hugging Face Space with checksum-verified
  assets, complete component notices/model cards, private-path rejection and a
  strict complete-package byte gate. Remap private Rust build paths and verify
  exact unchanged browser PCM. Test against a standalone static file server.
- Make the locale-error fixture explicitly clear persistent inference caches and
  verify its injected failure was exercised: HTTPS/loopback legitimately cached
  the previous successful model, bypassing the network-failure fixture.

- Qualify the nrmlz German short-group correction in actual browser synthesis:
  zero-prefixed phone extensions such as `-01` now retain “null eins” instead of
  becoming the cardinal “eins”. Test `01`, `02`, `00` and `001` through WASM,
  phonemization and both acoustic models. No model weights or DSP changed.

- Use the official Fraunhofer IEM logo at the bottom right of the footer instead
  of a text-only institute link. Embed the original image locally and preserve its
  aspect ratio and composition. Clarify DE/EN copy: speech is generated locally in
  the browser, not on a “browser CPU”.

- Remove the ENGAGE-KI header wordmark and add a Fraunhofer IEM link at the bottom,
  as requested by the owner. Keep the localized speech-synthesis label, DE/EN
  controls and full funding acknowledgement unchanged.

- Restore genuine sentence-end pauses with Phony's opt-in WASM sentence planner.
  Period tokens were retained but could receive zero duration; grouping a short
  paragraph into one model utterance therefore ran sentences together. Render real
  sentence boundaries using the models' existing BOS/EOS behavior, without inserted
  silence, DSP, new weights or changes to single-sentence synthesis. Preserve the
  separate regression against false mid-phrase breaks and test DE/EN punctuation,
  abbreviations, exact per-sentence waveforms and actual boundary quiet.

- Ship complete German and English interface copy from one message catalogue, with
  a DE/EN header control and `window.tts.setLocale('de'|'en')` as its API
  equivalent. The interface locale is separate from the speech language, persists
  best-effort locally and never changes the draft, selection, audio or measurements.
- Localize every dynamic state (loading, progress, errors, cancel, autoplay
  fallback, counts, stage and metric labels, ARIA names, download names) and fail
  closed on unknown locales or messages instead of showing partial text.
- Replace slogan copy with literal task labels in both languages and keep the
  approved German funding acknowledgement verbatim, with an equivalent English text.
- Add `docs/ui-language.md`, `tests/i18n.test.mjs`, `tests/errors.test.mjs` and a
  real Chrome bilingual browser check.

- Move model download/startup status and verified-byte progress beside model
  selection; keep loading out of the audio waveform surface.
- Generate-and-play now starts the actual generated audio automatically, with
  an explicit tap-to-play fallback when browser autoplay policy blocks it.
- Fix empty-text feedback, paused-playback action labels, mobile select clipping
  and small-button contrast without changing the approved visual palette.
- Add browser canonical-Unicode phoneme/duration checks for German umlauts.

- Add a real static browser CPU-WASM preview with German/English editable text,
  fixed model/voice selection, actual waveform, WAV export, cancellation and
  live scoped metrics. Preview comes before public Space deployment.
- Run full English rules in QuickJS WASM with Phony Rust lexical/neural bridges;
  split ONNX planner/wave graphs keep duration checks before allocations.
- Fix artificial mid-phrase stops caused by32-phone chunks: short utterances now
  remain intact, with genuine punctuation preferred for long-text boundaries.
- Add exact native/ONNX/browser parity, English-source and segmentation regressions.

- Acknowledge BMFTR funding through ENGAGE-KI and PTKA project supervision in
  the release footer, independently of component licences and upstream attribution.

- Add strict, checksum-verified CPU safetensors loaders for separate Voca8,
  Voca64 and German Kale generators. Portable native output is exactly equal
  to the original fixed checkpoints on twelve retained phoneme-plan cases.
- Keep only required Kokoro neural components, avoiding the full package's
  Misaki/eSpeak dependency chain. Preserve source licences and upstream lineage.
- Add seven Python contract tests; native parity is not browser qualification.

- Add a versioned browser telemetry core for real stage timings, real-time
  factors, configured CPU-WASM threads, scoped memory, asset/cache byte counts
  and origin quota estimates. Unsupported system metrics remain unavailable.
- Add six deterministic contract tests and a real Chromium metrics API probe.
  Engine integration and the public Space are not completed by this change.
