import { ConsolePosition, createCliRenderer } from "@opentui/core";
import { createElement } from "react";
import { createRoot } from "@opentui/react";
import { openDatabase } from "../data/db.ts";
import { createFeatureRuntime } from "../features/runtime.ts";
import { createFeatureCatalog } from "../features/catalog.ts";
import { FeatureRuntimeProvider } from "../features/react.tsx";
import type { AnyRuntime } from "../features/react.tsx";
import { APP_DATA_DIR } from "../data/db.ts";

export interface LaunchTuiOptions {
  readonly experience?: "reader" | "immersive" | "stream";
  readonly safeMode?: boolean;
}

export async function launchTui(options: LaunchTuiOptions = {}): Promise<void> {
  openDatabase();

  let shutdownFeatures: (() => Promise<void>) | undefined;
  const renderer = await createCliRenderer({
    screenMode: options.experience === "stream" ? "split-footer" : "alternate-screen",
    footerHeight: options.experience === "stream" ? 6 : undefined,
    onDestroy: () => {
      void shutdownFeatures?.();
    },
    consoleOptions: {
      position: ConsolePosition.BOTTOM,
      sizePercent: 30,
      colorInfo: "#00FFFF",
      colorWarn: "#FFFF00",
      colorError: "#FF0000",
      startInDebugMode: false,
    },
  });
  const features = createFeatureRuntime(options.safeMode ? {} : createFeatureCatalog(renderer, APP_DATA_DIR));
  shutdownFeatures = () => features.shutdown();
  const experience = options.experience ?? "reader";
  const App = experience === "immersive"
    ? (await import("./immersive-app.tsx")).default
    : experience === "stream"
      ? (await import("./stream-app.tsx")).default
      : (await import("./app.tsx")).default;
  createRoot(renderer).render(createElement(FeatureRuntimeProvider, { runtime: features as unknown as AnyRuntime }, createElement(App, { safeMode: options.safeMode })));
}
