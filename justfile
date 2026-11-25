check: test-web test-python

test-web:
    bun test tests/metrics.test.mjs tests/loading.test.mjs tests/i18n.test.mjs tests/errors.test.mjs tests/rate.test.mjs tests/examples.test.mjs tests/design.test.mjs tests/english-marks.test.mjs tests/english-hyphens.test.mjs tests/profile.test.mjs tests/wav.test.mjs

check-browser:
    bun tools/check-metrics-browser.mjs

test-python:
    uv run --python 3.12 --extra kale --extra export python -B -m unittest discover -s tests -p 'test_*.py'

build-web:
    bun tools/build-english.mjs
    bun tools/build-web.mjs

package-space preview output:
    bun tools/package-space.mjs --preview {{quote(preview)}} --out {{quote(output)}}

upload-space package message:
    uv run --python 3.12 --extra export python -I -B tools/upload-space.py {{quote(package)}} --message {{quote(message)}}

preview config:
    bun tools/serve-preview.mjs --config {{config}}

check-preview:
    bun tools/check-preview.mjs
    bun tools/check-segmentation.mjs
    bun tools/check-sentence-pauses.mjs
    bun tools/check-loader-playback.mjs
    bun tools/trace-umlauts.mjs
    bun tools/check-german-corrections.mjs
    bun tests/bilingual-browser.mjs
    bun tools/check-locale-state.mjs
    bun tools/check-branding.mjs
    bun tools/check-phone-groups.mjs
    bun tools/check-speaking-rate.mjs
    bun tools/check-outputs.mjs
    bun tools/check-english-marks.mjs
    bun tools/check-kale-english.mjs
    bun tools/check-kale-fresh-english.mjs
    bun tools/check-marking.mjs

check-english assets phony:
    ENGLISH_ASSETS_DIR={{assets}} PHONY_WASM_DIR={{phony}} bun test tests/english.test.mjs
    ENGLISH_ASSETS_DIR={{assets}} PHONY_WASM_DIR={{phony}} bun tests/english-browser.mjs

# Check files for the output watermark: just detect FILE... (marker directory from DESIGNED_TTS_MARKER,
# or pass --marker DIRECTORY among the arguments).
detect +files:
    uv run --python 3.12 python -I -B -m designed_tts.mark detect {{files}}

# Export the AudioSeal marker graphs from the pinned checkpoints into a new directory.
export-marker generator detector output:
    uv run --python 3.12 --extra export --extra marker-export python -I -B tools/export-marker.py --generator {{quote(generator)}} --detector {{quote(detector)}} --out {{quote(output)}}
