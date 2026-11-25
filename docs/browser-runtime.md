# Browser runtime

The preview is static HTTP content. All inference happens in a worker: nrmlz
WASM normalizes text; Phony Rust/WASM supplies German and English lexical/neural
primitives; complete English Dizione phrase/rule handling runs inside QuickJS
WASM. No JavaScript/Python host neural fallback or remote text inference.

Model planning and waveform generation are separate ONNX CPU-WASM graphs. The
planner returns predicted durations before waveform allocations; frame limits are
checked first. German Kale keeps real-phone minima, zero-time stress and the25Hz midpoint;
the English Kale family has its own rules (see English Kale).
Voca retains its original oscillator/filter behavior. Both use the original fixed
neutral Torch noise streams, including length-dependent final SIMD blocks.

Keep short **sentences** intact, not whole multi-sentence paragraphs. The initial
32-phone splitting introduced false utterance ends inside phrases and was rejected.
The subsequent128-phone fix removed those false breaks, but its one-chunk paragraph
assertion overlooked genuine sentence pauses: both planners can predict zero frames
for a period. That assertion proved neither phrasing nor naturalness.

The client now uses Phony's opt-in `sentencePlan(planJson, 128)` in WASM. Actual
terminal punctuation (`. ! ? …`, with runs kept together) receives separate model
BOS/EOS context even below the payload limit. English plans no longer contain `…`;
an English ellipsis arrives as a period (see English punctuation). Normalization expands abbreviations
and decimals first; raw dots are not sentence-split in JavaScript. Long sentences
retain bounded word-boundary fallback and never silently split a word. Original
spoken phones/stress/punctuation are preserved. Generic `splitPlan` behavior stays
unchanged. No inserted silent samples, fades, duration clamps, pitch changes or new
weights: each segment is the model's ordinary standalone waveform, concatenated
unchanged. Frame and total-output limits still apply.

## Model families and build configurations

Which model families a build serves is configuration, not code. `families` in
the preview config (`tools/serve-preview.mjs`) lists them; the default is
`["voca64", "kale"]`, the published pair. The other qualified sets are
`["voca64", "kale", "kale-fresh-en"]` (the release candidate, all full
precision), `["kale", "kale-fresh-en"]` (German Kale with English Kale in our own
four voices) and `["kale", "kale-en"]` (German Kale with the public English Kale
model); `kale-fresh-en` and `kale-en` are never served together. There is no
package size limit (owner decision 2026-11-25): the page downloads only the
files of the selected model, and the manifest reports the complete size.
The manifest lists the families, and the page builds its model select,
comparison voices, description and model links from it. Model names are
literal: `Kale Nano` and `Voca64` in the default build, `Kale Nano DE` and `Kale
Nano EN` when an English Kale family is served. A model offers only its own
speech language; the other option of the language select is disabled, as before
for German Kale.

`[directories]` in the preview config names the subdirectory of `runtime_root`
a family is read from when it is not the family id, for example a
reduced-precision copy (`kale-fresh-en = "kale-fresh-en-sound-float16"`). The
served URL stays `/assets/<family>/`.

A family with a vocabulary in the manifest is a Kale family (alignment input,
ids from Phony). Vocabulary version `kokoro-native-en-us` marks the public
English one; `kale` and `kale-fresh-en` share the German vocabulary block and
differ in their voices. `tools/preview-profile.mjs` gives the browser checks the
models of the preview they run against, so one suite covers every configuration.

## English Kale with our own voices

`kale-fresh-en` is a fit of the German Kale family type: the same architecture,
token table, phone and punctuation lists and inference rule (zero-time stress,
real-phone minima, fixed 25 Hz unvoicing), with the four English voices
`fresh-en-f03`, `fresh-en-f14`, `fresh-en-m03`, `fresh-en-m08`. In the browser it
takes the default English plan (no word break inside hyphenated words; that is
how its training plans were written) and the German id mapping `phony.toKale`.
None of the rules of the public English family below applies to it.

`tools/check-kale-fresh-english.mjs` (in `just check-preview`, skipped when the
family is not served) proves through the served WASM frontend in Chrome that the
200 held-out sentences of `tests/fixtures/english-kale-held-out.jsonl` give
exactly the symbols, stress and token ids the training code fed the model (also
per model call after sentence splitting), and that the application sends the
same plans. It also covers labels and selectors in both interface languages at
phone width, every English example with every voice, the sentence split, the
speaking rate, the 500-character and 512-token bounds, and screenshots.

