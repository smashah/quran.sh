# Optional resources, audio, and privacy

The normal reader is complete without network, QUL data, a microphone, ONNX, or WebGPU. Every optional subsystem is disabled until its command is invoked, has one application-owned lifetime, and releases its files, streams, workers, native sessions, and GPU objects when disabled or when OpenTUI shuts down.

## QUL-compatible packs

QUL is a resource catalogue, not a public runtime API. Download a resource through QUL's supported user flow, review that dataset's terms, then describe the local file with a manifest and import it:

```json
{
  "schemaVersion": 1,
  "id": "example-hafs-timing",
  "version": "2026-07-21",
  "title": "Example Hafs timing pack",
  "kind": "recitation",
  "format": "json",
  "source": {
    "provider": "QUL",
    "resourceId": "resource-id",
    "url": "https://qul.tarteel.ai/resources/recitation/resource-id",
    "retrievedAt": "2026-07-21T00:00:00Z"
  },
  "content": { "bytes": 1234, "sha256": "replace-with-64-lowercase-hex-characters" },
  "license": {
    "name": "dataset-specific license",
    "url": "https://source.example/license",
    "attribution": "Required attribution",
    "redistribution": "local-import-only"
  },
  "compatibility": { "quran.sh": ">=0.7.0", "narration": "hafs", "linesPerPage": "15" }
}
```

`quran resources import manifest.json data.json` verifies size, SHA-256, JSON/SQLite integrity, source URLs, and attribution before an atomic promotion. `list`, `verify`, `licenses`, and `remove` make provenance and lifecycle inspectable. quran.sh never automates a QUL login, scrapes restricted downloads, or assumes the QUL software license covers hosted data.

QUL currently has no hadith dataset. A separately licensed `hadith` pack can still be imported when each row carries a canonical `verse_key`, narration `body` or `text`, `collection`, string-valued `hadith_number`, language/direction, and enough source/license metadata for attribution; Arabic and English rows with the same collection and number are grouped in the reader. quran.sh does not infer verse relationships by searching narration prose.

