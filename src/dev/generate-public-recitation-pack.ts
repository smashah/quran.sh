import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getSurah } from "../data/quran.ts";
import type { ResourcePackManifestInput } from "../features/resources/manager.ts";

const outputDirectory = join(import.meta.dir, "..", "..", "packs");
const baseName = "islamic-network-alafasy-128-v1";
const rows: { verse_key: string; audio_url: string }[] = [];
let globalAyah = 0;
for (let surahId = 1; surahId <= 114; surahId++) {
  const surah = getSurah(surahId);
  if (!surah) throw new Error(`Missing surah ${surahId}`);
  for (const verse of surah.verses) {
    globalAyah += 1;
    rows.push({
      verse_key: `${surahId}:${verse.id}`,
      audio_url: `https://cdn.islamic.network/quran/audio/128/ar.alafasy/${globalAyah}.mp3`,
    });
  }
}
if (globalAyah !== 6_236) throw new Error(`Expected 6236 ayat, generated ${globalAyah}`);
const content = JSON.stringify({ recitations: rows }) + "\n";
const manifest: ResourcePackManifestInput = {
  schemaVersion: 1,
  id: "islamic-network.alafasy-128",
  version: "v1",
  title: "Mishary Rashid Alafasy · 128 kbps streaming index",
  kind: "recitation",
  format: "json",
  source: {
    provider: "Al Quran Cloud / Islamic Network",
    resourceId: "ar.alafasy-128",
    url: "https://alquran.cloud/cdn",
    retrievedAt: "2026-07-21T00:00:00.000Z",
  },
  content: {
    bytes: Buffer.byteLength(content),
    sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
  },
  license: {
    name: "Al Quran Cloud Terms and Conditions",
    url: "https://alquran.cloud/terms-and-conditions",
    attribution: "Recitation by Mishary Rashid Alafasy, served by Al Quran Cloud / Islamic Network",
    redistribution: "unknown",
  },
  compatibility: { narration: "hafs", coordinateSchema: "verse-key-v1", timingSchema: "ayah-only" },
};
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  Bun.write(join(outputDirectory, `${baseName}.data.json`), content),
  Bun.write(join(outputDirectory, `${baseName}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`),
]);
console.log(`${rows.length} ayat · ${manifest.content.bytes} bytes · ${manifest.content.sha256}`);