Its browser waveform graph in the second configuration is a reduced copy with
half floats in the sound generator only (`reduce_release(..., parts=("wave",),
storage="sound-float16")`); the planner and the pitch and energy predictor stay
float32. The int8 rule of the public English model failed the bar for both new
fits (log-mel distance up to 0.22 on the male voices against 0.20), and half
floats in the pitch and energy predictor alone moved the output by up to 0.14,
against 0.01 for the same storage in the sound generator.

## English Kale (public model)

The English Kale family `kale-en` is the public model Kale TTS 1 Nano with unchanged
weights (`docs/model-format.md`), driven by this project's English frontend.
Three things differ from the other families, and only for this family:

- **Token ids.** `phony.toKaleEnglish(plan, vocabulary)` writes the plan with the
  characters upstream's frontend uses and returns one id per character: a unit can
  become several ids (`aɪɚ` is `I ə ɹ`), a stress flag becomes a mark id before
  the unit, `<sp>` is the space id, a mark that a word follows gets a space, a
  word-final schwa before `l`, `n` or `m` after a consonant becomes the syllabic
  mark, and the pad id stands at both ends. German Kale keeps `toKale`.
- **Hyphenated words.** Dizione reads `twenty-nine` as one word, so the default
  plan has no `<sp>` between the parts; Voca and German Kale were trained on
  that. Upstream's frontend writes a space there, and without it the English
  Kale model runs the parts together. For this family the engine calls
  `english.phonemize(text, {hyphenBoundaries: true})`: the part after a hyphen
  starts a new word in the plan (`web/english-hyphens.mjs`). Phones, stress,
  linking and homograph choice are those of the default plan. Letter names and
  split camelCase words stay one word. On 200 held-out sentences this changes
  11 plans, all with hyphenated number words; 64 instead of 61 sentences then
  have exactly the ids of upstream's frontend.
- **Timing.** Every token has at least one frame, so no token is silent. The
  speaking rate rescales as for the other families; a token keeps at least one
  frame.

Sentence splitting, the English marks rule and the limits are the same as for
Voca64. Nothing is inserted between sentences (upstream's own player adds
0.12 s of silence); the model's sentence ends measured 390 to 410 ms of quiet
at the boundary for the eight voices.

The browser files of this family are a reduced-precision copy of the float32
export (`reduce_release` in `browser_export.py`): sound-generator weight
matrices as int8 with one scale per slice, its recurrent weights and the pitch
and energy predictor as half floats, Fourier bases rebuilt by operators. Every
tensor the planned durations depend on stays float32, so the planner is exactly
the float planner. The float32 export stays in the runtime root as the
reference. Gate for the reduced files: same length on every case and a log-mel
distance of at most 0.20 against the float32 export
(`tools/check-reduced-precision.py`), then Chromium against the same graphs on
the desktop runtime (`tools/check-export-browser.mjs`).

`tools/check-kale-english.mjs` (part of `just check-preview`, skipped when the
family is not served) covers the model names, the voice labels in both interface
languages, every English example with every voice, the hyphen boundaries, the
served id mapping and the layout at desktop and phone width.

## English punctuation

The English training plans were made by a Python frontend that kept only the marks
`, . ? ! ; :` and dropped every other one, so the words on both sides were read as
one phrase. No training plan, German or English, contains the six other symbols of
the shared inventory: `"`, `'`, `(`, `)`, `—` and `…` (ids 11 to 16). Dizione
emits them, so before this rule the browser fed the models ids they never saw for
English text with quotation marks, parentheses, dashes, a plural possessive
apostrophe or an ellipsis. German never emitted them.

`web/english-marks.mjs` applies the training convention to Dizione's token stream
inside QuickJS, between the normalizer and the clause rules (`vm-entry.js`):

| Written | Plan |
| --- | --- |
| `"` `“ ” „ « »`, `'` as a quotation mark, `dogs'` | dropped |
| `(` `)` `[` `]` `{` `}` | dropped |
| `—`, `–`, `--`, a spaced `-` | dropped |
| `…`, `...` between words | one `.` (sentence end) |
| `…`, `...` next to another mark or before the first word | dropped |
| `don't`, `o'clock`, `'em`, `'n'`, `well-known` | unchanged words |
| `café`, `naïve` | unchanged browser reading |

A dropped mark leaves no clause break: sentence stress, linking and homograph
context run across it, as in training (`sir--about` links with an r). Which
apostrophes are quotation marks is Dizione's decision, as before. The Python
frontend also cut words at accented letters (`café` became `caf`); that is not
copied. An ellipsis keeps its role as a sentence end for `sentencePlan`: the
period is the one trained mark with that role, and a run of three periods occurs
in no training plan. `Wait... Really?! Yes.` is still three utterances. A plan
with any of the six symbols is rejected inside the VM (`ENGLISH_UNTRAINED_SYMBOL`);
the filter makes that unreachable.

