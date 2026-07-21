export const READING_MODES = ["focus", "learn", "recite", "memorise"] as const;
export type ReadingExperienceMode = (typeof READING_MODES)[number];

export interface CapabilityState {
  readonly text: true;
  readonly study: boolean;
  readonly images: boolean;
  readonly playback: boolean;
  readonly timings: boolean;
  readonly recognition: boolean;
  readonly microphone: boolean;
  readonly spatial: boolean;
  readonly reducedMotion: boolean;
  readonly safeMode: boolean;
}

export interface ModePresentation {
  readonly showArabic: true;
  readonly showTranslation: boolean;
  readonly showStudy: boolean;
  readonly showPlayback: boolean;
  readonly showFollowing: boolean;
  readonly hideNextVerse: boolean;
  readonly allowSpatial: boolean;
}

export function presentationFor(mode: ReadingExperienceMode, capability: CapabilityState): ModePresentation {
  if (capability.safeMode) return {
    showArabic: true, showTranslation: true, showStudy: false, showPlayback: false,
    showFollowing: false, hideNextVerse: false, allowSpatial: false,
  };
  return {
    showArabic: true,
    showTranslation: mode === "learn" || mode === "focus",
    showStudy: mode === "learn" && capability.study,
    showPlayback: (mode === "recite" || mode === "memorise") && capability.playback,
    showFollowing: mode === "recite" && capability.recognition && capability.microphone,
    hideNextVerse: mode === "memorise",
    allowSpatial: capability.spatial && !capability.reducedMotion,
  };
}
