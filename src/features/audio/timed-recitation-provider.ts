import type { ResourceRow } from "../resources/repository.ts";
import { clearQuranFoundationClient, hasQuranFoundationCredentials } from "../quran-foundation/client.ts";
import { clearQuranComTimedRecitationCache, fetchQuranComTimedRecitation } from "./quran-com-recitation.ts";
import { clearQuranFoundationTimedRecitationCache, fetchQuranFoundationTimedRecitation } from "./quran-foundation-recitation.ts";

export async function fetchTimedRecitation(
  verseKey: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ResourceRow> {
  try {
    return await fetchQuranComTimedRecitation(verseKey, options);
  } catch (publicCause) {
    if (!hasQuranFoundationCredentials()) throw publicCause;
    try { return await fetchQuranFoundationTimedRecitation(verseKey, options); }
    catch (credentialedCause) {
      throw new Error("Quran.com public timing and the credentialed Quran Foundation fallback are unavailable", {
        cause: credentialedCause instanceof Error ? credentialedCause : publicCause,
      });
    }
  }
}

export function clearTimedRecitationCache(): void {
  clearQuranComTimedRecitationCache();
  clearQuranFoundationTimedRecitationCache();
  clearQuranFoundationClient();
}
