# ADR 001: Keep the feature runtime small; load Effect with heavy features

- Status: accepted
- Date: 2026-07-21
- Epic: https://github.com/smashah/quran.sh/issues/16
- Decision issue: https://github.com/smashah/quran.sh/issues/17

## Context

quran.sh is adding optional content packs, decoded Mushaf images, audio, speech
recognition, microphone capture, and WebGPU scenes. Those features need typed
failures, cancellation, bounded work queues, and reliable cleanup, but none of
their code or assets should be part of the text-only startup path.

The pre-upgrade baseline imports eleven Quran JSON datasets and OpenTUI at the
CLI entry point. On Bun 1.3.14 on macOS arm64, `quran --help` takes about 230 ms,
peaks at 142.8 MB RSS, and produces a 65.11 MB JavaScript bundle. Those numbers
are the problem this architecture must reverse.

Effect 3.22 provides useful scoped resource and concurrency primitives, but an
Effect import is not free. A cold `bun -e 'void 0'` probe peaked at 22.5 MB RSS
and completed in 70 ms; `bun -e 'await import("effect")'` peaked at 100.5 MB RSS
and completed in 150 ms on the same machine. These are coarse subprocess
measurements rather than library-only allocation figures, but the difference is
large enough to reject Effect on the default command graph.

Effect's `Effect.suspend` and `Layer.suspend` defer construction of an Effect;
they do not defer JavaScript module evaluation. Only `import()` creates that
module-loading seam. `@effect/platform` and `@effect/platform-bun` are pre-1.0
and their documentation classifies Platform as unstable, so they cannot be the
public interface for quran.sh features.

## Options considered

### Plain TypeScript everywhere

Use dynamic imports, `AbortController`, explicit state transitions, and
`try/finally` for every feature. This has the smallest runtime cost, but every
worker, downloader, player, and native session would have to reproduce scoped
cleanup, interruption, and typed failure composition.

### One application-wide Effect runtime

Create a `ManagedRuntime` and Layer graph before the CLI/TUI starts. This gives
uniform composition, but it makes Effect part of the smallest command and
pushes Effect types into React and general Quran-reading code. The measured
cold-import cost conflicts directly with the epic's primary memory invariant.

### A small TypeScript runtime with incremental Effect modules

Keep lifecycle state and real `import()` calls in a dependency-free deep module.
Heavy feature implementations may import Effect after explicit activation and
use `Effect.acquireRelease`, scopes, streams, queues, schemas, or retries where
those primitives replace meaningful local complexity. They return one plain
`FeatureResource<T>` to the runtime. React sees only serializable state and
commands.

## Decision

Use the third option.

`src/features/runtime.ts` is the external seam. Its interface is deliberately
small: activate, disable, inspect state, subscribe, and shut down. It owns
single-flight initialization, cancellation, retryable state, exact-once
disposal, and application shutdown. A feature definition owns its dynamic
import and returns a value plus one finalizer.

Effect is permitted only behind a dynamically imported feature implementation.
No React module, `src/index.ts`, or base Quran data module may import Effect.
Feature implementations must convert Effect/platform/library failures into
quran.sh-owned errors and plain view state before crossing the seam.

Use Bun-native filesystem, SQLite, fetch, worker, and process APIs by default.
An Effect Platform adapter is justified only when a second adapter or a
substantial resource-safety/testability gain makes that seam real. All Platform
usage remains replaceable.

## Lifecycle contract

1. A feature starts in `idle` and performs no work.
2. Explicit user intent calls `activate`; the definition performs its dynamic
   import and acquisition exactly once for concurrent callers.
3. Cancellation, disable, failure, and renderer shutdown converge on one scoped
   finalizer.
4. A failed or disabled feature may be retried unless the application runtime
   has shut down.
5. React receives snapshots and stable commands. It never owns workers, media,
   database handles, Effect scopes, or GPU objects.
6. Every heavy feature must add load, steady-state, repeated-cycle, and
   post-disable measurements before it can ship.

## Consequences

The default path gets genuine module laziness and avoids paying Effect's cold
cost. Heavy modules can still use Effect where resource graphs or streaming
concurrency justify it. The tradeoff is a small plain-TypeScript lifecycle
implementation that must remain well tested, plus an explicit conversion seam
between Effect failures and application state.

This decision should be reconsidered if Effect 4 materially reduces cold RSS,
if most quran.sh features independently reproduce Effect semantics, or if the
application needs one cross-feature transaction that cannot be expressed cleanly
through the current runtime interface.

## Verification

- `bun test test/features/runtime.test.ts`
- `bun run typecheck`
- `bun run perf:baseline` once the benchmark harness from issue #19 lands
