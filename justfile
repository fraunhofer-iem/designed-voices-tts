check: test-web test-python

test-web:
    bun test tests/metrics.test.mjs

check-browser:
    bun tools/check-metrics-browser.mjs

test-python:
    uv run --python 3.12 --extra kale --extra export python -B -m unittest discover -s tests -p 'test_*.py'
