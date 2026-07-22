import type { ResourceRow } from "../resources/repository.ts";

export interface StudySnapshot {
  readonly verseKey: string;
  readonly translation: readonly ResourceRow[];
  readonly tafsir: readonly ResourceRow[];
  readonly words: readonly ResourceRow[];
  readonly topics: readonly ResourceRow[];
  readonly crossReferences: readonly ResourceRow[];
  readonly mushaf: readonly ResourceRow[];
  readonly recitation: readonly ResourceRow[];
}

export interface StudyService {
  inspect(verseKey: string, wordKey?: string): Promise<StudySnapshot>;
  recitation(verseKey: string): Promise<readonly ResourceRow[]>;
  script?(verseKey: string): Promise<readonly ResourceRow[]>;
  scriptPage?(page: number): Promise<readonly ResourceRow[]>;
  mushafPage?(page: number): Promise<readonly ResourceRow[]>;
  hadith?(verseKey: string): Promise<readonly ResourceRow[]>;
  search(query: string, limit?: number): Promise<readonly ResourceRow[]>;
  licenses(): readonly { id: string; attribution: string; license: string }[];
  dispose(): void;
}
