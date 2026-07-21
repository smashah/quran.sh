/**
 * Fuzzy search layer for Quran verses.
 *
 * Indexes all 6,236 verses across translation, transliteration, and Arabic text
 * using @m31coding/fuzzy-search. Lazily initialised on first query.
 *
 * The index is built in-memory (~2 s on first search) and then reused for the
 * rest of the session.  Persistence was removed because the 33 MB JSON
 * round-trip through SQLite was actually *slower* than a fresh build.
 */
import { Config, SearcherFactory, Query } from "@m31coding/fuzzy-search";
import type { DynamicSearcher } from "@m31coding/fuzzy-search";
import { getAllVerseRefs, type VerseRef } from "./quran";

// ---------------------------------------------------------------------------
// Searcher singleton
// ---------------------------------------------------------------------------

const _searchers = new Map<string, DynamicSearcher<VerseRef, string>>();
const SEARCHER_CACHE_LIMIT = 2;

function rememberSearcher(language: string, searcher: DynamicSearcher<VerseRef, string>): void {
  _searchers.delete(language);
  _searchers.set(language, searcher);
  if (_searchers.size > SEARCHER_CACHE_LIMIT) {
    const oldest = _searchers.keys().next().value;
    if (oldest) _searchers.delete(oldest);
  }
}

/**
 * Whether the search index has been built and is ready for queries.
 */
export function isIndexReady(language: string = "en"): boolean {
  return _searchers.has(language);
}

/**
 * Create a fresh searcher instance with the standard config.
 */
function createSearcher(): DynamicSearcher<VerseRef, string> {
  const config = Config.createDefaultConfig();
  config.normalizerConfig.allowCharacter = (_c: string) => true;
  return SearcherFactory.createSearcher<VerseRef, string>(config);
}

/**
 * Load all verse entities from quran-json.
 */
function loadEntities(language: string): VerseRef[] {
  return getAllVerseRefs(language);
}

/**
 * The terms extractor used for indexing.
 */
function getTerms(e: VerseRef): string[] {
  const terms: string[] = [e.translation, e.text];
  if (e.transliteration) terms.push(e.transliteration);
  return terms;
}

// ---------------------------------------------------------------------------
// Core init
// ---------------------------------------------------------------------------

/**
 * Trigger index building asynchronously (defers to next tick so the UI
 * can render an "Indexing…" indicator before the synchronous work blocks).
 */
export function ensureSearcherAsync(language: string = "en"): Promise<void> {
  if (_searchers.has(language)) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(() => {
      ensureSearcher(language);
      resolve();
    }, 0);
  });
}

function ensureSearcher(language: string): DynamicSearcher<VerseRef, string> {
  const cached = _searchers.get(language);
  if (cached) {
    rememberSearcher(language, cached);
    return cached;
  }

  const searcher = createSearcher();
  const entities = loadEntities(language);
  searcher.indexEntities(entities, (e) => e.reference, getTerms);

  rememberSearcher(language, searcher);
  return searcher;
}

// ---------------------------------------------------------------------------
// Re-index (force rebuild)
// ---------------------------------------------------------------------------

/**
 * Force a full re-index, clearing any cached data.
 * Returns a promise so the UI can show feedback after completion.
 */
export function reindex(language: string = "en"): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      _searchers.delete(language);

      const searcher = createSearcher();
      const entities = loadEntities(language);
      searcher.indexEntities(entities, (e) => e.reference, getTerms);
      rememberSearcher(language, searcher);

      resolve();
    }, 0);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FuzzySearchResult {
  verse: VerseRef;
  quality: number;
  matchedString: string;
}

/**
 * Perform a fuzzy search across all Quran verses.
 *
 * Searches the selected translation language, Arabic text, and transliteration.
 * Results are ranked by match quality (highest first).
 *
 * @param query - The search string.
 * @param topN  - Maximum results to return (default 20).
 * @param language - Translation language to search (default: English).
 */
export function fuzzySearch(query: string, topN = 20, language: string = "en"): FuzzySearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const searcher = ensureSearcher(language);
  const result = searcher.getMatches(new Query(trimmed, topN));

  return result.matches.map((m) => ({
    verse: m.entity,
    quality: m.quality,
    matchedString: m.matchedString,
  }));
}
