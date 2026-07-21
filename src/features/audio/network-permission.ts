import type { ResourceRow } from "../resources/repository.ts";

export interface NetworkPlaybackIdentity {
  readonly origin: string;
  readonly hostname: string;
  readonly provider: string;
  readonly preferenceKey: string;
}

export function networkPlaybackIdentity(url: string, row?: ResourceRow): NetworkPlaybackIdentity {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch (cause) { throw new Error("Blocked invalid audio URL; recitation streams must use HTTPS", { cause }); }
  if (parsed.protocol !== "https:") {
    throw new Error("Blocked insecure audio URL; recitation streams must use HTTPS");
  }
  const origin = parsed.origin.toLocaleLowerCase();
  const provider = row?.provenance?.provider.trim()
    || row?.provenance?.attribution.trim()
    || row?.provenance?.packId.trim()
    || "Unknown recitation provider";
  const scope = new Bun.CryptoHasher("sha256").update(`${provider.toLocaleLowerCase()}\n${origin}`).digest("hex");
  return {
    origin,
    hostname: parsed.hostname.toLocaleLowerCase(),
    provider,
    preferenceKey: `playbackNetworkAccepted:${scope}`,
  };
}
