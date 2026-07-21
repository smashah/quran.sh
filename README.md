# 📖 quran.sh

> A fast, offline-first Quran CLI and TUI reader built with Bun and TypeScript

[![npm](https://img.shields.io/npm/v/quran.sh)](https://www.npmjs.com/package/quran.sh)
[![License](https://img.shields.io/github/license/smashah/quran.sh)](LICENSE)

<br/>
<div align="center">
  <a href="https://github.com/smashah/quran.sh/raw/main/demos/Tutorial.mp4">
    <img src="https://github.com/smashah/quran.sh/raw/main/demos/demo.gif" width="100%" alt="Quran.sh Demo Video">
  </a>
</div>
<br/>

## Features

### 📚 Reading
- **Offline-First** — All data bundled, works without internet
- **Multi-Pane Reader** — Arabic (top), Translation + Transliteration (split below)
- **10 Languages** — Bengali, English, Spanish, French, Indonesian, Russian, Swedish, Turkish, Urdu, Chinese — press `l` to cycle
- **Arabic Text Shaping** — Proper connected Arabic rendering via `arabic-reshaper`
- **Braille Image Mode** — Optional ayah calligraphy rendering from remote PNGs, cached in memory for the session
- **Verse Flow Modes** — Stacked, inline, or continuous flow — press `F` to cycle
- **Arabic Layout** — Configurable alignment (`A`) and width (`W`)
- **Immersive Reader** — Focus, Learn, Recite, and Memorise modes with adaptive layouts and optional spatial Mushaf-line illumination
- **Terminal Scrollback** — A split-footer reader commits completed ayat to normal, selectable terminal history
- **Lazy by Construction** — Optional translations, QUL packs, audio, Tilawa, and WebGPU load only after the command that needs them

### 🎨 Design
- **12 Dynasty Themes** — Mamluk, Ottoman, Safavid, Andalusian, Maghribi, Madinah, Umayyad, Abbasid, Fatimid, Seljuk, Mughal — each with unique ornaments, borders and color palettes inspired by Islamic manuscript illumination
- **Light & Dark Mode** — Auto-detection + manual toggle
- **Themed Progress Bars** — Custom ASCII progress indicators in title bars using dynasty-specific ornament characters
- **Focus Indicators** — Heavy borders + diamond icon on the focused pane

### 🔖 Study Tools
- **Bookmarks** — Mark and revisit favorite verses
- **Cues** — 9 quick-navigation slots (1–9) for instant jumping
- **Reflections** — Personal notes attached to any verse
- **Activity Panel** — Toggleable right panel listing all bookmarks, cues, and reflections
- **Full-Text Search** — Search across all translations with `/`
- **Command Palette** — Quick access to all commands with `Ctrl+P`
- **Attributed Resource Packs** — Install the public Alafasy streaming index or import verified QUL-compatible JSON/SQLite translations, tafsir, morphology, timing, and Mushaf layouts
- **Local Recitation Following** — Optional Tilawa recognition follows committed verse matches; tentative candidates never move the reader

### 📊 Progress Tracking
- **Reading Mode** — Toggle between browsing (no tracking) and reading (tracks every verse) with `m`
- **Surah Completion** — When navigating away from a surah in reading mode, prompted to mark it as complete
- **Reading Stats** — Sidebar widget showing verses read, unique verses, surahs touched, and surahs completed — filterable by Today, Week, Month, All Time, and Session
- **Streak Tracking** — Current streak, longest streak, and total reading days via CLI
- **Verse Logging** — Log individual verses or full surahs as read via CLI

### 💾 Persistence
- **SQLite Database** — All bookmarks, cues, reflections, reading logs, and preferences stored locally
- **Auto-Restore** — Selected surah, verse position, theme, language, layout, sidebar/panel visibility, and reading mode all persist across sessions

## Installation

```bash
# Run directly (no install)
bunx quran.sh

# Global install
bun install -g quran.sh

# Or with npm
npm install -g quran.sh
```

## Usage

### CLI Commands

```bash
# Launch interactive TUI
quran

# Read a surah (by number or name)
quran read 1
quran read al-fatihah

# Read a specific verse
quran read 2:255

# Search for verses
quran search "merciful"

# Log reading progress
quran log 1
quran log 2:255

# View reading streak
quran streak

# Launch the focused next-generation reading experience
quran immersive

# Keep completed ayat in native terminal scrollback
quran stream

# Start with every optional subsystem disabled
quran safe

# Inspect capabilities, packs, cache sizes, licenses, and privacy
quran doctor
quran doctor --gpu

# Install public starter audio or manage user-downloaded QUL-compatible packs
quran resources install starter-audio
quran resources list
quran resources import manifest.json resource.json

# Manage the optional local Tilawa model
quran models status
quran models install official --yes
```

### TUI Keyboard Shortcuts

The immersive reader uses `1`–`4` for Focus/Learn/Recite/Memorise, `w` for installed study data, `p` for attributed recitation playback, `v` for local follow-my-recitation, `g` for the OpenTUI Three arch-and-star backdrop (with a terminal-cell fallback), `M` for reduced motion, and `j`/`k` for verse navigation. Network, microphone, download, and GPU choices use keyboard-owned dialogs; `Esc` always cancels.

#### Navigation

| Key | Action |
|-----|--------|
| `Tab` | Cycle focus: Sidebar → Arabic → Translation → Transliteration → Panel |
| `Shift+Tab` | Cycle sidebar focus: Surah List ↔ Reading Stats |
| `↑/↓` or `j/k` | Navigate surahs or verses |
| `Enter` | Select surah (in sidebar) |
| `1-9` | Jump to cue slot |

#### Pane Toggles

| Key | Action |
|-----|--------|
| `a` | Toggle Arabic pane |
| `t` | Toggle Translation pane |
| `r` | Toggle Transliteration pane |
| `i` | Toggle online Braille image mode |
| `s` | Toggle sidebar |
| `B` | Toggle activity panel (Bookmarks / Cues / Reflections) |

#### Study

| Key | Action |
|-----|--------|
| `b` | Toggle bookmark on current verse |
| `R` | Add/edit reflection |
| `c` | Fetch and copy the current ayah PNG |
| `! to (` | Set cue 1–9 (Shift+1–9) |
| `/` | Search verses |
| `m` | Toggle Reading/Browsing mode |

#### Display

| Key | Action |
|-----|--------|
| `T` | Cycle dynasty theme |
| `D` | Cycle light/dark mode |
| `+`/`-` | Increase/decrease verse spacing |
| `A` | Cycle Arabic alignment |
| `W` | Cycle Arabic width |
| `F` | Cycle verse flow mode |
| `mouse wheel` / `+` / `-` | Zoom the focused Braille image |
| `mouse drag` / arrow keys / `0` | Pan or reset the focused Braille image |
| `C` | Clear bounded image caches |

#### General

| Key | Action |
|-----|--------|
| `Ctrl+P` | Open command palette |
| `?` | Show/hide help dialog |
| `ESC` | Dismiss dialog / Clear search |
| `q` | Quit |

## Data Source

- Translations from [quran-json](https://github.com/risan/quran-json)
- 114 surahs, 6,236 verses
- 10 languages: Bengali, English, Spanish, French, Indonesian, Russian, Swedish, Turkish, Urdu, Chinese

The bundled Quran text, translations, bookmarks, and reading history work offline. Image mode and image clipboard copying fetch ayah PNGs from `surahquran.com`; the app asks for confirmation before enabling image mode and keeps fetched images only in memory.

Optional packs and Tilawa assets are never downloaded at startup. The first press of `p` can install a checksum-pinned 607 KiB Alafasy verse index from Al Quran Cloud / Islamic Network after confirmation; audio remains remote and streams per ayah. QUL imports still come from files the user obtained with permission and retain dataset-specific attribution, while Tilawa microphone audio stays local and is not retained. See [Optional resources](docs/optional-resources.md) for sources, licensing, installation, removal, and privacy.

## Development

```bash
# Clone
git clone https://github.com/smashah/quran.sh.git
cd quran.sh

# Install dependencies
bun install

# Run TUI
bun run src/index.ts

# Run CLI
bun run src/index.ts read 1

# Run tests
bun test

# Type-check, test, and build both distributions
bun run check

# Verify lazy chunk boundaries and record startup/RSS budgets
bun run verify:lazy
bun run perf

# Build the npm/JavaScript entry
bun run build
# → outputs ./dist/index.js

# Build the standalone binary
bun run build:binary
# → outputs ./dist/quran
```

## Recording Demos

Demo recording scripts are in `demos/`. To record a TUI demo:

The v0.7 next-generation recording is reproducible with `vhs demos/next-generation.tape`. The v0.7.1 consent, playback-pack, WebGPU, and microphone flows use `vhs demos/v0.7.1-dialogs.tape`; each tape writes MP4 and GIF output under `demos/`.

```bash
# 1. Start a tmux session
tmux new-session -d -s demo -x 120 -y 35

# 2. Start terminalizer inside it
tmux send-keys -t demo 'terminalizer record --config demos/tui-demo.yml demos/tui-full -k' Enter

# 3. Run the keystroke automation (in another terminal)
bash demos/send-keys.sh

# 4. Render to GIF
terminalizer render demos/tui-full
```

## License

The quran.sh software is MIT licensed. Bundled Quran text and translations
come from [quran-json](https://github.com/risan/quran-json) and are licensed
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see
[NOTICE](NOTICE) for attribution.

## Credits

- Built with [Bun](https://bun.sh)
- UI powered by [OpenTUI](https://github.com/anomalyco/opentui)
- Optional spatial cells powered by the released [OpenTUI Three](https://github.com/anomalyco/opentui/tree/v0.4.5/packages/three)
- Optional local recitation recognition powered by [Tilawa](https://github.com/yazinsai/tilawa)
- Optional content-pack integration for [Quranic Universal Library](https://qul.tarteel.ai/resources)
- Arabic shaping via [arabic-reshaper](https://github.com/a-patel/arabic-reshaper)
- Data from [quran-json](https://github.com/risan/quran-json)

---

Made with ❤️ for the Muslim community
