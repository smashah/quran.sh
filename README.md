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
- **Verse Flow** — Verse-by-verse or one continuous block of Arabic — press `F` to switch
- **Arabic Layout** — Configurable alignment (`A`) and width (`W`)
- **Immersive Reader** — Focus, Learn, Recite, and Memorise views (Recite shows the next ayah as a cue, Memorise hides it until you press Space) with adaptive layouts and optional spatial Mushaf-line illumination
- **Terminal Scrollback** — A split-footer reader commits completed ayat to normal, selectable terminal history
- **Lazy by Construction** — Optional translations, QUL packs, audio, Tilawa, and WebGPU load only after the command that needs them

### 🎨 Design
- **11 Dynasty Themes** — Mamluk, Ottoman, Safavid, Andalusian, Maghribi, Madinah, Umayyad, Abbasid, Fatimid, Seljuk, Mughal — each with unique ornaments, borders and color palettes inspired by Islamic manuscript illumination
- **Light & Dark Mode** — Auto-detection + manual toggle
- **Themed Progress Bars** — Custom ASCII progress indicators in title bars using dynasty-specific ornament characters
- **Focus Indicators** — Heavy borders + diamond icon on the focused pane

### 🔖 Study Tools
- **Bookmarks** — Mark and revisit favorite verses
- **Cues** — 9 quick-navigation slots (1–9) for instant jumping
- **Reflections** — Personal notes attached to any verse
- **Activity Panel** — Toggleable right panel listing all bookmarks, cues, and reflections
- **Full-Text Search** — Search across all translations with `/`, then pick a result with `↑/↓` and open it with `Enter`
- **Go to** — Press `:` and type `2:255`, `kahf 10`, `yasin` or `the cow`
- **Command Palette** — Every action with `Ctrl+P`; type to filter it
- **Attributed Resource Packs** — Install the public Alafasy streaming index or import verified QUL-compatible JSON/SQLite translations, tafsir, morphology, timing, and Mushaf layouts
- **Synchronized Word Following** — Press `p` in the default or immersive reader to lazily play matching Alafasy audio, follow verified word timing, preload one ayah, and continue through surah boundaries
- **Related Hadith** — Press `h` for explicitly linked Bukhari/Muslim narrations; the official Quran Foundation API is used with user-supplied credentials, and Quran.com's canonical page is the zero-setup path
- **Local Recitation Following** — Optional Tilawa recognition follows committed verse matches; tentative candidates never move the reader

### 📊 Progress Tracking
- **Track Reading** — Press `m` in any reader to turn reading history on or off; the status bar always shows `Tracking: ON/OFF`. While it is on, every verse you move to is logged, however you got there (keys, search, cues, go-to or recitation)
- **Surah Completion** — While tracking, leaving a surah asks whether to mark it as fully read and shows how many of its verses you have read
- **Reading Stats** — Sidebar widget showing verses read, unique verses, surahs touched, and surahs completed — filterable by Today, Week, Month, All Time, and Session
- **Streak Tracking** — Current streak, longest streak, and total reading days via CLI
- **Verse Logging** — Log individual verses or full surahs as read via CLI

### 💾 Persistence
- **SQLite Database** — All bookmarks, cues, reflections, reading logs, and preferences stored locally
- **Auto-Restore** — Selected surah, verse position, theme, language, layout, sidebar/panel visibility, and the Track reading setting all persist across sessions, and every reader resumes where the last one left off

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
# Launch the dashboard reader
quran

# Read a surah (by number or name; spelling is forgiving)
quran read 1
quran read al-fatihah
quran read fatiha

# Read a specific verse, with Arabic, numbers, or another language
quran read 2:255
quran read 2:255 --arabic
quran read yasin --numbers --lang ur

# Search for verses
quran search "merciful"

# Log reading progress
quran log 1
quran log 2:255

# View reading streak
quran streak

# One ayah at a time, optionally starting somewhere specific
quran immersive
quran immersive 2:255

# Keep completed ayat in native terminal scrollback
quran stream
quran stream kahf 1

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

### Enable synchronized word following

Synchronized Arabic word highlighting needs no API credentials. Start the default reader or the immersive reader, accept the online-source disclosure, and press `p`:

```bash
bun run src/index.ts
# or
bun run src/index.ts immersive
```

The reader gets Mishari al-Afasy's per-ayah MP3 and matching timing segments from Quran.com's public `api.quran.com/api/v4` endpoints, then preloads only the next ayah. Successful synchronization displays `FOLLOWING WORD n/N`. `FOLLOWING AYAH` means public timing was unavailable or invalid and playback safely fell back to an installed ayah-level source; only then can the reader offer the small fallback recitation index.

