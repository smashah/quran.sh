# Quran.com resource-catalogue proxy research

Verified on 2026-07-22 against Quran.com's production routes, the current Quran.com frontend source at commit [`aff1a03`](https://github.com/quran/quran.com-frontend-next/tree/aff1a035b09b66f28047b3216edcae4c5c949a49), and the Quran Foundation v4 documentation.

## Verdict

The two supplied Quran.com URLs are not cookie-gated. They are private same-origin proxy routes: a request with neither an allowed `Origin` nor an allowed `Referer` gets `403 {"error":"Forbidden"}`, while the same request with `Origin: https://quran.com` or `Referer: https://quran.com/` succeeds without any cookie. A browser-looking `User-Agent` alone still gets 403, and a foreign origin or referrer still gets 403.

This is deliberate in the [proxy route](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/pages/api/proxy/%5B...path%5D.ts): it accepts a hostname in the deployment's `ALLOWED_ORIGINS`, otherwise it requires an internal HMAC proxy signature. It forwards cookies when a request happens to contain them, but cookies are not the authorization mechanism for these catalogue calls. A CLI can technically forge an `Origin` header, but quran.sh should not use that as an API integration because it bypasses the boundary Quran.com put around its web proxy and can break whenever their deployment policy changes.

### Production probe matrix

Both exact user-supplied endpoints behaved the same way:

| Request context | Result |
| --- | --- |
| Plain `curl`, no cookie, origin, or referrer | 403, 21-byte `{"error":"Forbidden"}` |
| Browser `User-Agent` only, no cookie | 403 |
| `Origin: https://quran.com`, no cookie | 200 |
| `Referer: https://quran.com/`, no cookie | 200 |
| `Origin: https://example.com` or matching foreign referrer | 403 |

