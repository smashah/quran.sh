# Changelog

All notable changes to quran.sh are documented here.

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
[0.5.0]: https://github.com/smashah/quran.sh/releases/tag/v0.5.0
