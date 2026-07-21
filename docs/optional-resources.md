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
  "compatibility": { "quran.sh": ">=0.7.0", "narration": "hafs" }
}
```

`quran resources import manifest.json data.json` verifies size, SHA-256, JSON/SQLite integrity, source URLs, and attribution before an atomic promotion. `list`, `verify`, `licenses`, and `remove` make provenance and lifecycle inspectable. quran.sh never automates a QUL login, scrapes restricted downloads, or assumes the QUL software license covers hosted data.

QUL currently has no hadith dataset. A separately licensed `hadith` pack can still be imported when each row carries a canonical `verse_key`, narration `body` or `text`, `collection`, string-valued `hadith_number`, language/direction, and enough source/license metadata for attribution; Arabic and English rows with the same collection and number are grouped in the reader. quran.sh does not infer verse relationships by searching narration prose.

When `w` finds no compatible installed study row for the active ayah, the reader offers an explicit online fallback instead of ending at an import instruction. If accepted, a deferred provider adapter requests only that verse key and the fixed `ar.muyassar` edition from the keyless [Al Quran Cloud API](https://alquran.cloud/api), validates the returned coordinate and edition, rejects markup, caps each response at 256 KiB, and keeps at most 24 ayat/2 MiB in memory until the reader closes. The panel labels the result as online, preserves [provider attribution and terms](https://alquran.cloud/terms-and-conditions), renders its Arabic through the calibrated RTL path, and offers retry or a clean offline exit if the provider is unavailable. Installed QUL-compatible content always takes precedence.

Pressing `h` checks attributed local `hadith` packs first. With [approved developer credentials](https://api-docs.quran.com/request-access/) supplied as `QF_CLIENT_ID` and `QF_CLIENT_SECRET` (and optional `QF_ENV=production|prelive`), the reader can then request Quran Foundation's documented hadith-by-ayah endpoint after explicit consent. The adapter is imported only on demand, keeps the secret and OAuth token in process memory, fetches four Arabic and English records per page, sanitizes upstream HTML to plain terminal text, renders every Arabic line through the calibrated RTL path, uses a 24-page/2 MiB session cache, and caps the visible rolling window at twelve records. Without credentials, `h` offers Quran.com's canonical hadith page in the system browser; it never calls Quran.com's private proxy or scrapes the rendered page. The notice remains visible because these are non-exhaustive narrations from Sahih al-Bukhari and Sahih Muslim that explicitly reference an ayah, and some ayat have no entries.

## Playback and timing

An installed recitation pack supplies per-ayah MP3/FLAC URLs, reciter attribution, and optional `[wordIndex, startMs, endMs]` segments. If no pack exists, pressing `p` opens a confirmation dialog for the bundled pack descriptor and downloads a checksum-pinned 607 KiB index covering all 6,236 ayat from the independent [`resource-packs-v1`](https://github.com/smashah/quran.sh/releases/tag/resource-packs-v1) release. The index uses the [Al Quran Cloud public CDN](https://alquran.cloud/cdn) for Mishary Rashid Alafasy at 128 kbps and retains the provider's [terms and attribution](https://alquran.cloud/terms-and-conditions); those terms describe personal/educational and non-commercial use while copyright remains with the reciter, so the manifest does not claim unconditional redistribution rights. Audio itself streams only for the ayah the reader asks to play. The same pack can be installed non-interactively with `quran resources install starter-audio`.

Network playback has its own first-use dialog because the CDN receives the normal media request even though quran.sh sends no listening history or telemetry. The dialog names the attributed provider and exact media host, and approval is remembered only for that provider+origin combination. OpenTUI Audio and the downloader enter through deferred chunks, the pack download has strict byte ceilings and a streaming file sink, and the resource manager verifies identity, size, SHA-256, all Quran coordinates, and license metadata before atomic promotion. Verified timing segments from a compatible QUL pack map through canonical `surah:ayah:word` coordinates; gaps or ambiguous tokenization fall back to ayah-level playback instead of highlighting the wrong word. Starting microphone capture stops playback to prevent feedback.

## Tilawa follow-my-recitation

Tilawa runs locally and expects 16 kHz mono Float32 PCM. `quran models install official --yes` uses the pinned v0.2.0 release manifest; a file or URL can provide a reviewed alternative. The command displays the total bytes, license, and attribution before downloading, streams each file to bounded staging memory, and checks the upstream release SHA-256 before promotion. An existing verified version remains available until the replacement succeeds. `verify`, `status`, and `remove` manage the private model store. The model is not part of quran.sh's npm package or standalone binary.

Live capture uses an already-installed FFmpeg sidecar on macOS, Linux, or Windows. quran.sh does not enumerate devices or request microphone access at startup. Audio is bounded in memory, sent only to the local Tilawa session, and not retained. A WAV source implements the same interface for deterministic/offline use. Tentative candidates update status only; committed `verse_match` events may navigate, word progress is shown only when its mapping is verified, and final sequences require review before any reading-history update.

## Images and spatial cells

Ayah PNG requests remain opt-in. When a QUL-compatible pack has no suitable visual asset, `i` opens a disclosed fallback from Al Quran Cloud's documented [Islamic Network image CDN](https://alquran.cloud/cdn); `g` offers the same exit when no verified local Mushaf layout can drive page-line rails or when WebGPU fails. The viewer prefers the high-resolution ayah path and falls back to normal resolution on the same HTTPS origin, refuses redirects, checks both the declared media type and PNG signature, and caps each response at 4 MiB. Source bytes, decoded pixels, and final Braille grids have independent byte/item budgets; resize is debounced, stale fetches are aborted, failures offer retry or an immediate return to live terminal text, and `+`/`-`, arrows, and `0` control the focused viewport.

The `g` command dynamically imports released `@opentui/three` 0.4.5 and generated geometry only. It renders WebGPU pixels back into terminal character cells; it is not Kitty, SIXEL, or iTerm image-protocol support. The scene uses verified QUL Mushaf page/line coordinates when available to illuminate a followable page scaffold, hides those rails when coordinates are absent, keeps Quran text in ordinary cells, performs no scene network requests, and is disabled in safe mode.

`bun-webgpu` must install its global WebGPU objects before probing or constructing OpenTUI Three; quran.sh performs that bootstrap explicitly. `quran doctor --gpu` runs the real adapter/device probe only on request and reports platform-specific recovery steps. If a machine genuinely has no device, the in-reader dialog offers retry and a terminal-cell geometric illumination that needs no native package or GPU, so Quran reading never ends at a capability error.
