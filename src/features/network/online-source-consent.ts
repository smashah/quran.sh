import { getPreference, setPreference } from "../../data/preferences.ts";

export const ONLINE_SOURCE_DISCLOSURE_KEY = "onlineQuranSourcesAccepted.v1";
const LEGACY_IMMERSIVE_SOURCE_DISCLOSURE_KEY = "immersiveOnlineSourcesAccepted.v1";

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
