# Designed Voices TTS

Compact German/English speech synthesis with separately trained tiny-voca and
Kale Nano model families. Includes portable CPU reference inference, model source
and browser telemetry. Training recipes and the complete CPU-WebAssembly showcase
are being prepared; this source release does not claim they are finished.

The model families are independent: voice vectors are checkpoint-specific, and
these fixed-roster models do not offer reference-audio zero-shot cloning.

## Reference code

```sh
uv sync --extra kale --extra export
just check
```

The Python API loads a directory containing checksum-pinned `config.json` and
`model.safetensors`:

```python
from designed_tts.release import load_release
model = load_release("models/example")
print(model.voices)
```

## Native model releases

- Voca8/Voca64: https://huggingface.co/Fraunhofer-IEM/tiny-voca-de-en
- German Kale: https://huggingface.co/Fraunhofer-IEM/kale-nano-de

See [model format](docs/model-format.md), [live metrics](docs/live-metrics.md)
and [third-party notices](THIRD_PARTY_NOTICES.md). Complete training recipes
remain in preparation.

The Space is not yet qualified or deployed. No prerecorded sample lookup or
server-side inference is substituted for the browser implementation.

---

Gefördert durch das Bundesministerium für Forschung, Technologie und Raumfahrt
(BMFTR) im Rahmen des Projekts ENGAGE-KI. Betreut vom Projektträger Karlsruhe
(PTKA). https://engage-ki.de/
