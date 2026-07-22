# QUL integration research

Checked 2026-07-21 against the Quranic Universal Library (QUL) resource catalogue, its first-party integration guides, and the `TarteelAI/quranic-universal-library` source.

## Verdict

QUL is a strong upstream source for quran.sh's offline content, especially word-aligned recitation, script, translation, tafsir, morphology, topics, and Mushaf data. It is a download-and-package platform rather than a public API, so quran.sh should ingest reviewed snapshots into versioned local resource packs instead of making runtime requests to QUL. QUL explicitly recommends JSON for quick integration and SQLite for larger query-heavy datasets, while warning that resource schemas are related but not identical. [Resources catalogue](https://qul.tarteel.ai/resources), [getting-started guide](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/getting-started.md), [FAQ](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/faq.md)

## Resource priorities

1. **Recitation segments plus word-by-word Quran script:** QUL publishes ayah-by-ayah and surah-by-surah audio metadata, with some resources carrying segment arrays suitable for synchronized word highlighting. Its documented shapes include `audio_url`, ayah windows, and `[segment_index, start_ms, end_ms]` entries. Joined to script words, this can drive OpenTUI playback highlighting, repeat-one-word/ayah, memorization loops, and visible buffering state. [Recitation catalogue](https://qul.tarteel.ai/resources/recitation), [recitation example and schema](https://qul.tarteel.ai/resources/recitation/414), [recitation tutorial](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/tutorial-recitation-end-to-end.md)
2. **Translations, tafsir, metadata, and surah information:** These provide the clearest reader improvements: selectable offline translations, a study pane, juz/hizb/rub/manzil navigation, and chapter introductions. Keep each translation or tafsir optional so the default install remains small. [Dataset guide](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/datasets.md)
3. **Word script plus morphology:** QUL script rows expose canonical `verse_key` values and word `location` keys; morphology adds root, lemma, stem, POS, and grammar information at that word identity. This enables a focused word inspector and root/lemma search without putting linguistic data in the main verse table. [Script tutorial](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/tutorial-quran-script-end-to-end.md), [morphology tutorial](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/tutorial-morphology-end-to-end.md)
4. **Topics, themes, similar ayahs, and mutashabihat:** These can power thematic discovery and cross-references after the basic study model is stable. QUL lists 2,512 topics and separate theme, similarity, and mutashabihat collections, but their scholarly provenance and relationships need review before presentation as authoritative. [Resources catalogue](https://qul.tarteel.ai/resources)
5. **Mushaf layouts, scripts, fonts, and images:** Layout data can support an optional page-oriented Mushaf mode, while script images may improve the existing Braille image reader. Terminal text should remain the accessible default because exact font rendering cannot be assumed across terminals. [Mushaf catalogue](https://qul.tarteel.ai/resources/mushaf-layout), [Quran script catalogue](https://qul.tarteel.ai/resources/quran-script)

## Stable identity and Tilawa alignment

Normalize every import to integers and canonical strings:

- Ayah key: `surah:ayah`, backed by `surah_id + ayah_number`.
- Word key: `surah:ayah:word`, backed by `surah_id + ayah_number + word_position`.
- Never join by row order; QUL documents mixed source field names and recommends explicit normalization. [Data model](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/data-model.md), [download guide](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/docs/markdown/downloading-data.md)

Tilawa's `verse_match` maps directly to the ayah key, while `word_progress` should resolve through a per-ayah alignment table to QUL word keys. Do not assume Tilawa token indices and a selected QUL script have identical tokenization: validate word counts and normalized Arabic text, record exceptions, and disable word highlighting for an ayah when the alignment is ambiguous. QUL recitation timing then supplies exact playback windows; Tilawa remains the live-recitation recognizer rather than the playback clock.

## Offline resource-pack design

Use an application-owned pack manifest containing `id`, `version`, QUL resource/detail URL, retrieval date, format, schema version, SHA-256, byte size, language/script/reciter metadata, canonical key coverage, provenance, copyright notice, and redistribution terms. Import JSON initially for schema discovery; promote large or searchable content to indexed SQLite, which Bun can query locally. Keep raw downloads outside release artifacts, validate them into atomic version directories, and allow listing, updating, verifying, and removing packs without affecting bookmarks or reading history.

There is no supported QUL API. Current download controls require a signed-in QUL user: the Rails controller authenticates downloads, and unsigned users are sent to the sign-in modal. quran.sh should therefore accept a file the user downloaded, not automate login or scrape private download URLs. [Download controller](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/controllers/resources_controller.rb), [resource detail view](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/resources/detail.html.erb)

The repository's MIT license covers the QUL CMS software; it does not grant blanket rights to every hosted dataset. QUL's FAQ says to check dataset-specific terms, and its data model tracks source, copyright notice, and separate permissions to host and share. Do not bundle or redistribute a pack until those fields and the original source permit it; otherwise support local user import only and show attribution in `quran resources info`. [Repository license](https://github.com/TarteelAI/quranic-universal-library/blob/main/LICENSE), [resource permission model](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/models/resource_permission.rb), [copyright view](https://github.com/TarteelAI/quranic-universal-library/blob/main/app/views/resources/copyright.html.erb)

## Phased acceptance criteria

1. **Importer foundation:** One manually downloaded JSON and one SQLite resource import successfully; duplicate/malformed keys, UTF-8 failures, checksum changes, missing attribution, and unsupported schemas fail without replacing the active pack.
2. **Playback pilot:** One reviewed reciter works for a complete surah with OpenTUI playback, ayah/word highlighting, stop/repeat, offline metadata, and graceful fallback when segments or audio are unavailable.
3. **Study pilot:** One translation, tafsir, and word-script/morphology set join through canonical keys; random-ayah and full-surah tests prove coverage, and ambiguous Tilawa word alignments visibly fall back to ayah-only progress.
4. **Expansion:** Add pack discovery for metadata, topics, and Mushaf/image assets only after every candidate has provenance, rights, size, performance, RTL, and terminal-fallback checks.

QUL should be treated as quran.sh's curated content supply chain, with explicit imports and licensing review, rather than as a live dependency.