Whole-text analysis is otherwise unchanged, so text without these marks gives the
same plan and audio as before. Proof: `tests/fixtures/english-training-plans.jsonl`
holds the training plan (symbols and stress) of all 404 English training texts;
`just check-english` requires 404 of 404 (385 before the rule, the 19 others have
quotation marks or a double hyphen). `tools/check-english-marks.mjs` synthesises
marked text in Chrome, requires plan and audio to equal those of the same words
without the marks, and repeats the 404-text comparison with the served bundle.

`tools/check-sentence-pauses.mjs` checks actual Chrome DE/EN rendering, exact equality
with independently rendered sentence waveforms, and measured quiet near the known
boundary. It also guards abbreviations, decimal amounts and ellipsis/?! groups.
`check-segmentation.mjs` still rejects breaks inside the short sentence containing
“neue”, while now requiring the actual three sentence endings. Software pause
measurements are not owner listening approval or a universal pause-length promise.

## Speaking rate

`web/rate.mjs` rescales the planner's integer frame count per token before the
waveform model runs: `round(d / rate)` with halves rounded up, computed on integer
hundredths. A token the planner gave no frame stays at zero (pauses the planner
left out, Kale's zero-time stress marks); a token that had at least one frame
keeps at least one. Valid rates are 0.75 to 1.5 in steps of 0.05; anything else is
rejected, not snapped. Voca receives the rescaled `durations` tensor, Kale the
alignment built from the rescaled counts. Hidden states, tokens, voice, pitch and
weights are unchanged, and the noise stream is the ordinary one for the new frame
count. Pitch shift and pitch range are not offered: they need new model exports.

At the default rate nothing is rescaled or copied: Voca gets the planner's own
tensor and Kale the alignment from the planner's own counts, so the audio is
bit-identical to a build without the feature (`tools/check-runtime-identity.mjs`,
`tools/check-speaking-rate.mjs`). The limits apply to the rescaled counts: the
frame limit of a segment is checked before the waveform model allocates anything,
the one-minute total after each segment as before. A rate that exceeds a limit
the default rate would have met fails with its own error (`error.rateChunkTooLong`,
`error.rateTooLong`). Nothing is truncated and no shortened output is listed. With 128-phone segments the per-segment limit
is not reachable in practice; the browser check exercises the one-minute limit.

## Output marking

`marking` in the preview config sets the mode (`docs/output-marking.md`):
`"metadata"` (default) puts AI-generation metadata into every exported WAV and
serves no marker file; the audio is the model output. `"watermark"` also adds
the AudioSeal watermark: the worker marks every segment right after the waveform
model, before anything is listed, drawn, played or exported, including
speaking-rate and comparison outputs; the generator (`marker.mark.onnx`) loads
with the model, the detector only for `window.tts.detect`. `result.audio` keeps
the model output (the parity and identity gates read it) and `result.marked`
holds the watermarked samples the page uses. If the marker cannot be loaded or
applied, the synthesis stops with a plain error and no output is listed. Options
of this mode: `marker_variant = "float16"` and `marking_worker = true`
(`web/marker-worker.mjs`). `"off"` exports the plain WAV.
`window.tts.status().marking` reports `{mode}` (and `method`, `error` with the
watermark).

## Page API, outputs and comparison

The UI and automation share `window.tts.synthesize`, `cancel`, `status`,
`metrics` and `detect`; worker generation IDs fence stale output. `synthesize` takes
`{text, lang, family, voice, speed, compare, autoplay}`; every field is optional
and defaults to the form. `family` is one of the families of the build (`kale`,
`voca64`, `kale-en`); a family the build does not serve is rejected as an
invalid selection. `speed` is the speaking rate. `compare` is
`{family, voice}` for a second voice of the same speech language, or `null` for
none. The result reports `speed`, the id of the listed `output` and, with a
comparison voice, a `comparison` object of the same shape.

The page keeps the last eight outputs of the session, newest first, in page
memory only: no `localStorage`, IndexedDB, Cache Storage entry or request ever
holds entered text, and a reload starts with an empty list. `window.tts.outputs()`
lists them, `selectOutput(id)` shows one output's waveform, reading display and
measurements, `clearOutputs()` empties the list and releases the audio. One audio
element plays the selected output.

With a comparison voice one Generate renders the text with the main voice and
then with the comparison voice. Each output is listed when it is ready; the main
voice is selected and played while the second renders. Only one model family is
held in ONNX sessions at a time, as before, so a comparison across families
restarts a session from files already verified in the worker; the loading panel
shows the family that is loading and returns to the selected model afterwards.
Cancel terminates the worker in either phase: no further output arrives.

The reading display shows `normalized` (what nrmlz produced and the models read)
and, collapsed, the phoneme symbols of the plan. Ctrl+Enter or Cmd+Enter in the
text field triggers Generate.

`tools/check-outputs.mjs` covers the list, selection, WAV download bytes, the
comparison voice including cancel in both phases, the reading display, every
example in both speech languages and families, the keyboard shortcut, locale
switching while idle, loading and running, the phone width and the absence of
stored or transmitted text. Cancelling terminates the
worker, not just playback. A single audio element ensures exclusive playback.
The model-selection area owns model loading/startup and selected-profile byte
progress. The progress counts checksum-verified inference bodies, not wire bytes;
100% verified does not mean ready until the actual frontend and sessions start.
Clicking Generate automatically plays the actual generated WAV. If browser policy
blocks autoplay, the audio stays available with a clear tap-to-play action. The
API defaults to silent generation unless `autoplay: true` is explicitly supplied.
`playbackSchedulingMs` is the media-play request completion, not audible latency.

WAV packaging attenuates only if needed to avoid clipping; raw generated floats
remain available for software parity tests. Unless marking is off, two metadata
chunks follow the data chunk (`web/wav.mjs`); the 44-byte header is unchanged.
`window.tts.wav(id)` returns the exported WAV of a listed output.
`window.tts.detect(arrayBuffer)` returns `{metadata, watermark}`: what the WAV
metadata says (or `null`), and with the watermark model the detector's score,
decision and message bits (otherwise `null`). It is an API only, the page has no
control for it.

`web/metrics.mjs` reports stage wall times, RTF, configured backend/threads,
registered frontend linear-memory capacities, available heap/quota estimates and
verified asset body/cache counts. HTTP tailnet preview lacks secure-context Cache
Storage/quota APIs; values stay unavailable rather than becoming fake disk/RAM.
ORT/QuickJS hidden allocations are not included in frontend-memory capacity.

German decomposed umlauts must be composed before lexical normalization in Rust;
otherwise visually identical text can turn into split words and spelled letters.
The nrmlz default-profile fix composes NFC in WASM; the frozen reference profile
remains unchanged. Canonical input variants must produce identical phonemes,
Kale IDs and durations. Correct tokens and waveform parity are not listening
approval; remaining pronunciation errors can still belong to dictionaries/models.

German dictionary corrections: from version 3 of the Phony browser assets on, the
packed German dictionary contains reviewed corrections on top of the unmodified
upstream dictionary (87 entries: `räum` and `träum` were read as two vowels,
`Fräulein` with a plain o, French plurals such as `Ingenieure` with the German
diphthong; `Linoleum` is added because the fallback model read it with the
diphthong). They are data only. The Phony WASM builds are the same as before, and
`frontend.json` records `german_corrections` with the count and the SHA-256 of the
corrections file; the file itself is served next to the frontend notice. Both
preview configurations point `phony_root` at that runtime directory.
`tools/check-german-corrections.mjs` reads corrected words, words that must stay
(Jubiläum, Museum, beurteilen, geübt, Friseur, Räume) and both Unicode forms
through the served WASM frontend in Chrome, requires a planned duration for every
phone from the German Kale planner and synthesises four sentences with German Kale
through the application. It fails on assets without corrections. The reference of
`tools/check-runtime-identity.mjs` contains no corrected word and stays byte-equal.
The models were trained before the corrections and learned the old phones of these
words; matching phones and generated audio are not a listening result. The audit,
the list and the open questions are in Phony, `docs/german-dictionary-audit.md`.

For German phone/code chains, zero-prefixed short groups must remain digit words,
not cardinals: `-01` is “null eins”, not “eins”. The nrmlz default correction changes
only this short-group handling; ISO dates retain precedence, two-part ranges and
non-zero-prefixed short records keep their existing readings, and frozen reference
behavior is unchanged. `tools/check-phone-groups.mjs` verifies real served WASM,
leading zeros through phonemization and audio generation in Kale and Voca, with a
before/after runtime hash guard. Owner input remains private; fixtures are synthetic.

The user requested Owlznest preview before any Space upload. Current preview
approval does not imply public Space deployment, physical-phone certification or
cross-model voice tier equivalence. Model/source hashes and actual browser proofs
are recorded with registered browser runtime artifacts before final publication.
