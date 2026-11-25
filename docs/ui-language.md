# Interface language (DE/EN)

The browser preview ships two complete interface languages: German and English.
This document is the contract for copy changes and for the tests that guard them.

## Where things live

| Path | Role |
| --- | --- |
| `web/i18n.mjs` | Single message catalogue for both locales, plural rules, interpolation, fail-closed lookups |
| `web/errors.mjs` | Maps worker/engine/loader messages to catalogue keys; keeps the raw text as diagnostic detail |
| `web/app.mjs` | Applies static copy from `data-i18n*` hooks and re-renders every dynamic value from state |
| `web/index.html` | German default copy plus `data-i18n`, `data-i18n-html`, `data-i18n-aria-label` hooks |
| `docs/funding.md` | Source of truth for the approved German funding acknowledgement |

`window.tts.setLocale('de' | 'en')` is the API equivalent of the header control.
`window.tts.getLocale()` returns the active locale, and `window.tts.status()`
includes it. The preference is stored best-effort in `localStorage` under
`engage-ki-tts-locale`; blocked storage or an unknown stored value falls back to
the German default instead of failing.

## Rules

- German is the default interface locale; the header DE/EN control is the only
  locale switch and is separate from the speech-language select.
- Switching locale re-renders copy only. Draft text, model, speech language, voice,
  generated audio, playback position, in-flight loading progress and measurements
  are untouched. Status and error descriptors remain semantic until rendered,
  so already displayed errors and active stages also change language correctly.
- A fresh page with a saved English preference starts with an English sample
  and Voca64. Changing locale within a running page preserves speech choices.
- The example buttons are named after what they show (statement, question, date
  and time, amount, abbreviation) in the interface language. They insert the
  sentence for the chosen speech language from `web/examples.mjs` and change
  nothing else. Example sentences are speech content, not interface copy.
- A locale change also leaves the speaking rate, the comparison voice, the
  outputs list, the selected output and its playback untouched, including while
  a model is loading or a synthesis is running. Rows, the reading display and
  download names are re-rendered from state in the new language.
- Numbers produced by the page (rates, seconds, megabytes) use a decimal point in
  both languages, as the measurements always have.
- Every message is a complete sentence or label with named `{placeholders}`.
  Do not concatenate fragments or build sentences from translated parts.
- Keys ending in `.one` / `.other` are selected with `Intl.PluralRules` when a
  numeric `count` parameter is passed.
- Unknown locales, unknown keys and missing parameters throw
  (`UNKNOWN_LOCALE`, `MISSING_MESSAGE`, `MISSING_PARAMETER`) instead of rendering
  half-translated text.
- Only `TRUSTED_HTML_KEYS` may carry markup. `app.mjs` refuses any other
  `data-i18n-html` hook. Everything else is plain text.
- Technical errors may keep their diagnostic text, but the user-facing summary is
  localized. Unknown messages appear as `error.unknown` with the raw text as the
  detail, so nothing is swallowed.
- Engine and worker strings are not edited for translation; add a mapping in
  `web/errors.mjs` when new technical text appears.
- Copy names the task literally: text, audio, measurements, models and runtime.
  No slogans, no qualitative claims, no invented obligations or disclaimers.

## Funding acknowledgement

The German message `funding.text` must stay character-for-character identical to
the approved block in `docs/funding.md` (markup aside); `tests/i18n.test.mjs`
compares them. The English message names the same institutions:
Bundesministerium für Forschung, Technologie und Raumfahrt (BMFTR), ENGAGE-KI and
Projektträger Karlsruhe (PTKA). The plain project URL stays in the footer.

## Measurement and notice scopes

The ONNX size badge counts only planner/wave graphs. Selected-profile loading
also includes its frontend, runtime and noise files; progress counts completed
checksum verification, not wire traffic. Cached bytes mean stored bodies, not
necessarily bytes read from cache during that request.

Translation does not add a misuse disclaimer, audio marker or new licence term.
The separate researched proposal is in `release-notice-review.md`.

## Verification

```bash
bun test tests/i18n.test.mjs tests/errors.test.mjs
PREVIEW_URL=http://127.0.0.1:8894/ bun tests/bilingual-browser.mjs
PREVIEW_URL=http://127.0.0.1:8894/ bun tools/check-locale-state.mjs
PREVIEW_URL=http://127.0.0.1:8894/ bun tools/check-outputs.mjs
```

The browser check runs real Chrome against the static preview server and covers
both locales' static copy, loading, error, cancel, autoplay-fallback and
measurement states, ARIA names, download names, the phone viewport, the stored
preference, and that switching locale preserves draft, selection, audio,
playback and measurements.