Immersive mode starts with one online-source disclosure, while the default reader shows the equivalent disclosure when its first online feature is opened. `OK` permits the disclosed providers for that session, `Don't show again` persists the same choice, and `Cancel` returns without a request. In either reader, with [approved developer credentials](https://api-docs.quran.com/request-access/) in `QF_CLIENT_ID` and `QF_CLIENT_SECRET`, `w` lazily requests the saved tafsir from Quran Foundation's documented [resource catalogue](https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/tafsirs/) and [ayah endpoint](https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/list-ayah-tafsirs/); Ibn Kathir is the initial English selection and `W` inside the tafsir view opens a persisted, paginated picker for every currently available English resource. The browser-facing `quran.com/api/proxy` route returns HTTP 403 without browser session context, so quran.sh neither copies browser cookies nor treats that private proxy as an application API.

The tafsir adapter is imported only when study opens, caps the catalogue at 256 KiB and each commentary at 1 MiB, and evicts its oldest entries when twelve commentaries or an estimated 4 MiB of retained response and rendered text is reached. Superseded ayat are aborted and hidden immediately, while upstream HTML is sanitized into bounded plain-text blocks. Arabic quotations and surrounding English paragraphs retain separate direction metadata and render independently, so mixed-language commentary cannot reverse the English text or disturb calibrated Quran RTL. The response's explicit contiguous ayah range is canonically sorted, validated, and shown when one commentary covers multiple ayat. Missing credentials, an unavailable selected resource, or an official API failure automatically uses the fixed `ar.muyassar` edition from the keyless [Al Quran Cloud API](https://alquran.cloud/api), whose deferred adapter retains its existing 256 KiB response and 24-ayah/2 MiB session limits. Both paths preserve attribution and offer retry or a clean return to reading.

With [approved developer credentials](https://api-docs.quran.com/request-access/) supplied as `QF_CLIENT_ID` and `QF_CLIENT_SECRET` (and optional `QF_ENV=production|prelive`), pressing `h` directly requests Quran Foundation's documented hadith-by-ayah endpoint under the immersive source agreement. The adapter is imported only on demand, keeps the secret and OAuth token in process memory, fetches four Arabic and English records per page, sanitizes upstream HTML to plain terminal text, renders every Arabic line through the calibrated RTL path, uses a 24-page/2 MiB session cache, and caps the visible rolling window at twelve records. Without credentials, `h` opens Quran.com's canonical hadith page in the system browser; it never calls Quran.com's private proxy or scrapes the rendered page. The notice remains visible because these are non-exhaustive narrations from Sahih al-Bukhari and Sahih Muslim that explicitly reference an ayah, and some ayat have no entries.

## Playback and timing

### Configure optional Quran Foundation study access

Word synchronization does not require these credentials. They enable the richer Quran Foundation tafsir catalogue and in-reader related-hadith panel, and remain a secondary timing fallback. From a source checkout:

```bash
cp .env.example .env
```

Replace the placeholders in `.env`:

```dotenv
QF_CLIENT_ID=your-approved-client-id
QF_CLIENT_SECRET=your-approved-client-secret
QF_ENV=production
```

Use `QF_ENV=prelive` only for credentials issued against the prelive environment. Bun loads the private `.env` when the reader starts from this checkout; globally installed users can export the same variables in their shell. The repository ignores `.env`, and neither credentials nor OAuth tokens are written to quran.sh's application data. Request access at [Quran Foundation API access](https://api-docs.quran.com/request-access/).

Run `bun run src/index.ts` for the established TUI or add `immersive` for the focused reader, accept the online-source disclosure, and press `p`; no `.env` values are needed for synchronized playback. `FOLLOWING WORD n/N` confirms that matching audio and verified segments are active. `FOLLOWING AYAH` means every timing source was unavailable or failed validation, so the reader preserved ayah-level playback instead of guessing word positions.

An installed recitation pack supplies per-ayah MP3/FLAC URLs, reciter attribution, and optional `[wordIndex, startMs, endMs]` segments. It is now a recovery path rather than a prerequisite: if Quran.com's public timed source is unavailable and no pack exists, pressing `p` offers a checksum-pinned 607 KiB index covering all 6,236 ayat from the independent [`resource-packs-v1`](https://github.com/smashah/quran.sh/releases/tag/resource-packs-v1) release. The index uses the [Al Quran Cloud public CDN](https://alquran.cloud/cdn) for Mishary Rashid Alafasy at 128 kbps and retains the provider's [terms and attribution](https://alquran.cloud/terms-and-conditions); those terms describe personal/educational and non-commercial use while copyright remains with the reciter, so the manifest does not claim unconditional redistribution rights. Audio itself streams only for the ayah the reader asks to play. The same pack can be installed non-interactively with `quran resources install starter-audio`.

Network playback is covered by the shared online-source agreement, so it does not open a second provider-host dialog. The separate starter-pack confirmation remains because it authorizes a persistent local install. OpenTUI Audio and the downloader enter through deferred chunks, the pack download has strict byte ceilings and a streaming file sink, and the resource manager verifies identity, size, SHA-256, all Quran coordinates, and license metadata before atomic promotion. While play mode is active in either reader, manual navigation immediately disposes the previous stream and aborts its preload, then waits 180 ms for key-repeat or scrolling to settle before resolving and requesting only the final ayah. Natural completion bypasses that debounce, advances across ayah and surah boundaries, promotes the one following MP3 preloaded under a 4 MiB ceiling, and stops cleanly after `114:6`.

Verified timing segments from an installed pack map through canonical `surah:ayah:word` coordinates. By default, playback requests Mishari al-Afasy recitation ID 7 from Quran.com's keyless public API: `/api/v4/recitations/7/by_ayah/:key` supplies the per-ayah MP3 on `verses.quran.com`, while `/api/v4/chapter_recitations/7/:chapter?segments=true` supplies the matching recording's word windows. The adapter discards Quran.com's untimed repeat/closing markers, normalizes the first real word to the per-ayah player's zero-based clock, requires sequential word positions, and rejects any ayah whose data remains ambiguous. Chapter metadata is capped at 512 KiB and two retained chapters; completed ayah rows use a 24-entry cache, stale current/next requests abort, and all caches clear with the reader. Approved `QF_CLIENT_ID` and `QF_CLIENT_SECRET` credentials retain the official ayah endpoint as a secondary fallback before the installed ayah-level source. Both terminal readers map logical positions through the calibrated RTL order, while 3D ayah mode changes only tagged glyph depth and emissive emphasis as playback advances. Starting microphone capture stops playback and clears the preload to prevent feedback.

## Tilawa follow-my-recitation

Tilawa runs locally and expects 16 kHz mono Float32 PCM. `quran models install official --yes` uses the pinned v0.2.0 release manifest; a file or URL can provide a reviewed alternative. The command displays the total bytes, license, and attribution before downloading, streams each file to bounded staging memory, and checks the upstream release SHA-256 before promotion. An existing verified version remains available until the replacement succeeds. `verify`, `status`, and `remove` manage the private model store. The model is not part of quran.sh's npm package or standalone binary.

Live capture uses an already-installed FFmpeg sidecar on macOS, Linux, or Windows. quran.sh does not enumerate devices or request microphone access at startup. Audio is bounded in memory, sent only to the local Tilawa session, and not retained. A WAV source implements the same interface for deterministic/offline use. Tentative candidates update status only; committed `verse_match` events may navigate, word progress is shown only when its mapping is verified, and final sequences require review before any reading-history update.

## Images and spatial cells

After the immersive source agreement, `i` directly opens the Al Quran Cloud [Islamic Network image CDN](https://alquran.cloud/cdn) view and `g` offers it as a recovery path when WebGPU fails. The viewer prefers the high-resolution ayah path and falls back to normal resolution on the same HTTPS origin, refuses redirects, checks both the declared media type and PNG signature, and caps each response at 4 MiB. Source bytes, decoded pixels, and final Braille grids have independent byte/item budgets; resize is debounced, stale fetches are aborted, failures offer retry or an immediate return to live terminal text, and `+`/`-`, arrows, and `0` control the focused viewport.

The `g` command dynamically imports released `@opentui/three` 0.4.5, `fontkit`, and the selected Quran.com-hosted font only when invoked. It renders WebGPU pixels back into terminal character cells; it is not Kitty, SIXEL, or iTerm image-protocol support. Arabic is shaped RTL and converted from font outlines into live vector geometry rather than rasterizing a zoomed-out TUI: ayah mode balances long verses across one to six lines from their shaped word widths and the terminal's pixel-correct aspect ratio, while page mode arranges up to fifteen bounded lines and brings the active line forward. A debounced resize reflows ayah lines, and their global word positions remain attached to the glyph meshes for synchronized recitation emphasis. The GPU viewport owns the reading area above the translation and below the header, with bright emissive glyphs composited in front of the terminal layout so React cannot erase them. `r` switches ayah/page mode and `f` cycles the Uthmani Hafs, IndoPak Nastaleeq, and QCF Tajweed faces supplied by Quran.com. Fonts are capped at 512 KiB, held in a two-entry memory cache, and released with the scene.

Uthmani ayah mode uses the bundled Quran text, while Uthmani page mode directly requests the active ayah and its canonical page from the open Al Quran Cloud API, then flows those unchanged ayat to fit the terminal and labels the result `adaptive line flow`. Exact page lines and verified Tajweed text still require compatible local `quran-script` plus `mushaf-layout` packs; those are explicit fidelity upgrades, not the default or a prerequisite. A missing source always offers the working Uthmani ayah reader instead of ending at an import instruction.

`bun-webgpu` must install its global WebGPU objects before probing or constructing OpenTUI Three; quran.sh performs that bootstrap explicitly. `quran doctor --gpu` runs the real adapter/device probe only on request and reports platform-specific recovery steps. If a machine genuinely has no device, the in-reader dialog offers retry and a terminal-cell geometric illumination that needs no native package or GPU, so Quran reading never ends at a capability error.
