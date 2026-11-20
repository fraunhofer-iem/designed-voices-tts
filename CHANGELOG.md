# Changelog

## Unreleased

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
