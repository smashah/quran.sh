export type FeatureRuntimeErrorCode =
  | "load_failed"
  | "dispose_failed"
  | "runtime_closed";

export class FeatureRuntimeError extends Error {
  override readonly name = "FeatureRuntimeError";

  constructor(
    readonly featureId: string,
    readonly code: FeatureRuntimeErrorCode,
    message: string,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

export type FeatureState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly startedAt: number }
  | { readonly status: "ready"; readonly loadedAt: number }
  | { readonly status: "failed"; readonly error: FeatureRuntimeError }
  | { readonly status: "stopping" }
  | { readonly status: "disabled" };

export interface FeatureResource<T> {
  readonly value: T;
  dispose(): void | Promise<void>;
}

export interface FeatureDefinition<T> {
  /**
   * Load the implementation and acquire its long-lived resources.
   *
   * Heavy definitions must put dynamic import() inside this function. The
   * runtime deliberately knows nothing about Effect, workers, media, or GPU
   * APIs so the default startup graph stays small.
   */
  load(signal: AbortSignal): Promise<FeatureResource<T>>;
}

type AnyDefinition = FeatureDefinition<any>;
type Definitions = Readonly<Record<string, AnyDefinition>>;
type FeatureId<D extends Definitions> = Extract<keyof D, string>;
type FeatureValue<D extends Definitions, K extends FeatureId<D>> =
  D[K] extends FeatureDefinition<infer T> ? T : never;

export type FeatureStateListener<D extends Definitions> = (
  id: FeatureId<D>,
  state: FeatureState,
) => void;

export interface FeatureRuntime<D extends Definitions> {
  activate<K extends FeatureId<D>>(id: K): Promise<FeatureValue<D, K>>;
  disable(id: FeatureId<D>): Promise<void>;
  getState(id: FeatureId<D>): FeatureState;
  subscribe(listener: FeatureStateListener<D>): () => void;
  shutdown(): Promise<void>;
}

interface RuntimeEntry {
  state: FeatureState;
  generation: number;
  controller: AbortController | null;
  loading: Promise<unknown> | null;
  resource: FeatureResource<unknown> | null;
  stopping: Promise<void> | null;
}

const idleState = (): FeatureState => ({ status: "idle" });
const disabledState = (): FeatureState => ({ status: "disabled" });

export function createFeatureRuntime<const D extends Definitions>(
  definitions: D,
): FeatureRuntime<D> {
  type Id = FeatureId<D>;

  const entries = new Map<Id, RuntimeEntry>();
  const listeners = new Set<FeatureStateListener<D>>();
  let closed = false;
  let shutdownPromise: Promise<void> | null = null;

  for (const id of Object.keys(definitions) as Id[]) {
    entries.set(id, {
      state: idleState(),
      generation: 0,
      controller: null,
      loading: null,
      resource: null,
      stopping: null,
    });
  }

  const entryFor = (id: Id): RuntimeEntry => {
    const entry = entries.get(id);
    if (!entry) {
      throw new FeatureRuntimeError(
        id,
        "load_failed",
        `Unknown feature: ${id}`,
        false,
      );
    }
    return entry;
  };

  const publish = (id: Id, entry: RuntimeEntry, state: FeatureState): void => {
    entry.state = state;
    for (const listener of listeners) {
      try {
        listener(id, state);
      } catch {
        // Observers cannot break lifecycle cleanup.
      }
    }
  };

  const runtime: FeatureRuntime<D> = {
    async activate<K extends Id>(id: K): Promise<FeatureValue<D, K>> {
      if (closed) {
        throw new FeatureRuntimeError(
          id,
          "runtime_closed",
          `Cannot activate ${id}: feature runtime is closed`,
          false,
        );
      }

      const entry = entryFor(id);
      if (entry.resource && entry.state.status === "ready") {
        return entry.resource.value as FeatureValue<D, K>;
      }
      if (entry.loading) {
        return entry.loading as Promise<FeatureValue<D, K>>;
      }
      if (entry.stopping) {
        await entry.stopping;
        if (closed) {
          throw new FeatureRuntimeError(
            id,
            "runtime_closed",
            `Cannot activate ${id}: feature runtime is closed`,
            false,
          );
        }
      }

      const definition = definitions[id];
      if (!definition) {
        throw new FeatureRuntimeError(
          id,
          "load_failed",
          `Unknown feature: ${id}`,
          false,
        );
      }

      const controller = new AbortController();
      const generation = entry.generation + 1;
      entry.generation = generation;
      entry.controller = controller;
      publish(id, entry, { status: "loading", startedAt: Date.now() });

      const loading = (async (): Promise<FeatureValue<D, K>> => {
        try {
          const resource = await definition.load(controller.signal);

          if (entry.generation !== generation || controller.signal.aborted || closed) {
            await resource.dispose();
            throw controller.signal.reason ?? new FeatureRuntimeError(
              id,
              "runtime_closed",
              `Activation of ${id} was cancelled`,
              true,
            );
          }

          entry.resource = resource;
          publish(id, entry, { status: "ready", loadedAt: Date.now() });
          return resource.value as FeatureValue<D, K>;
        } catch (cause) {
          if (entry.generation !== generation || controller.signal.aborted || closed) {
            throw cause;
          }

          const error = cause instanceof FeatureRuntimeError
            ? cause
            : new FeatureRuntimeError(
                id,
                "load_failed",
                `Failed to load ${id}`,
                true,
                cause,
              );
          publish(id, entry, { status: "failed", error });
          throw error;
        } finally {
          if (entry.generation === generation) {
            entry.controller = null;
            entry.loading = null;
          }
        }
      })();

      entry.loading = loading;
      return loading;
    },

    async disable(id: Id): Promise<void> {
      const entry = entryFor(id);
      if (entry.stopping) return entry.stopping;
      if (entry.state.status === "disabled" && !entry.loading && !entry.resource) return;

      const stopping = (async () => {
        entry.generation += 1;
        publish(id, entry, { status: "stopping" });
        entry.controller?.abort(new FeatureRuntimeError(
          id,
          "load_failed",
          `Activation of ${id} was cancelled`,
          true,
        ));

        if (entry.loading) {
          try {
            await entry.loading;
          } catch {
            // Cancellation/failure is represented by the final disabled state.
          }
        }

        const resource = entry.resource;
        entry.resource = null;
        entry.controller = null;
        entry.loading = null;

        if (resource) {
          try {
            await resource.dispose();
          } catch (cause) {
            const error = new FeatureRuntimeError(
              id,
              "dispose_failed",
              `Failed to dispose ${id}`,
              false,
              cause,
            );
            publish(id, entry, { status: "failed", error });
            throw error;
          }
        }

        publish(id, entry, disabledState());
      })();

      entry.stopping = stopping.finally(() => {
        entry.stopping = null;
      });
      return entry.stopping;
    },

    getState(id: Id): FeatureState {
      return entryFor(id).state;
    },

    subscribe(listener: FeatureStateListener<D>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    shutdown(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      closed = true;
      shutdownPromise = Promise.all(
        (Object.keys(definitions) as Id[]).map((id) => runtime.disable(id)),
      ).then(() => undefined);
      return shutdownPromise;
    },
  };

  return runtime;
}
