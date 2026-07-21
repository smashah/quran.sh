import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeatureRuntime, FeatureState } from "./runtime.ts";

export type AnyRuntime = FeatureRuntime<Record<string, any>>;
const FeatureContext = createContext<AnyRuntime | null>(null);

export function FeatureRuntimeProvider({ runtime, children }: { runtime: AnyRuntime; children?: ReactNode }) {
  return <FeatureContext.Provider value={runtime}>{children}</FeatureContext.Provider>;
}

export function useFeatureRuntime(): AnyRuntime {
  const runtime = useContext(FeatureContext);
  if (!runtime) throw new Error("useFeatureRuntime must be used inside FeatureRuntimeProvider");
  return runtime;
}

export function useFeatureState(id: string, enabled = true): FeatureState {
  const runtime = useFeatureRuntime();
  const [state, setState] = useState<FeatureState>(() => enabled ? runtime.getState(id) : { status: "disabled" });
  useEffect(() => {
    if (!enabled) { setState({ status: "disabled" }); return; }
    setState(runtime.getState(id));
    return runtime.subscribe((changed, next) => { if (changed === id) setState(next); });
  }, [enabled, id, runtime]);
  return state;
}

export function useFeatureCommand<T>(id: string): { activate(): Promise<T>; disable(): Promise<void> } {
  const runtime = useFeatureRuntime();
  return useMemo(() => ({ activate: () => runtime.activate(id) as Promise<T>, disable: () => runtime.disable(id) }), [id, runtime]);
}
