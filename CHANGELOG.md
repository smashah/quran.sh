# Changelog

All notable changes to quran.sh are documented here.

## [Unreleased]

## [0.8.1] - 2026-07-22

### Changed

- Rebuilt immersive study and related-hadith views as responsive task workspaces instead of fixed 40-column sidebars: the current ayah keeps a dedicated context card, commentary or narrations receive the remaining viewport, standard 88-column terminals use a readable split, and compact terminals stack the same content without exposing raw provider URLs.
- Added a live follow-play HUD with preparation/buffering states, verified word position, elapsed and total time, progress, and next-ayah preload status. The main reader now keeps one stable centered ayah surface, exposes transliteration in Learn mode, and uses a shorter footer so controls no longer wrap through the reading area.

### Fixed

- Removed empty translation, topic, and morphology placeholders from study mode, kept Arabic blocks independently bounded inside scrollable panes, and made loading or unavailable states explicit instead of leaving apparently blank panels.
- Replaced the release preview's browser reconstruction of OpenTUI snapshot spans with a real PTY recording path after confirming that `captureSpans()` displaced Quranic combining marks even though the live ANSI renderer emitted the Arabic correctly.

## [0.8.0] - 2026-07-22

### Added

- Added lazy, credentialed Quran Foundation tafsir browsing to both the default and immersive readers: `w` opens the saved English commentary with Ibn Kathir as the initial selection, `W` loads a paginated persisted resource picker, and the default reader's former Arabic-width shortcut moves to `G`. HTML is sanitized into independently directed Arabic and English blocks, and canonical multi-ayah commentary ranges are shown without breaking RTL. The browser-only Quran.com proxy is deliberately avoided; missing credentials or official API failure automatically retains the keyless Tafsir al-Muyassar path.
- Added optional synchronized word following in the immersive reader from Quran Foundation's official ayah-recitation endpoint: matching Mishari al-Afasy audio and zero-based word segments are requested together under the immersive source agreement, cached within strict bounds, and the installed ayah-level stream remains the automatic fallback. The selected word is emphasized in terminal text and in the 3D ayah surface without rebuilding its glyph geometry.
- Added a local `bun run poc:web` gallery with four responsive Al-Fatihah 1:5 studies: an illuminated arch, a Mushaf reading plane, a restrained recitation-following treatment, and a WebGL-framed official Haram livestream embed. Three.js is a direct dependency but remains outside normal startup and loads in the gallery only after an explicit action; the YouTube player requires a second action and is never sampled into a texture.
- Added lazy Arabic, translation, and transliteration search to the unified reader through `/` and `Ctrl+F`, reusing the dashboard's bounded fuzzy-search surface and navigating directly to the selected ayah.
- Added a lazy Al Quran Cloud study source with attributed Tafsir al-Muyassar, bounded per-ayah requests and memory cache, RTL-safe rendering, retry/offline exits, and a scrollable study overlay at standard terminal sizes.
- Added `h` in immersive mode for verse-related hadith: approved user-supplied Quran Foundation credentials enable a deferred bilingual in-reader panel with bounded pagination and RTL-safe Arabic, while the canonical Quran.com page is the zero-configuration path without scraping private endpoints.
- Added a lazy OpenTUI Three Arabic reader with `r` ayah/page layouts and `f` Uthmani/IndoPak/Tajweed script selection: shaped RTL glyphs become vector geometry, ayah text is subtly extruded, page lines lift the active ayah, and the online Uthmani page source is honestly labelled as adaptive page flow.

### Changed

