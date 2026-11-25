# Designed Voices TTS

Compact German/English speech synthesis with separately trained tiny-voca and
Kale Nano model families. Includes portable CPU reference inference, model source
and a standalone CPU-WebAssembly browser app. Complete training recipes remain
in preparation.

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

## Marking of the outputs

Downloaded WAV files contain metadata that marks them as AI-generated speech: a
RIFF INFO comment and an XMP entry with the IPTC digital source type
`trainedAlgorithmicMedia`, both naming the generator Designed Voices TTS. This
holds for the browser app and for `model.synthesize_wav(...)` in Python. Read it
with `ffprobe -show_format FILE` (shown as `comment` and `encoder`) or
`python -m designed_tts.mark detect FILE...`. An AudioSeal audio watermark is
available as an option (`marking="watermark"`) and is not on by default;
`marking="off"` writes plain files. See [output marking](docs/output-marking.md).

## Prohibited use

Use must comply with applicable law. Do not use these models or their outputs to
imitate a real person's voice or identity, to present generated speech as a
recording of a real person, to deceive people (for example fraudulent calls, fake
news or misinformation), or to produce unlawful, harassing, defamatory or
discriminatory content. The voices are fictional designed voices.

## Native model releases

- Voca8/Voca64: https://huggingface.co/Fraunhofer-IEM/tiny-voca-de-en
- German Kale: https://huggingface.co/Fraunhofer-IEM/kale-nano-de

See [model format](docs/model-format.md), [live metrics](docs/live-metrics.md)
and [third-party notices](THIRD_PARTY_NOTICES.md). Complete training recipes
remain in preparation.

## Browser Space

https://huggingface.co/spaces/Fraunhofer-IEM/designed-voices-tts

Static German/English UI and local CPU-WASM synthesis with Voca64 and German Kale.
A second build configuration (preview only, not published) serves German Kale
with the public English model Kale TTS 1 Nano instead of Voca64.
No prerecorded sample lookup or server-side inference. See the
[release procedure](docs/space-release.md) for packaging, notices, exact hashes and
live browser verification; browser/device support is qualified separately.

---

Gefördert durch das Bundesministerium für Forschung, Technologie und Raumfahrt
(BMFTR) im Rahmen des Projekts ENGAGE-KI. Betreut vom Projektträger Karlsruhe
(PTKA). https://engage-ki.de/