Quran Foundation credentials remain optional for the in-reader tafsir catalogue and related-hadith panel. Copy `.env.example` to `.env` and fill them in only if you want those credentialed features; `.env` is ignored by Git and must never be committed.

### Choosing a reader

| Reader | Start it with | Best for |
|--------|---------------|----------|
| Dashboard | `quran` | Browsing with the surah list, bookmarks, cues, reflections and reading stats side by side |
| Immersive | `quran immersive [ref]` | One ayah at a time with tafsir, related hadith, recitation, image and 3D views |
| Stream | `quran stream [ref]` | A minimal footer reader that leaves finished ayat in your normal terminal scrollback |
| Safe | `quran safe` | The dashboard with every optional online or heavy feature turned off |

All of them share your reading position, bookmarks, reading history and the `Track reading` setting, and the same keys do the same thing in each: `j`/`k` move, `:` goes to a verse, `/` searches, `b` bookmarks, `m` turns tracking on or off, `w`/`W` open tafsir, `p` plays recitation, `l` changes the translation language, `?` shows help and `q` quits. Only a few keys belong to one reader and are listed in its own help: in the dashboard `1`–`9` jump to cues, and in the immersive reader `1`–`4` switch views, `h` opens related hadith and `r`/`f` change the 3D layout and script.

The immersive reader asks once before using online Quran sources. `OK` allows them for the session, `Don't show again` remembers the choice, and `Continue offline` (or `Esc`) keeps reading the bundled text; online features such as `w`, `h`, `i`, `g` and `p` then ask before they connect. Persistent downloads and microphone access keep their own confirmations because they authorize a different capability.

### Dashboard keys

Press `?` for this list inside the app, or `Ctrl+P` to search every action by name.

#### Move around

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Next / previous area: Surahs → Reading stats → Reader → Activity |
| `↑/↓` or `j/k` | Move through surahs, verses, search results or list items |
| `Enter` | Open the selected surah, search result or Activity item |
| `:` | Go to a verse or surah (`2:255`, `18`, `kahf 10`, `yasin`) |
| `1-9` | Jump to a saved cue |
| `s` / `B` | Show or hide the surah sidebar / Activity panel (Bookmarks, Cues, Reflections) |

Study keys such as `b`, `m`, `c`, `R` and the cue keys work from any area, so you don't have to move focus into the reader first. The status bar shows which area has focus.

#### Search

| Key | Action |
|-----|--------|
| `/` | Search verses; choose a result with `↑/↓` and open it with `Enter`. In the sidebar, `/` filters the surah list |
| `Ctrl+F` | Fuzzy search Arabic, translation and transliteration |
| `ESC` | Close a dialog or clear search results |

#### Study and history

| Key | Action |
|-----|--------|
| `b` | Bookmark the current verse |
| `! to (` | Save the current verse as cue 1–9 (Shift+1–9) |
| `R` | Add or edit a reflection |
| `m` | Track reading on/off (shown in the status bar) |
| `X` | Delete reading history for a period (asks first) |
| `w` / `W` | Open attributed tafsir for the current ayah / choose a saved English tafsir |
| `p` | Start/stop synchronized recitation |
| `c` | Fetch and copy the current ayah PNG |

#### Panes and display

| Key | Action |
|-----|--------|
| `a` / `t` / `r` | Show or hide the Arabic / Translation / Transliteration pane |
| `i` | Show or hide the online Braille ayah image in the Arabic pane |
| `l` | Next translation language |
| `+` / `-` | More / less space between Arabic words; zooms the image when it is shown and focused |
| `A` / `G` / `F` | Arabic alignment / width / verse-by-verse or continuous flow |
| `T` / `D` | Next dynasty theme / auto, dark or light colours |
| `mouse drag` / arrow keys / `0` | Pan or reset the focused Braille image |
| `C` | Clear bounded image caches (image view) |

To focus a single reader pane, click it or run **Next Reader Pane** from the command palette. **Re-index Search** and **Re-calibrate Arabic** are also in the palette.

#### General

| Key | Action |
|-----|--------|
| `Ctrl+P` | Command palette (type to filter) |
| `?` | Show/hide help |
| `q` | Quit |

### Immersive reader keys

