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

## Playback and timing

An installed recitation pack supplies per-ayah MP3/FLAC URLs, reciter attribution, and optional `[wordIndex, startMs, endMs]` segments. Pressing `p` dynamically activates OpenTUI Audio with bounded streaming buffers. Verified segments map through canonical `surah:ayah:word` coordinates; gaps or ambiguous tokenization fall back to ayah-level playback instead of highlighting the wrong word. Starting microphone capture stops playback to prevent feedback.

## Tilawa follow-my-recitation

Tilawa runs locally and expects 16 kHz mono Float32 PCM. `quran models install official --yes` uses the pinned v0.2.0 release manifest; a file or URL can provide a reviewed alternative. The command displays the total bytes, license, and attribution before downloading, streams each file to bounded staging memory, and checks the upstream release SHA-256 before promotion. An existing verified version remains available until the replacement succeeds. `verify`, `status`, and `remove` manage the private model store. The model is not part of quran.sh's npm package or standalone binary.

Live capture uses an already-installed FFmpeg sidecar on macOS, Linux, or Windows. quran.sh does not enumerate devices or request microphone access at startup. Audio is bounded in memory, sent only to the local Tilawa session, and not retained. A WAV source implements the same interface for deterministic/offline use. Tentative candidates update status only; committed `verse_match` events may navigate, word progress is shown only when its mapping is verified, and final sequences require review before any reading-history update.

## Images and spatial cells

Ayah PNG requests remain opt-in. Source bytes, decoded pixels, and final Braille grids have independent byte/item budgets; resize is debounced, stale fetches are aborted, and `+`/`-`, arrows, and `0` control the focused viewport.

The `g` command dynamically imports released `@opentui/three` 0.4.5 and generated geometry only. It renders WebGPU pixels back into terminal character cells; it is not Kitty, SIXEL, or iTerm image-protocol support. The scene uses verified QUL Mushaf page/line coordinates when available to illuminate a followable page scaffold, hides those rails when coordinates are absent, keeps Quran text in ordinary cells, performs no scene network requests, and is disabled in safe mode.
