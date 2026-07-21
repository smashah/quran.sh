import { RootRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { formatTranscriptEntry, type TranscriptEntry } from "./coordinator.ts";

export interface ScrollbackTranscriptWriter {
  append(entry: TranscriptEntry): void;
}

export function createOpenTuiScrollbackWriter(renderer: CliRenderer): ScrollbackTranscriptWriter {
  return {
    append(entry) {
      renderer.writeToScrollback(({ renderContext, width }) => {
        const content = formatTranscriptEntry(entry);
        const root = new RootRenderable(renderContext);
        const text = new TextRenderable(renderContext, {
          id: `transcript-${Date.now()}`,
          content,
          width,
          wrapMode: "word",
        });
        root.add(text);
        root.resize(width, Math.max(1, content.split("\n").length));
        root.calculateLayout();
        return { root, width, height: Math.max(1, content.split("\n").length), trailingNewline: true };
      });
    },
  };
}
