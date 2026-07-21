import { describe, expect, test } from "bun:test";
import {
  createFeatureRuntime,
  type FeatureDefinition,
} from "../../src/features/runtime.ts";

type TestFeature = {
  readonly id: number;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("feature runtime", () => {
  test("does not load a feature before explicit activation", () => {
    let loads = 0;
    const runtime = createFeatureRuntime({
      study: {
        load: async () => {
          loads += 1;
          return { value: { id: 1 }, dispose() {} };
        },
      },
    });

    expect(loads).toBe(0);
    expect(runtime.getState("study")).toEqual({ status: "idle" });
  });

  test("deduplicates concurrent activation and disposes exactly once", async () => {
    let loads = 0;
    let disposals = 0;
    const loading = deferred<TestFeature>();

    const definition: FeatureDefinition<TestFeature> = {
      load: async () => {
        loads += 1;
        const value = await loading.promise;
        return {
          value,
          dispose: () => {
            disposals += 1;
          },
        };
      },
    };
    const runtime = createFeatureRuntime({ study: definition });

    const first = runtime.activate("study");
    const second = runtime.activate("study");
    expect(runtime.getState("study").status).toBe("loading");
    expect(loads).toBe(1);

    loading.resolve({ id: 7 });
    expect(await first).toEqual({ id: 7 });
    expect(await second).toEqual({ id: 7 });
    expect(runtime.getState("study").status).toBe("ready");

    await Promise.all([runtime.disable("study"), runtime.disable("study")]);
    expect(disposals).toBe(1);
    expect(runtime.getState("study")).toEqual({ status: "disabled" });
  });

  test("cancels an in-flight activation and can retry", async () => {
    let attempt = 0;
    let aborted = false;
    const runtime = createFeatureRuntime({
      recognition: {
        load: async (signal) => {
          attempt += 1;
          if (attempt === 1) {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                reject(signal.reason);
              }, { once: true });
            });
          }
          return { value: { id: attempt }, dispose() {} };
        },
      },
    });

    const first = runtime.activate("recognition");
    await runtime.disable("recognition");
    await expect(first).rejects.toBeDefined();
    expect(aborted).toBe(true);
    expect(runtime.getState("recognition")).toEqual({ status: "disabled" });

    expect(await runtime.activate("recognition")).toEqual({ id: 2 });
    expect(runtime.getState("recognition").status).toBe("ready");
  });

  test("reports typed failures and notifies subscribers", async () => {
    const states: string[] = [];
    const runtime = createFeatureRuntime({
      audio: {
        load: async () => {
          throw new Error("no output device");
        },
      },
    });
    const unsubscribe = runtime.subscribe((id, state) => {
      states.push(`${id}:${state.status}`);
    });

    await expect(runtime.activate("audio")).rejects.toMatchObject({
      name: "FeatureRuntimeError",
      code: "load_failed",
      featureId: "audio",
      retryable: true,
    });
    expect(runtime.getState("audio")).toMatchObject({
      status: "failed",
      error: { code: "load_failed", featureId: "audio" },
    });
    expect(states).toEqual(["audio:loading", "audio:failed"]);
    unsubscribe();
  });

  test("shutdown cancels and disposes every feature", async () => {
    const disposed: string[] = [];
    const definitions = Object.fromEntries(
      ["audio", "study", "visual"].map((id) => [
        id,
        {
          load: async () => ({
            value: { id },
            dispose: () => {
              disposed.push(id);
            },
          }),
        },
      ]),
    );
    const runtime = createFeatureRuntime(definitions);

    await Promise.all([
      runtime.activate("audio"),
      runtime.activate("study"),
      runtime.activate("visual"),
    ]);
    await Promise.all([runtime.shutdown(), runtime.shutdown()]);

    expect(disposed.sort()).toEqual(["audio", "study", "visual"]);
    expect(runtime.getState("audio")).toEqual({ status: "disabled" });
    await expect(runtime.activate("audio")).rejects.toMatchObject({
      code: "runtime_closed",
      retryable: false,
    });
  });

  test("stays single-flight under 100 concurrent acquisitions", async () => {
    let loads = 0;
    let disposals = 0;
    const runtime = createFeatureRuntime({
      heavy: { async load() { loads++; await Bun.sleep(1); return { value: { ready: true }, dispose: () => { disposals++; } }; } },
    });
    const values = await Promise.all(Array.from({ length: 100 }, () => runtime.activate("heavy")));
    expect(loads).toBe(1);
    expect(values.every((value) => value === values[0])).toBe(true);
    await Promise.all(Array.from({ length: 100 }, () => runtime.disable("heavy")));
    expect(disposals).toBe(1);
  });

  test("does not retain resources across 20 load/unload cycles", async () => {
    let live = 0;
    const runtime = createFeatureRuntime({ cycle: { async load() { live++; return { value: true, dispose: () => { live--; } }; } } });
    for (let index = 0; index < 20; index++) {
      await runtime.activate("cycle");
      expect(live).toBe(1);
      await runtime.disable("cycle");
      expect(live).toBe(0);
    }
  });
});
