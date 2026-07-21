# Optional feature contract

`src/features/runtime.ts` is the only application lifecycle boundary for optional heavy work. A catalog definition puts its dynamic `import()` inside `load(signal)`, acquires one resource, and returns a quran.sh-owned value plus an idempotent finalizer. React receives serializable state and stable commands through `src/features/react.tsx`; feature libraries, Effect types, OpenTUI audio objects, ONNX sessions, and Three objects do not cross their adapters.

The state machine is `idle → loading → ready → stopping → disabled`, with `loading → failed` on a retryable boundary error. Activating from failed or disabled starts a new generation. Concurrent activation shares one promise; disable increments the generation, aborts initialization, waits for it to settle, and disposes a successfully acquired late resource. Shutdown disables every definition once and permanently rejects later activation.

A new adapter must prove all of these before joining `createFeatureCatalog`:

- Its implementation, optional package, assets, network calls, device access, workers, and caches are unreachable from `dist/index.js`; `bun run verify:lazy` enforces the startup edge.
- Initialization observes the supplied `AbortSignal`, and the returned finalizer releases every timer, listener, stream, worker, file/database handle, native session, temporary file, GPU object, and bounded cache it owns.
- Errors use a stable quran.sh code and user-safe message at the runtime boundary. Upstream objects and Effect errors stay internal.
- Events are bounded or sampled before they reach React. Fake resources cover cancellation, concurrency, retry, unload, and shutdown without network, microphone, audio, model, or GPU hardware.
- `bun run perf` records its first-load, steady-state, and cleanup cost separately from the default path. Features with persistent disk state provide inspect, verify, attribution, and removal commands.

Effect 3 is allowed inside dynamically loaded adapters when scoped acquisition or untrusted schema validation materially helps. It must not appear in `src/index.ts`, `src/features/runtime.ts`, React component types, or the default startup graph; `Effect.suspend` is not a substitute for JavaScript `import()` splitting.
