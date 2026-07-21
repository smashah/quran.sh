# Changelog

All notable changes to quran.sh are documented here.

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
[0.7.0]: https://github.com/smashah/quran.sh/compare/v0.6.0...v0.7.0
[0.5.0]: https://github.com/smashah/quran.sh/releases/tag/v0.5.0
