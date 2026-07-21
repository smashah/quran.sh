# Performance baseline

Captured on 2026-07-21 with Bun 1.3.14 on macOS arm64. `bun run perf` rebuilds the package and writes machine-readable JSON plus Markdown under `artifacts/performance`; CI records the same outputs on Linux without treating the two platforms as interchangeable.

| Probe | v0.6 before lazy graph | v0.7 | Blocking budget |
|---|---:|---:|---:|
| `quran --help` wall time | ~230 ms | 19.75 ms | 300 ms |
| `quran --help` peak RSS | ~142.8 MB | 23.46 MB | 96 MiB |
| startup JavaScript | ~65.1 MB single bundle | 2,445 bytes | 32 KiB |
| complete deferred JS package | n/a | 65.71 MB | 80 MiB |
| compiled macOS arm64 binary | n/a | 158.08 MB | 220 MiB |
| 20-cycle cleanup latency | n/a | 0.02 ms | 500 ms |
| post-unload allocator delta | n/a | 51.02 MB | 96 MiB |

The v0.7 build has 43 deferred chunks. English Quran text and transliteration form the required reader data chunk; nine optional translation chunks, the PNG decoder, Effect-backed resource management, Tilawa, OpenTUI Audio, OpenTUI Three, study repositories, and alternate TUI experiences are absent from the startup entry. The lazy-graph verifier fails when heavy markers enter `dist/index.js` or that entry exceeds its budget.

Deterministic lifecycle tests also exercise 100 concurrent acquisitions, 20 activation/unload cycles, cancellation during loading, exact-once disposal, playback-generation replacement, bounded recognition events, and renderer shutdown. The RSS probe warms Bun's allocator before measuring; freed pages may remain available to Bun, so its 96 MiB blocker detects continued growth rather than pretending retained allocator pages are a live feature resource. Hardware-specific audio, microphone, ONNX, and WebGPU measurements remain informational in CI because unavailable hardware must not make the text reader flaky.
