# Quran.com verse-related hadith research

_Researched 2026-07-22 from Quran Foundation, Quran.com, QUL/Tarteel, and Sunnah.com primary sources._

## Verdict

`h` is a natural reader action, but Quran.com's related-hadith data is not an anonymous or QUL-hosted dataset. Quran Foundation owns the curated ayah-to-hadith links and exposes them through authenticated Content API v4 endpoints; the expanded narration text is backed by Sunnah.com. QUL explicitly says it does not currently offer hadith data, and Sunnah.com forbids scraping and mass reproduction. The production design should therefore obtain Quran Foundation approval and use its authenticated API through a credential-safe proxy, while keeping the feature lazy, consented, bounded, and fully attributed.

## What Quran.com shows

The live [Al-Fatihah 1:3 hadith page](https://quran.com/al-fatihah/3/hadith) currently shows Sahih Muslim 395a in English, offers a “Show Arabic” control, and links the citation to Sunnah.com. Its notice says the set contains only narrations that explicitly reference Quranic verses, is not exhaustive, and is curated from Sahih al-Bukhari and Sahih Muslim through Sunnah.com. The same wording and links are defined in Quran.com's [English locale](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/locales/en/quran-reader.json) and [Hadith list component](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/components/QuranReader/ReadingView/StudyModeModal/tabs/Hadith/HadithList/index.tsx#L54-L132).

This is not guaranteed for every ayah. Quran.com requests a count map, shows the Hadith action only when the current ayah's count is greater than zero, and only adds positive-count ayahs to its sitemap; see [BottomActions](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/components/QuranReader/TranslationView/BottomActions.tsx) and [the sitemap filter](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/next-sitemap.js#L101-L116). All seven Al-Fatihah ayahs currently happen to have at least one related narration, which likely creates the impression that the feature exists for every ayah.

Quran.com's reader fetches count data in chapter-local batches of 20 ayahs, then fetches the selected ayah's first four narrations only when the Hadith tab opens. Further pages are loaded through infinite scroll. The relevant implementation is in [useBatchedCountRangeHadiths](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/hooks/auth/useBatchedCountRangeHadiths.ts), [useHadithsPagination](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/hooks/useHadithsPagination.ts), and the [Hadith study tab](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/components/QuranReader/ReadingView/StudyModeModal/tabs/Hadith/index.tsx).

For non-Arabic site languages the card initially renders English and lets the reader reveal Arabic; for Arabic it renders Arabic RTL. The frontend treats Arabic and English entries as optional localized members, as shown by its [response transformation](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/utils/hadith.ts) and [content component](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/components/QuranReader/ReadingView/StudyModeModal/tabs/Hadith/HadithList/HadithContent.tsx). A live inspection of the server-rendered 1:3 payload contained both `en` and `ar` bodies and grades for Muslim 395a, although the public API contract only promises Arabic when `language=ar` and English for every non-`ar` value. A client must tolerate either localized entry being absent.

## Official endpoints and schemas

Production base URL: `https://apis.quran.foundation/content/api/v4` ([official OpenAPI source](https://github.com/quran/qf-api-docs/blob/da0e0ea0ed39c9d55af627780bb39d8af71087d2/openAPI/content/v4.json)).

### 1. Count references in a range

```http
GET /hadith_references/count_within_range
    ?from=1:1
    &to=1:7
    &language=en
```

The response is a language-independent `Record<verse_key, number>`, for example `{ "1:1": 1, "1:2": 4 }`. `from` and `to` use `chapter:verse` coordinates and the range is inclusive. This route is useful for badges or hiding an unavailable action, but `quran.sh` can avoid the extra request by fetching the selected ayah directly when the user presses `h`. See the [official range endpoint documentation](https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/hadith-count-within-range/).

### 2. Get the curated link records for one ayah

```http
GET /hadith_references/by_ayah/{ayah_key}?language=en
```

The response contains `verse_key`, `verse_number`, `chapter_number`, `language`, `direction`, and an ordered `hadith_references` array. Each reference has:

```ts
{
  id: number;
  collection: string;       // e.g. "bukhari" or "muslim"
  hadith_number: string;    // may include suffixes/spaces
  our_hadith_number: number;
  arabic_urn: number;
  english_urn: number;
  surah_number: number;
  ayah_start_number: number;
  ayah_end_number: number;
}
```

The start/end coordinates describe the ayah span explicitly referenced by the narration. Use these supplied coordinates and URNs as identity; do not infer relationships by searching narration prose. See the [official endpoint documentation](https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/hadith-references-by-ayah/) and the Quran Foundation SDK's [typed model](https://github.com/quran/api-js/blob/5082514dbfcf40af3268ba133f6d98979d559cfc/packages/api/src/types/api/HadithReference.ts#L3-L55).

### 3. Expand one ayah's references into narration text

```http
GET /hadith_references/by_ayah/{ayah_key}/hadiths
    ?language=en
    &page=1
    &limit=4
```

`page` starts at 1. `limit` defaults to 4 and is capped at 5. The response is:

```ts
{
  hadiths: Array<{
    urn: number;
    collection: string;
    bookNumber: string;
    chapterId: string;
    hadithNumber: string;
    name: string;
    hadith: Array<{
      lang: string;
      chapterNumber: string;
      chapterTitle: string;
      body: string;          // HTML, not trusted terminal text
      urn: number;
      grades: Array<{ graded_by: string; grade: string }>;
    }>;
  }>;
  page: number;
  limit: number;
  has_more: boolean;
  language: string;
  direction: string;
}
```

The exact wire schema uses snake case; Quran.com's fetcher camel-cases it before its React components receive it. The contract and pagination limits are in the [official expanded-hadith endpoint documentation](https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/hadiths-by-ayah/). The endpoint's documented `SUNNAH_API_KEY is required` configuration failure and upstream-Sunnah failure response establish that Quran Foundation expands its curated reference records through the Sunnah service rather than serving a QUL corpus.

Hadith numbers are strings, not integers: values such as `395 a`, `1a`, or comma-separated references must retain suffixes. Quran.com normalizes those only for its Sunnah.com link, as shown in its [number parser](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/components/QuranReader/ReadingView/StudyModeModal/tabs/Hadith/utility.ts#L53-L87).

## Authentication and live probe

These are backend-only Content APIs. Quran Foundation requires approved `client_id` and `client_secret` credentials, obtained through its [access request](https://api-docs.quran.com/request-access/). A backend exchanges them using OAuth2 Client Credentials at `POST https://oauth2.quran.foundation/oauth2/token`, with HTTP Basic authentication and `grant_type=client_credentials&scope=content`; the resulting token is sent on Content API calls as `x-auth-token`, alongside `x-client-id`. Tokens last for the returned `expires_in` period and the secret must never be put in browser, mobile, or other distributable client code. See the [manual authentication guide](https://api-docs.quran.com/docs/quickstart/manual-authentication/), [first-call header requirements](https://api-docs.quran.com/docs/quickstart/first-api-call/), and [server SDK guidance](https://api-docs.quran.com/docs/sdk/javascript/hadith-references/).

A safe unauthenticated probe on 2026-07-22 of both production ayah routes for `1:3` returned HTTP 400 with `{"message":"The request is missing required headers or is invalid",...}`. The live Quran.com page itself worked because Quran.com resolves the authenticated data server-side and through its signed internal proxy. That proxy and the page's embedded state are implementation details, not supported public data endpoints.

This matters for a downloadable CLI: a client secret compiled into `quran.sh` is recoverable and violates the server-only rule. The choices are an approved, tightly scoped `quran.sh` server-side proxy or user-supplied developer credentials; the former is the only acceptable default user experience.

## Availability, attribution, and reuse

- **QUL has no hadith source.** QUL's [official FAQ](https://qul.tarteel.ai/faq) says it currently focuses on Quranic resources, does not offer hadith data, and recommends Sunnah.com and its API. The [QUL repository](https://github.com/TarteelAI/quranic-universal-library/tree/b355ee107e8f4bb10fd23792938cd104bcd3467e) contains Quran-resource management code but no structured hadith corpus or ayah-to-hadith index. Tafsir resources may quote narrations inside commentary, but those quotations are not a normalized, independently attributable related-hadith dataset.
- **Sunnah.com's API is keyed and partial.** Its [developer page](https://sunnah.com/developers) says an API key is required, only a portion of manually checked data is exposed, and an offline dump is not yet available. Its public API repository contains application code and a sample database, not a licensed complete local corpus or Quran-ayah relationship index.
- **Do not scrape Quran.com or Sunnah.com.** Quran Foundation's [Developer Terms](https://api-docs.quran.com/legal/developer-terms/) prohibit extracting, scraping, or indexing QF content outside API responses. Sunnah.com's [reproduction policy](https://sunnah.com/about) prohibits scraping and mass reproduction; it permits individual selections for teaching/didactic/presentation use and directs integrations to the API.
- **QF API reuse is conditional, not an open-data grant.** The Developer Terms allow QF content to be displayed as an integral part of a beneficial Quranic experience, but prohibit resale, sublicensing, raw-data redistribution, misleading context, and caching for longer than one week without express permission. They also require a public privacy policy and terms for the application. The feature should visibly name the collection, exact hadith number, grade when supplied, “via Sunnah.com,” and the source link, while preserving Quran.com's non-exhaustive-curation notice.

There is therefore no approved open local fallback among the requested primary sources today. Do not manufacture one by extracting hadith quoted inside QUL tafsir, copying Quran.com's rendered payloads, or bundling Sunnah.com data from an unofficial dump.

## Recommended `quran.sh` implementation

1. **Make `h` contextual and lazy.** Pressing `h` should open the current ayah's Hadith panel and only then dynamically import the provider. Skip the count request unless the UI needs an availability badge; an empty `hadiths` array should produce a clear “No curated related hadith are currently available for this ayah” state rather than a dead end.
2. **Use an explicit online-consent dialog.** Before the first request, explain that the current `chapter:verse` and the user's IP will be sent to a Quran Foundation-backed `quran.sh` service, name Sunnah.com as the narration source, and offer “Continue online” and “Stay offline.” Never send notes, history, bookmarks, or surrounding verses.
3. **Keep credentials on an approved proxy.** Request Quran Foundation Content API access for quran.sh and confirm that a public CLI may receive proxied, end-user display responses under the Developer Terms. The proxy should hold and rotate the client secret, cache OAuth tokens in memory, expose only the current-ayah hadith operation, validate coordinates, rate-limit abuse, and avoid religious-reading telemetry. Do not call Quran.com's private proxy and do not ship a QF or Sunnah API key in the Bun executable.
4. **Fetch one bounded page at a time.** Start with `page=1&limit=4`; fetch the next page only when the reader asks for more and only while `has_more` is true. Apply a short timeout, a strict response-byte limit, a small per-ayah LRU, request cancellation on navigation, and a cache TTL safely below QF's one-week ceiling. Clear cached content at process exit unless QF expressly approves local persistence.
5. **Treat content as multilingual structured data.** Validate the requested verse and every response field, preserve collection/URN/hadith-number strings, sanitize the HTML body to a small plain-text allowlist, and never pass upstream markup or custom `[quran ...]` tags directly to OpenTUI. Render Arabic as its own `dir=rtl` block using the project's grapheme-safe RTL path; do not concatenate it with English or allow wrapping to reorder Arabic clusters.
6. **Preserve scholarly context.** Each card should show collection, exact reference, chapter title, supplied grade and grader, English/Arabic toggles, and a Sunnah.com URL. Put the concise Quran.com notice above the list: these narrations explicitly reference the selected ayah range, are curated from Bukhari and Muslim, and are not exhaustive. Hadith should support reading and study, not imply that one narration alone constitutes a ruling; Sunnah.com's own [about page](https://sunnah.com/about) makes that limitation explicit.

If Quran Foundation cannot approve a credential-safe public CLI proxy, ship the `h` panel behind user-supplied QF credentials or defer it. Scraping the public Quran.com page would technically work today, but it would be brittle and conflict with both the documented access model and source reuse terms.