- Replaced the immersive reader's repeated QUL-first fallback and per-provider permission prompts with one startup source disclosure offering `OK`, `Don't show again`, and `Cancel`. Accepted sessions use Quran.com-hosted fonts and canonical hadith pages, Quran Foundation's supported credentialed APIs, and documented Al Quran Cloud/Islamic Network fallbacks directly; downloads, microphone access, and actionable failure recovery keep their own dialogs.
- Increased the opt-in immersive reader's Arabic reading field responsively, made the Arabic bold, and visually subordinated the translation so the ayah remains the primary reading surface even when spatial rendering is off.
- Kept the established bookmarks, cues, reflections, themes, and reading-stats dashboard as the default no-argument TUI; the experimental reader remains explicitly opt-in through `quran immersive`, and both experiences share the saved Quran position.
- Moved opt-in ayah images to Al Quran Cloud's documented Islamic Network CDN, preferring its high-resolution source and falling back to its normal-resolution source under the same approved HTTPS origin; redirects and invalid PNG bodies are rejected.
- Connected the lazy image viewer to immersive mode through `i` and to the no-QUL-layout/WebGPU recovery dialogs, with explicit network consent, retry, and a return to live terminal text at the same ayah.
- Made immersive playback follow manual ayah navigation and natural audio completion: changing ayat stops the previous stream immediately, aborts its stale preload, and waits 180 ms for rapid navigation to settle before requesting only the final ayah; reaching the end of an ayah advances without that delay, and a single bounded in-memory preload is handed directly to OpenTUI Audio for that transition.
- Made timed playback and preloading reject chapter-absolute or malformed segments, abort superseded metadata requests during fast navigation, and keep the audio URL and segment data from the same recitation response so a different recording can never be highlighted against them.
- Replaced the progress-only WebGPU backdrop with actual Quran text while keeping fonts, page data, `fontkit`, and Three.js deferred; disabling the surface clears vector geometry and the two-font memory cache. Tajweed colors come only from verified QCF `code_v2` glyph palettes and are never inferred from Unicode text.

### Fixed

- Reflowed long spatial ayat into balanced RTL lines using the selected Quran font's shaped word widths and OpenTUI's pixel-correct viewport aspect ratio. The vector surface now uses the available height with small edge insets, rewraps after a debounced terminal resize, and preserves every global word position for synchronized recitation highlighting.
- Prevented responsive spatial ayat from collapsing to a few pixels by fitting against their stable camera-space anchor instead of the unscaled extrusion bounds, which can temporarily extend behind the camera. Initial OpenTUI resize events also wait for the requested Quran surface to commit instead of aborting it with a competing reflow.
- Mapped timing word positions through the selected terminal RTL strategy instead of searching rendered text by value, so repeated Arabic words highlight their correct occurrence without changing the calibrated shaping or visual order.
- Made OpenTUI Three activation await the real renderer with the single-flight initialization behavior from the upstream `threejs-house-demo` branch, removed the redundant throwaway-device probe, and stopped misreporting Quran font or reading-data failures as an unavailable Metal device.
- Moved the WebGPU Quran surface above the reader's clearing layer and bounded it between the header, translation, and controls, so the shaped Arabic is now a bright foreground reading surface instead of faint geometry hidden behind an empty box.

## [0.7.1] - 2026-07-21

### Added

- Added an opt-in, application-hash-pinned 6,236-ayah Mishary Rashid Alafasy streaming index from the independent `resource-packs-v1` release using the documented Al Quran Cloud / Islamic Network CDN, with a confirmation/progress/cancel dialog, bounded streaming download, stored attribution, CLI installation, and atomic verification.
- Added reusable keyboard-owned choice dialogs for pack downloads, remote playback, local microphone capture, and WebGPU activation; `Esc` consistently cancels without leaking the triggering shortcut to the reader.
- Added `quran doctor --gpu`, platform-specific WebGPU recovery guidance, retry, and a lightweight terminal-cell illumination fallback that keeps spatial mode usable without a GPU.
- Added a primary-source Quran.com/Quran Foundation experience-source audit covering reusable reader data, credentialed APIs, private account features, and brittle frontend endpoints.

### Fixed

- Initialized `bun-webgpu` globals before probing or creating the OpenTUI Three device, fixing the misleading `navigator.gpu.requestAdapter` unavailable error on otherwise supported systems.
- Mounted OpenTUI Three as an absolute background, requested its first frame only after attachment, and raised the arch/star contrast so spatial mode visibly frames the reader without displacing Quran text.
- Replaced dead-end playback and spatial status messages with actions that install, retry, diagnose, fall back, or cancel.

### Security and privacy

- Remote pack acquisition requires HTTPS, enforces manifest/data byte ceilings while streaming to disk, pins the expected pack identity, and reuses the existing size, checksum, coordinate, license, and atomic-promotion gates.
- Public audio is requested only after explicit provider-and-origin-scoped playback consent; the dialog names both the provider and media host, while quran.sh sends no listening history or telemetry and discloses that the CDN receives the request.

## [0.7.0] - 2026-07-21

### Added

- Added `quran immersive` with Focus, Learn, Recite, and Memorise presentations, adaptive compact/standard/immersive layouts, persistent reduced motion, and a text-only safe mode.
- Added `quran stream`, using OpenTUI's released split-footer/scrollback API to commit copy-safe Arabic and translation text into normal terminal history without duplicate backtracking entries.
- Added QUL-compatible JSON/SQLite resource manifests, checksum and license validation, atomic import/verify/list/remove commands, canonical verse/word coordinates, offline study repositories, recitation timings, and Mushaf page scenes.
- Added opt-in OpenTUI Audio recitation, bounded playback state, continuous generation guards, and verified word-timing sessions.
- Added opt-in Tilawa 0.1.0 recognition with pinned model manifests, atomic model installation, local WAV/FFmpeg capture, conservative committed-match navigation, and immediate cleanup.
- Added an experimental released OpenTUI Three 0.4.5 scene whose generated arches can frame the reader and whose Mushaf-line rails appear only for verified 604-page/6,236-ayah layout packs, without rasterizing Quran text into 3D.
- Added `quran doctor`, machine-readable performance reports, CI artifacts, Arabic/RTL breakpoint fixtures, lifecycle stress tests, and a reproducible VHS MP4/GIF demo.

### Changed

- Split the application into a 2.4 KB startup entry and deferred command, TUI, feature, and translation chunks; optional non-English datasets now load only when selected.
- Adopted Effect 3.22 only inside dynamically loaded heavy boundaries, while the dependency-free feature runtime owns single-flight activation, cancellation, typed errors, retry, and exact-once finalization.
- Reworked the lazy Braille image viewer with 1–8× zoom, bounded pan, debounced resize, cooperative decode/raster work, cancellation, explicit cache clearing, and separate byte-limited source, decoded-pixel, and final-grid caches that unload with the pane.

### Security and privacy

- QUL data is user-imported with dataset-specific provenance and no login automation or scraping; optional model/network size and attribution are explicit before installation.
- Microphone PCM remains local and is not retained, telemetry remains absent, and no media, model, pack, or GPU capability activates during normal startup.

## [0.6.0] - 2026-07-21

### Added

- Added language-aware translation and fuzzy search across all ten supported languages.
- Added tracked, bundled SQLite migrations that work in both the npm package and standalone binary.
- Added shared ayah image caching, request cancellation, timeouts, and an explicit network privacy notice.
- Added strict type-checking, cross-platform CI, isolated database tests, and regression coverage for CLI startup, focus handling, migrations, and image loading.
- Added the MIT software license, CC BY-SA 4.0 data attribution, and a primary-source OpenTUI upgrade audit.

### Changed

- Upgraded `@opentui/core` and `@opentui/react` from 0.1.79 to 0.4.5 and aligned React with the 19.2 peer requirement.
- Replaced duplicated keyboard actions with a shared command registry and reducer-driven focus model that skips hidden panes.
- Updated OpenTUI text, select, scrollbox, lifecycle, and renderable-removal APIs.
- Moved SQL migrations and the RTL development harness under `src/` so application source is bundled from one tree.
- Consolidated data tests under `test/` and removed static `/tmp` database names.
- Removed unused image/OCR/testing/Yoga dependencies and let OpenTUI manage its native platform packages.

### Fixed

- Fixed terminal cleanup on quit by destroying the renderer instead of terminating the process directly.
- Fixed `--help`, read, and search commands creating or logging a SQLite database unnecessarily.
- Fixed image mode re-downloading and decoding the same PNG after every terminal resize.
- Fixed focus moving to the Arabic pane while that pane was hidden.
- Fixed stale TUI tests, React `act()` warnings, and 30 strict TypeScript errors hidden by the bundler.
- Fixed npm package contents so standalone binaries are not included in the registry tarball.
- Fixed standalone binaries so Quran text and translations are embedded and remain available outside the source checkout.

### Security

- Removed the vulnerable transitive dependency chain brought in by the old OpenTUI release; `bun audit` is clean on the upgraded tree.

## [0.5.0] - 2026-02-21

- Stabilized database migrations and test database cleanup.

[0.6.0]: https://github.com/smashah/quran.sh/compare/v0.5.0...v0.6.0
[Unreleased]: https://github.com/smashah/quran.sh/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/smashah/quran.sh/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/smashah/quran.sh/compare/v0.7.1...v0.8.0
[0.7.0]: https://github.com/smashah/quran.sh/compare/v0.6.0...v0.7.0
[0.7.1]: https://github.com/smashah/quran.sh/compare/v0.7.0...v0.7.1
[0.5.0]: https://github.com/smashah/quran.sh/releases/tag/v0.5.0
