import { describe, expect, test } from "bun:test";
import { presentationFor, type CapabilityState } from "../../src/features/experience/mode.ts";
import { READING_MODES } from "../../src/features/experience/mode.ts";

const all: CapabilityState = {
  text: true, study: true, images: true, playback: true, timings: true,
  recognition: true, microphone: true, spatial: true, reducedMotion: false, safeMode: false,
};

describe("immersive capability composition", () => {
  test("centres learning on tafsir and word data", () => {
    expect(presentationFor("learn", all)).toMatchObject({ showTranslation: true, showStudy: true, showPlayback: false });
  });

  test("keeps memorisation calm and hides the upcoming verse", () => {
    expect(presentationFor("memorise", all)).toMatchObject({ hideNextVerse: true, showFollowing: false, showPlayback: true });
  });

  test("safe mode is a complete text-only fallback", () => {
    expect(presentationFor("recite", { ...all, safeMode: true })).toEqual({
      showArabic: true, showTranslation: true, showStudy: false, showPlayback: false,
      showFollowing: false, hideNextVerse: false, allowSpatial: false,
    });
  });

  test("keeps Arabic available through the complete optional-capability matrix", () => {
    const optional = ["study", "images", "playback", "timings", "recognition", "microphone", "spatial"] as const;
    for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
      const capability = { ...all };
      optional.forEach((key, index) => { capability[key] = Boolean(mask & (1 << index)); });
      for (const mode of READING_MODES) {
        const presentation = presentationFor(mode, capability);
        expect(presentation.showArabic, `${mode} mask ${mask}`).toBe(true);
        if (!capability.playback) expect(presentation.showPlayback).toBe(false);
        if (!capability.recognition || !capability.microphone) expect(presentation.showFollowing).toBe(false);
      }
    }
  });
});