The endpoints probed were the supplied [translation catalogue](https://quran.com/api/proxy/content/api/qdc/resources/translations?language=en) and [combined reciter catalogue](https://quran.com/api/proxy/content/api/qdc/audio/reciters?locale=en&fields=undefined). These observations establish current production behaviour, not a public contract.

## What the Quran.com frontend is doing

Quran.com's [`makeUrl`](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/utils/api.ts) adds the internal `/api/qdc` prefix, and [`getProxiedServiceUrl`](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/utils/url.ts) routes non-static builds through `/api/proxy/content`. The frontend path builders then request `/resources/translations` and `/audio/reciters` in [`apiPaths.ts`](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/utils/apiPaths.ts). The server-side proxy signs the upstream request with Quran.com's internal client ID and HMAC secret, so the browser never receives those credentials.

`fields=undefined` is a frontend serialization bug, not a meaningful field selection. `makeAvailableRecitersUrl(locale, fields?)` always puts the optional `fields` property into the parameter object, while Quran.com's [`qs-stringify`](https://github.com/quran/quran.com-frontend-next/blob/aff1a035b09b66f28047b3216edcae4c5c949a49/src/utils/qs-stringify.ts) removes `null` but not `undefined`; `encodeURIComponent(undefined)` consequently produces the literal string `undefined`. Production returned byte-identical bodies for no `fields`, `fields=`, and `fields=undefined`, while `fields=profile_picture` changed the response. quran.sh should omit absent parameters rather than copy this quirk.

## Supported Quran Foundation equivalents

The supported interface is the authenticated Quran Foundation Content API at `https://apis.quran.foundation/content/api/v4`. It uses the OAuth2 `client_credentials` flow with the `content` scope and requires `x-auth-token` plus `x-client-id` on resource requests; the [official quickstart](https://api-docs.quran.foundation/docs/quickstart/) says credentials must remain server-side and tokens should be cached until shortly before their one-hour expiry. Anonymous probes of both supported catalogue URLs returned the documented `400 invalid_request` response for missing required headers.

| Need | Supported endpoint | Meaning |
| --- | --- | --- |
| Translation catalogue | `GET /resources/translations?language=en` | Translation resource IDs, authors, source language, and localized display metadata; see [Translations](https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/translations/). |
| Ayah-by-ayah audio catalogue | `GET /resources/recitations?language=en` | Recitation resource IDs used by verse endpoints and `/recitations/{id}/...`; see [Recitations](https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/recitations/). |
| Whole-chapter audio catalogue | `GET /resources/chapter_reciters?language=en` | Chapter-reciter IDs used by chapter audio, timestamp, and lookup endpoints; see [Chapter Reciters](https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/chapter-reciters/). |
| Style descriptions | `GET /resources/recitation_styles` | Descriptions of Murattal, Mujawwad, and Muallim; see [Recitation Styles](https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/recitation-styles/). |

There is no single supported v4 response identical to Quran.com's legacy combined `/api/qdc/audio/reciters` shape. quran.sh should consume the official catalogues according to playback mode instead of treating the private combined response as its schema.

## Semantics that matter in quran.sh

- The translation `language=en` parameter localizes catalogue names into English; it does not filter the catalogue to English translations. The production response contains resources in many source languages, so the chooser must filter or group by each row's `language_name`. Use the numeric `id` as the resource key because observed rows contain blank or null slugs. A selected translation ID can then be passed to verse endpoints or the dedicated translation endpoint; the [single-translation reference](https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/translation/) explicitly calls it a translation resource ID.
- Recitation IDs and chapter-reciter IDs are different namespaces and the official docs explicitly say they are not interchangeable. In Quran.com's private combined response, `id` matches the recording/recitation choice while `reciter_id` identifies the underlying reciter; that legacy field is not documented as an official chapter-reciter resource ID and quran.sh must not infer that mapping. The repeated people in the supplied data are meaningful: AbdulBaset has separate Mujawwad and Murattal recitation IDs, and Al-Husary has Murattal and Muallim resources. Fetch each supported catalogue independently and model its returned keys as branded IDs such as `AyahRecitationId` and `ChapterReciterId`, with the style and qiraat carried alongside the selected resource, so a whole-chapter request cannot accidentally receive an ayah-recitation ID.
- Reciter name is not a safe identity join. The current combined catalogue has multiple resource IDs for the same displayed person and even repeated name/style combinations. Preserve upstream IDs and recording metadata; normalize names only for search and display.
- Catalogue metadata is not the media itself. Whole-chapter playback should resolve a chapter audio record lazily after the user chooses a reciter and chapter; ayah playback should resolve the selected recitation lazily for the visible/current ayah. The [official audio SDK guide](https://api-docs.quran.foundation/docs/sdk/javascript/audio/) distinguishes chapter, verse, and word audio sources and warns that Content API requests still need confidential credentials even when the final media URL is public.

## Safe integration recommendation

1. Put a provider interface in front of catalogues, with distinct methods for `listTranslations(locale)`, `listAyahRecitations(locale)`, and `listChapterReciters(locale)`. The Quran Foundation provider should use user-supplied `QF_CLIENT_ID` and `QF_CLIENT_SECRET` through the existing authenticated Content API layer; never embed a maintainer secret in the distributed CLI and never send a forged Quran.com origin.
2. Lazy-load each catalogue only when its chooser opens, coalesce concurrent requests, and cache the small normalized result by locale. A 24-hour catalogue TTL is reasonable and remains inside Quran Foundation's current maximum one-week cache/storage limit. Fetch verse translations and audio-file metadata only for the current visible range or play action, not when the app starts.
3. Keep a last-known-good catalogue for offline selection only while it remains within the permitted retention window, and show its fetch time/source. If credentials are absent or the official API fails, fall back to an independently licensed/open provider or an installed pack rather than silently calling Quran.com's private proxy.
4. Treat source and rights as part of every resource record. Quran Foundation's [Developer Terms](https://api-docs.quran.foundation/legal/developer-terms/) cover translations, metadata, and audio as QF Content, prohibit scraping outside API responses, limit caching/storage to one week unless separately permitted, and restrict raw redistribution. A catalogue response is discovery metadata, not permission to vendor every translation or audio collection into quran.sh.
5. For the UX, present `Qari — style — qiraat` rather than a flat name list, and explain the practical difference: Murattal for measured reading/study, Mujawwad for melodic recitation, Muallim or repeat recordings for learning. Translation selection should be `language → author/edition`, with current selections loaded per verse, because this turns the large catalogue into a useful reader choice without paying the network or memory cost of loading its content upfront.

No source code or tests were changed or run as part of this research.
