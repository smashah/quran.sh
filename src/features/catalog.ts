import type { CliRenderer } from "@opentui/core";
import { join } from "node:path";
import type { FeatureDefinition } from "./runtime.ts";
import type { RecitationPlayer } from "./audio/player.ts";
import type { TilawaRecognizer } from "./recognition/types.ts";
import type { VisualBackdrop } from "./spatial/types.ts";
import type { StudyService } from "./study/service.ts";

export const FEATURE_IDS = ["study", "recitation", "recognition", "spatial-backdrop"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export function createFeatureCatalog(renderer: CliRenderer, dataDirectory: string): {
  readonly study: FeatureDefinition<StudyService>;
  readonly recitation: FeatureDefinition<RecitationPlayer>;
  readonly recognition: FeatureDefinition<TilawaRecognizer>;
  readonly "spatial-backdrop": FeatureDefinition<VisualBackdrop & { readonly renderable: import("@opentui/core").Renderable }>;
} {
  const ensureNotCancelled = async (signal: AbortSignal, dispose: () => void | Promise<void>) => {
    if (!signal.aborted) return;
    await dispose();
    signal.throwIfAborted();
  };
  return {
    study: {
      async load(signal) {
        signal.throwIfAborted();
        const { loadStudyService } = await import("./study/load.ts");
        const study = await loadStudyService(dataDirectory, signal);
        await ensureNotCancelled(signal, () => study.dispose());
        return { value: study, dispose: () => study.dispose() };
      },
    },
    recitation: {
      async load(signal) {
        signal.throwIfAborted();
        const [{ createRecitationPlayer }, { createOpenTuiPlaybackBackend }] = await Promise.all([
          import("./audio/player.ts"),
          import("./audio/opentui-backend.ts"),
        ]);
        signal.throwIfAborted();
        const player = createRecitationPlayer(createOpenTuiPlaybackBackend());
        await ensureNotCancelled(signal, () => player.dispose());
        return { value: player, dispose: () => player.dispose() };
      },
    },
    recognition: {
      async load(signal) {
        signal.throwIfAborted();
        const { createTilawaRecognizer } = await import("./recognition/tilawa-adapter.ts");
        const model = join(dataDirectory, "models", "tilawa", "v0.2.0");
        const recognizer = await createTilawaRecognizer({ directory: model, modelFile: "fastconformer_full_mixed.onnx" });
        await ensureNotCancelled(signal, () => recognizer.dispose());
        return { value: recognizer, dispose: () => recognizer.dispose() };
      },
    },
    "spatial-backdrop": {
      async load(signal) {
        signal.throwIfAborted();
        const { createThreeBackdrop } = await import("./spatial/three-backdrop.ts");
        const backdrop = await createThreeBackdrop(renderer);
        await ensureNotCancelled(signal, () => backdrop.dispose());
        return { value: backdrop, dispose: () => backdrop.dispose() };
      },
    },
  };
}
