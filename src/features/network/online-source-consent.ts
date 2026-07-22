import { getPreference, setPreference } from "../../data/preferences.ts";

export const ONLINE_SOURCE_DISCLOSURE_KEY = "onlineQuranSourcesAccepted.v1";
const LEGACY_IMMERSIVE_SOURCE_DISCLOSURE_KEY = "immersiveOnlineSourcesAccepted.v1";

export const ONLINE_QURAN_SOURCE_DISCLOSURE = [
  "Online features use approved Quran sources instead of probing QUL.",
  "Quran.com supplies Quran fonts, public recitation timing, and canonical related-hadith pages. Quran Foundation supplies optional credentialed tafsir, hadith, and timing fallback.",
  "Al Quran Cloud / Islamic Network supplies keyless Tafsir al-Muyassar, page, image, and audio fallbacks.",
  "Providers receive your IP and the requested ayah, page, font, or media. quran.sh sends no notes, bookmarks, history, account data, or telemetry.",
  "Heavy features remain lazy and memory-bounded until you open them.",
] as const;

let acceptedForSession = false;

export function onlineSourcesAccepted(): boolean {
  if (acceptedForSession) return true;
  return getPreference(ONLINE_SOURCE_DISCLOSURE_KEY) === "true"
    || getPreference(LEGACY_IMMERSIVE_SOURCE_DISCLOSURE_KEY) === "true";
}

export function acceptOnlineSources(persist: boolean): void {
  acceptedForSession = true;
  if (persist) setPreference(ONLINE_SOURCE_DISCLOSURE_KEY, "true");
}