| Key | Action |
|-----|--------|
| `j/k` or `↑/↓` | Previous / next ayah, continuing across surahs |
| `:` / `/` | Go to a verse or surah / search the Quran |
| `1`–`4` | Focus (Arabic and translation), Learn (adds transliteration), Recite (Arabic with the next ayah as a cue), Memorise (the next ayah stays hidden) |
| `Space` | In Memorise, reveal or hide the next ayah |
| `b` / `m` | Bookmark / track reading on or off |
| `w` / `W` / `h` | Online study and tafsir / choose a tafsir / related hadith; `[` and `]` scroll them and `n` loads more hadith |
| `p` / `v` | Follow-play recitation / follow my recitation with the local Tilawa model |
| `i` / `g` | Online ayah image / OpenTUI Three vector Arabic reader; in the 3D reader `r` switches ayah/page layout and `f` cycles Uthmani, IndoPak and verified QCF Tajweed |
| `l` / `M` | Next translation language / reduced motion |
| `?` / `q` | Help / quit |

Follow-play stops the old stream immediately, waits 180 ms for rapid manual navigation to settle before requesting the selected ayah, preloads only its immediate successor, and advances without that delay when an ayah finishes. Accepted sessions try synchronized word following from Quran.com's keyless public API first, then an optional credentialed Quran Foundation fallback, and finally an installed ayah-level source.

### Stream reader keys

`j/k` move (across surahs in both directions), `b` bookmarks, `m` turns reading tracking on or off, and `q` quits. Finished ayat stay in your terminal scrollback.

## Data Source

- Translations from [quran-json](https://github.com/risan/quran-json)
- 114 surahs, 6,236 verses
- 10 languages: Bengali, English, Spanish, French, Indonesian, Russian, Swedish, Turkish, Urdu, Chinese

The bundled Quran text, translations, bookmarks, and reading history work offline. Immersive mode discloses its online sources once before any request; image mode and image clipboard copying outside that flow retain their own confirmation. Ayah PNGs come from the documented Al Quran Cloud / Islamic Network CDN, redirects and non-PNG bodies are rejected, and fetched images stay in memory only.

Optional packs and Tilawa assets are never downloaded at startup. Pressing `p` first requests matching Alafasy ayah audio and word segments from Quran.com's keyless public API; the request and immediate-successor preload are bounded and abort when navigation supersedes them. If that source is unavailable, a confirmation can install the checksum-pinned 607 KiB Al Quran Cloud / Islamic Network fallback index, whose audio remains remote and streams per ayah. Optional `QF_CLIENT_ID` and `QF_CLIENT_SECRET` values provide a credentialed timing fallback and enable Quran Foundation's richer tafsir and hadith APIs. `w` lazily requests the saved tafsir and `W` changes that selection; missing credentials or failure automatically preserves attributed Tafsir al-Muyassar through the open Al Quran Cloud API. User-obtained QUL imports remain available as explicit local resource management rather than an automatic fallback chain. Tilawa microphone audio stays local and is not retained. See [Optional resources](docs/optional-resources.md) for sources, licensing, installation, removal, and privacy.

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

# Open the responsive single-ayah WebGL studies
bun run poc:web

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

The local browser gallery explores illuminated-arch, Mushaf-plane, recitation-focus, and Haram-live treatments for Al-Fatihah 1:5. Three.js and its scene assets load only after the gallery button is pressed; the official privacy-enhanced YouTube player has a separate connection button and remains an ordinary, unmodified embed. These are browser design studies for future OpenTUI Three work, while the shipped terminal renderer continues to use OpenTUI's WebGPU surface.

## Recording Demos

Demo recording scripts are in `demos/`. To record a TUI demo:

The v0.8.1 release video records the real OpenTUI app in a PTY. Provider responses and its playback clock are deterministic fixtures, so the capture exercises the real layout and interaction states without using or embedding live Quran Foundation credentials. The earlier v0.7 next-generation recording is reproducible with `vhs demos/next-generation.tape`, while the v0.7.1 consent and recovery flows use `vhs demos/v0.7.1-dialogs.tape`; each VHS tape writes MP4 and GIF output under `demos/`.

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
- Optional spatial cells powered by the released [OpenTUI Three](https://github.com/anomalyco/opentui/tree/v0.6.6/packages/three)
- Optional local recitation recognition powered by [Tilawa](https://github.com/yazinsai/tilawa)
- Optional content-pack integration for [Quranic Universal Library](https://qul.tarteel.ai/resources)
- Optional online tafsir and ayah images from [Al Quran Cloud / Islamic Network](https://alquran.cloud/api)
- Arabic shaping via [arabic-reshaper](https://github.com/a-patel/arabic-reshaper)
- Data from [quran-json](https://github.com/risan/quran-json)

---

Made with ❤️ for the Muslim community
