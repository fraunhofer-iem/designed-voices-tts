# Live browser metrics

The browser UI and headless checks use `web/metrics.mjs` and its versioned JSON
snapshot `designed-tts/live-metrics/v1`. No private text or transcript is included.

- Stage latency and synthesis/end-to-end real-time factors are measured around
  actual operations. Playback-ready scheduling is not physical audible latency.
- `run.speakingRate` records the rate of the run. Real-time factors divide by the
  duration of the samples that were produced, so a slower or faster rate changes
  the factor through the actual audio length, never through the planned one.
- Each listed output keeps the snapshot of its own run. The measurements area and
  the JSON export show the selected output; during a run they show that run.
- Backend, SIMD and active thread configuration come from the running engine.
  Browser-reported logical processors are not a CPU model or certified minimum.
- WASM capacity counts registered memory objects once and observes growth. It is
  not process RSS. Browser JS heap estimates are separately labelled and must
  not be added to WASM capacity as if the accounting domains were disjoint.
- Asset body/cache bytes come from the loader's completed reads and cache
  operations. They are not compressed wire-traffic measurements. Cache hits must
  be known from Cache Storage, never inferred from a zero ResourceTiming value.
- Storage estimates describe origin usage/quota, not physical free disk.
- System CPU percentage, process RSS and physical free disk are explicitly
  unavailable in a normal webpage. Missing APIs never become reassuring zeroes.

Run `just test-web` for deterministic clock, unavailable-API, memory-growth,
cache/quota, stale-callback and invalid-input tests. Runtime and real-browser
claims require separate actual engine/deployment evidence.
