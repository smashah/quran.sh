# libsixel and ytsurf research

Checked 2026-07-22 against the projects' source, releases, security advisories, and the current quran.sh/OpenTUI integration.

## Verdict

`libsixel` is a viable optional image backend for terminals that advertise SIXEL support, but it should not become quran.sh's default or a required native dependency. OpenTUI 0.4.5 already detects `sixel` and `kitty_graphics`, but it does not expose an image renderable, placement lifecycle, or SIXEL encoder. quran.sh would still need to own image sizing, output synchronization, cancellation, and fallback behavior.

`ytsurf` does not render YouTube video inside a terminal. It is a Bash search/menu application that renders thumbnails through Chafa and launches the selected video in mpv, IINA, or Syncplay. Its useful lesson is the external-tool pipeline—yt-dlp for resolving media and Chafa for terminal-aware images—not reusable playback or rendering code.

For quran.sh's proposed Haram view, the practical experiment is a lazy, bounded pipeline:

```text
known YouTube URL
  -> yt-dlp resolves a low-resolution live rendition
  -> ffmpeg decodes, scales, and emits 1 frame/second
  -> latest-frame-only buffer
  -> Kitty image, SIXEL, or current Braille renderer
```

Kitty should be preferred where available because it has explicit image IDs, placements, updates, deletion, z-order, and animation semantics. SIXEL is a useful second backend. The existing Braille renderer remains the portable default and recovery path.

## libsixel

### What it provides

