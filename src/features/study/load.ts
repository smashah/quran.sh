import { join } from "node:path";
import { areResourcePacksCompatible, createResourcePackManager } from "../resources/manager.ts";
import type { InstalledResourcePack } from "../resources/manager.ts";
import { openResourceRepository, type ResourceRepository } from "../resources/repository.ts";
import type { StudyService, StudySnapshot } from "./service.ts";

export async function loadStudyService(dataDirectory: string, signal?: AbortSignal): Promise<StudyService> {
  const manager = createResourcePackManager(join(dataDirectory, "resources"));
  const packs = await manager.list();
  const latestPacks = [...new Map(packs.map((pack) => [pack.manifest.id, pack])).values()];
  const repositories = new Map<string, { pack: InstalledResourcePack; repository: ResourceRepository }>();
  let compatibilityAnchor: InstalledResourcePack | null = null;
  const openKind = async (kind: string) => {
    const entries: { pack: InstalledResourcePack; repository: ResourceRepository }[] = [];
    try {
      for (const pack of latestPacks.filter((candidate) => candidate.manifest.kind === kind)) {
        signal?.throwIfAborted();
        if (compatibilityAnchor && !areResourcePacksCompatible(compatibilityAnchor.manifest, pack.manifest)) continue;
        compatibilityAnchor ??= pack;
        let entry = repositories.get(pack.directory);
        if (!entry) {
          entry = { pack, repository: await openResourceRepository(pack) };
          repositories.set(pack.directory, entry);
        }
        entries.push(entry);
      }
      return entries;
    } catch (cause) {
      for (const entry of repositories.values()) entry.repository.close();
      repositories.clear();
      throw cause;
    }
  };
  const rowsFor = async (kind: string, verseKey: string, wordKey?: string) => (await openKind(kind))
    .flatMap((entry) => wordKey ? entry.repository.word(wordKey) : entry.repository.verse(verseKey));
  return {
    async inspect(verseKey, wordKey): Promise<StudySnapshot> {
      const translation = await rowsFor("translation", verseKey);
      const tafsir = await rowsFor("tafsir", verseKey);
      const words = await rowsFor("morphology", verseKey, wordKey);
      const topics = await rowsFor("topics", verseKey);
      const similar = await rowsFor("similar-ayahs", verseKey);
      const mutashabihat = await rowsFor("mutashabihat", verseKey);
      const mushaf = await rowsFor("mushaf-layout", verseKey, wordKey);
      return {
        verseKey,
        translation, tafsir, words, topics, crossReferences: [...similar, ...mutashabihat], mushaf, recitation: [],
      };
    },
    recitation: (verseKey) => rowsFor("recitation", verseKey),
    hadith: (verseKey) => rowsFor("hadith", verseKey),
    async search(query, limit = 50) {
      const kinds = ["translation", "tafsir", "morphology", "topics", "similar-ayahs", "mutashabihat", "hadith"];
      const active: { pack: InstalledResourcePack; repository: ResourceRepository }[] = [];
      for (const kind of kinds) active.push(...await openKind(kind));
      return active.flatMap((entry) => entry.repository.search(query, limit)).slice(0, limit);
    },
    licenses: () => latestPacks.map((pack) => ({
      id: pack.manifest.id,
      attribution: pack.manifest.license.attribution,
      license: pack.manifest.license.name,
    })),
    dispose() { for (const entry of repositories.values()) entry.repository.close(); repositories.clear(); },
  };
}
