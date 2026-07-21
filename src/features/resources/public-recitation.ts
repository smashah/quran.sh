import { join } from "node:path";
import type { InstalledResourcePack } from "./manager.ts";

export const STARTER_RECITATION_PACK = {
  id: "islamic-network.alafasy-128",
  version: "v1",
  title: "Mishary Rashid Alafasy · 128 kbps streaming index",
  manifestUrl: "https://github.com/smashah/quran.sh/releases/download/resource-packs-v1/islamic-network-alafasy-128-v1.manifest.json",
  dataUrl: "https://github.com/smashah/quran.sh/releases/download/resource-packs-v1/islamic-network-alafasy-128-v1.data.json",
  provider: "Al Quran Cloud / Islamic Network",
  reciter: "Mishary Rashid Alafasy",
  downloadBytes: 621_236,
  manifestSha256: "31e570e3608e8c65fad66984853f29e0aeb258dbae6a2059fd13a2d96647b4f5",
  dataSha256: "44672fe6bbc94ef526beccf4ff605925ad56b0e243c609abbb221b4a39370f55",
  kind: "recitation",
  sourceUrl: "https://alquran.cloud/cdn",
} as const;

export async function installStarterRecitationPack(
  dataDirectory: string,
  options: { readonly signal?: AbortSignal; readonly onProgress?: (received: number, total?: number) => void } = {},
): Promise<InstalledResourcePack> {
  const { downloadAndInstallResourcePack } = await import("./download.ts");
  return downloadAndInstallResourcePack({
    rootDirectory: join(dataDirectory, "resources"),
    manifestUrl: STARTER_RECITATION_PACK.manifestUrl,
    dataUrl: STARTER_RECITATION_PACK.dataUrl,
    expectedId: STARTER_RECITATION_PACK.id,
    expectedVersion: STARTER_RECITATION_PACK.version,
    expectedManifestSha256: STARTER_RECITATION_PACK.manifestSha256,
    expectedDataSha256: STARTER_RECITATION_PACK.dataSha256,
    expectedDataBytes: STARTER_RECITATION_PACK.downloadBytes,
    expectedKind: STARTER_RECITATION_PACK.kind,
    expectedProvider: STARTER_RECITATION_PACK.provider,
    expectedSourceUrl: STARTER_RECITATION_PACK.sourceUrl,
    maxManifestBytes: 32 * 1024,
    maxDataBytes: 2 * 1024 * 1024,
    ...options,
  });
}