libsixel is a C encoder and decoder for DEC SIXEL. It ships `img2sixel`, which can read common image formats, resize/crop them, quantize a palette, dither, and write the resulting terminal escape stream to stdout; its C API can instead encode raw bitmap data through an application-provided output callback. [Original project](https://github.com/saitoha/libsixel), [command-line documentation](https://github.com/saitoha/libsixel/blob/master/md/Command%20line%20tools.md), [C API](https://github.com/saitoha/libsixel/blob/master/md/C%20API.md), [DEC SIXEL description](https://manx-docs.org/mirror/vt100.net/docs/vt3xx-gp/chapter14.html)

The maintenance story needs care. The community continuation at `libsixel/libsixel` released 1.10.5 in January 2025 and was archived in February 2025. The original `saitoha/libsixel` repository is active again and released `v1.8.7-r2` on May 3, 2026 with fixes for encoder/parser out-of-bounds vulnerabilities and an allocation-failure crash. Homebrew currently packages 1.10.5 from the archived fork, so a version number alone does not identify the security lineage. Any packaged integration would have to pin an exact repository commit and verify that the three 2026 fixes are present. [Archived continuation](https://github.com/libsixel/libsixel), [v1.8.7-r2](https://github.com/saitoha/libsixel/releases/tag/v1.8.7-r2), [Homebrew formula](https://formulae.brew.sh/formula/libsixel), [encoder advisory](https://github.com/saitoha/libsixel/security/advisories/GHSA-hx93-w8p2-ffh5), [parser advisory](https://github.com/saitoha/libsixel/security/advisories/GHSA-9jm7-77gr-qghv), [allocation advisory](https://github.com/saitoha/libsixel/security/advisories/GHSA-wpx3-h5g8-qr3w)

### Terminal constraints

SIXEL is emitted at the cursor as a Device Control String, so scrolling, cursor movement, redraw, and erasure behavior are terminal-dependent. A long-running React/OpenTUI redraw can overwrite the same cells or move the cursor while a raw SIXEL subprocess writes. Multiplexers add another compatibility layer. Even WezTerm describes its SIXEL support as preliminary and incomplete, despite being a supported terminal in libsixel's compatibility list. [Supported terminals](https://github.com/saitoha/libsixel/blob/master/md/Supported%20terminals.md), [WezTerm escape-sequence support](https://wezterm.org/escape-sequences.html), [xterm SIXEL scrolling behavior](https://invisible-island.net/xterm/manpage/xterm.html)

By comparison, Kitty's protocol has application-controlled image and placement IDs, quiet updates, delete actions, z-index, cursor policies, and shared-memory/file transports. Those controls map more naturally onto a retained TUI tree and resize lifecycle. [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/)

### Fit with quran.sh

The installed OpenTUI types expose `renderer.capabilities?.sixel` and `renderer.capabilities?.kitty_graphics`, so quran.sh can make a real capability decision rather than guessing from `$TERM`. They do not expose a SIXEL/Kitty renderable or encoder. The current image reader already has the right upstream behavior: bounded fetches, decoded-image caching, cancellation, viewport-aware zoom/pan, and a Braille grid. A protocol backend should consume that same prepared image rather than create a parallel network path.

The first SIXEL proof of concept should invoke an installed `img2sixel` process, write validated PNG bytes to stdin, and capture its escape stream. It should run only inside a dedicated image pane while OpenTUI output is suspended or otherwise serialized, then restore/redraw the TUI after the image is replaced or removed. Navigation, resize, and pane close must abort the encode and discard stale output. This is deliberately a process boundary: directly binding the C API through Bun FFI would add platform-specific shared-library discovery, ABI ownership, and untrusted-image security work before the user value is proven.

Chafa is also worth testing as an optional process backend because it auto-selects `iterm`, `kitty`, `sixels`, or `symbols`, accepts explicit terminal dimensions, supports animation speed, and has protocol-passthrough controls. It does not remove the need to coordinate raw terminal output with OpenTUI. [Chafa manual](https://hpjansson.org/chafa/man/)

## ytsurf

### What it actually does

ytsurf 3.1.8 is an actively maintained GPL-3.0 Bash application. Search scrapes YouTube's page data and calls an undocumented `youtubei` endpoint with hard-coded client metadata; result previews download a JPEG and call `chafa --size=...`; playback builds an mpv/IINA/Syncplay command and blocks until that external player exits. There is no embeddable TypeScript API and no in-terminal video decoder. [Repository](https://github.com/Stan-breaks/ytsurf), [v3.1.8 release](https://github.com/Stan-breaks/ytsurf/releases/tag/v3.1.8), [search implementation](https://github.com/Stan-breaks/ytsurf/blob/86cae034fa065c83433a59eefcbab660c26fefe2/ytsurf.sh#L1369-L1466), [thumbnail preview](https://github.com/Stan-breaks/ytsurf/blob/86cae034fa065c83433a59eefcbab660c26fefe2/ytsurf.sh#L1468-L1517), [player path](https://github.com/Stan-breaks/ytsurf/blob/86cae034fa065c83433a59eefcbab660c26fefe2/ytsurf.sh#L1161-L1222)

Its dependency surface is Bash, curl, jq, Perl, yt-dlp, mpv, ffmpeg, a selector such as fzf, Chafa, and now socat. The release packaging is already drifting: the repository's Homebrew formula has been reported with a version/checksum mismatch, and macOS paths rely on GNU-specific utilities without declaring GNU coreutils. This is another reason not to make ytsurf an application dependency. [README dependencies](https://github.com/Stan-breaks/ytsurf/blob/86cae034fa065c83433a59eefcbab660c26fefe2/README.md#L101-L110), [runtime checks](https://github.com/Stan-breaks/ytsurf/blob/86cae034fa065c83433a59eefcbab660c26fefe2/ytsurf.sh#L452-L482), [formula issue](https://github.com/Stan-breaks/ytsurf/issues/57)

The source is still useful as a reference for composing mature command-line tools, but its implementation patterns should not be copied. It constructs player commands and executes them with `eval`, sources executable user configuration, performs no application-level debounce for thumbnail previews, and leaves search-cache entries without a global eviction policy. quran.sh already has stronger cancellation and bounded-cache conventions.

Because ytsurf is GPL-3.0, copying its Bash implementation into quran.sh would also create licensing obligations for the combined distribution. Independently spawning user-installed yt-dlp, ffmpeg, Chafa, or libsixel executables keeps the implementation separate, but packaged binaries and notices would still need a dependency-by-dependency license review. [ytsurf license](https://github.com/Stan-breaks/ytsurf/blob/86cae034fa065c83433a59eefcbab660c26fefe2/LICENSE)

## A bounded Haram livestream proof of concept

The supplied live stream was publicly resolvable on July 22, 2026 and exposed a combined-audio 144p rendition at 15 fps, among higher resolutions. That observation proves feasibility for a prototype, not a stable contract: the video ID, availability, format set, and signed media URLs can all change.

The implementation should stay small and independent from ytsurf:

1. **Load only on demand.** Do not probe, resolve, or spawn any media process until the user opens the livestream view and accepts a one-time source/dependency disclosure. Closing the view must terminate the whole process group and release frame buffers.
2. **Resolve a rendition, not a format ID.** Spawn yt-dlp without a shell and select by properties such as `height<=144`, because yt-dlp explicitly treats format codes as extractor-specific. `--get-url`/`--print urls` can return the temporary media URL. [yt-dlp format selection](https://github.com/yt-dlp/yt-dlp#format-selection), [yt-dlp options](https://github.com/yt-dlp/yt-dlp#usage-and-options)
3. **Decode and scale before buffering.** Spawn ffmpeg directly with an `fps=1` and viewport-bounded scale filter, then emit individual PNG frames or fixed-size RGB data. FFmpeg's `fps` filter drops or duplicates frames to a requested constant output rate. [FFmpeg fps filter](https://ffmpeg.org/ffmpeg-filters.html#fps)
4. **Use latest-frame-wins backpressure.** Keep the displayed frame and at most one pending replacement. If decoding finishes another frame while rendering is busy, replace the pending frame rather than queueing it. At 256×144, two raw RGBA frames occupy about 288 KiB; ffmpeg and HLS buffering will remain the larger costs.
5. **Choose the backend by capability.** Prefer Kitty, try SIXEL when detected and explicitly enabled, and retain Braille as the reliable fallback. Any raw-protocol backend must own its pane lifecycle and force a clean OpenTUI redraw when it stops.
6. **Keep audio independent.** A one-frame-per-second visual can coexist with smooth external audio, but livestream audio must be opt-in and use the same single-owner policy as recitation so two sources never overlap. “Open in browser” and “continue without visuals” must remain available after resolver, decoder, or terminal-capability failures.

At 1 fps, terminal conversion and output are cheap enough to test, but ffmpeg still receives and decodes the source stream. Selecting the smallest usable source rendition therefore matters more for CPU and bandwidth than merely dropping output frames after decoding.

## Recommendation

Do not add libsixel or ytsurf as dependencies. Add a small `TerminalImageBackend` boundary around the existing prepared-image data, then prototype Kitty and SIXEL behind explicit capability checks and a feature flag. Separately prototype the known Haram URL with lazy yt-dlp/ffmpeg subprocesses, a two-frame maximum, and no audio by default. If raw image protocols cannot coexist cleanly with OpenTUI's renderer, Chafa or libsixel should remain an external-view escape hatch rather than destabilizing Quran reading.
