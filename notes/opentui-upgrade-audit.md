# OpenTUI upgrade audit

Checked 2026-07-21 against OpenTUI's official npm metadata, tagged source, releases, roadmap, and open pull requests.

## Implementation status

Implemented for quran.sh 0.6.0: OpenTUI is aligned at 0.4.5, obsolete native/Yoga and unused dependencies are removed, renderer lifecycle and child removal are migrated, strict types and tests pass, migrations are bundled, and both JavaScript and standalone builds are covered by CI. The Braille framebuffer remains the image path because upstream native Kitty/SIXEL rendering has not shipped.

## Verdict

Upgrade OpenTUI, but don't plan around native terminal images yet. The current stable release is `0.4.5` for both `@opentui/core` and `@opentui/react`; quran.sh resolved both packages to `0.1.79` before this upgrade. Stable `0.4.5` detects Kitty Graphics and SIXEL capabilities, but it has no `ImageRenderable`, React `<image>`, or pixel-image output path. Image rendering remains an open roadmap item with two unmerged experimental implementations. [Core 0.4.5 npm metadata](https://www.npmjs.com/package/@opentui/core/v/0.4.5), [React 0.4.5 npm metadata](https://www.npmjs.com/package/@opentui/react/v/0.4.5), [v0.4.5 release](https://github.com/anomalyco/opentui/releases/tag/v0.4.5), [image issue #92](https://github.com/anomalyco/opentui/issues/92), [roadmap #821](https://github.com/anomalyco/opentui/issues/821)

## Version and runtime delta

| Package/runtime | Before this upgrade | Current stable requirement | Consequence |
| --- | --- | --- | --- |
| `@opentui/core` | declared/resolved `0.1.79` | `0.4.5` | Upgrade core and its native binary packages together. |
| `@opentui/react` | declared `^0.1.77`, resolved `0.1.79` | `0.4.5` | Keep it on exactly the same release as core. |
| React | declared `^19.0.0`, resolved `19.2.4` | `>=19.2.0` | The lockfile already satisfies the new peer floor. |
| Bun | local audit runtime `1.3.14` | `>=1.3.0` | The current development runtime is compatible. |

The React floor was deliberately raised from 19.0 to 19.2 when OpenTUI moved to `react-reconciler` 0.33, and upstream labels this consumer-facing change as breaking. [PR #1012](https://github.com/anomalyco/opentui/pull/1012) The core package declares Bun `>=1.3.0`; Bun remains the primary runtime, while Node.js 26 is a validated secondary target that requires `--experimental-ffi`. [core package at v0.4.5](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/core/package.json), [Node runtime PR #1149](https://github.com/anomalyco/opentui/pull/1149)

OpenTUI moved Yoga into the native core in `0.4.1`, and `@opentui/core@0.4.5` no longer depends on `yoga-layout`. quran.sh does not import `yoga-layout` directly, so its dependency, build external, and override can be removed rather than upgraded. [v0.4.1 release](https://github.com/anomalyco/opentui/releases/tag/v0.4.1), [native Yoga PR #1126](https://github.com/anomalyco/opentui/pull/1126), [core 0.4.5 package dependencies](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/core/package.json)

## Image rendering status

**Stable API:** there is no native image component. The official built-in renderable list includes `FrameBufferRenderable` but no image renderable, and the React intrinsic-component documentation likewise exposes no `<image>`. `FrameBufferRenderable` is a character-cell buffer: its operations draw characters, foregrounds, and backgrounds, so it can produce Braille/block approximations but cannot emit a terminal image protocol. [renderables reference](https://opentui.com/docs/core-concepts/renderables/), [FrameBuffer reference](https://opentui.com/docs/components/frame-buffer/), [React component reference](https://opentui.com/docs/bindings/react/)

**Capability detection:** stable core exposes `TerminalCapabilities.kitty_graphics` and `.sixel`, and `OPENTUI_GRAPHICS` controls the Kitty query. These fields report terminal capabilities; there is no corresponding stable image output component or iTerm2 image capability. [capability type](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/core/src/types.ts), [capability detector](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/core/src/lib/terminal-capability-detection.ts), [environment variables](https://opentui.com/docs/reference/env-vars/)

**Experimental proposals:** PR #386 proposes an `Image` renderable exposed to React, `contain`/`cover`/`fill` fitting, and Kitty plus iTerm2 escape output. PR #633 instead proposes `ImageRenderable` and a lower-level `renderPixels` API, accepts RGBA `Uint8Array` data, and currently emits Kitty format only; its author also notes that images overlay text because terminal image planes do not participate in normal cell z-ordering. Both PRs remain open and unmerged, while the roadmap still lists Kitty Graphics and SIXEL as work to do. These names and behaviours are not stable APIs. [PR #386](https://github.com/anomalyco/opentui/pull/386), [PR #633](https://github.com/anomalyco/opentui/pull/633), [roadmap #821](https://github.com/anomalyco/opentui/issues/821)

For quran.sh, the existing [`ImageReader`](../src/tui/components/image-reader.tsx) remains the portable approach: it decodes PNG, thresholds pixels, and writes Braille glyphs into a `FrameBufferRenderable`. Native Kitty/SIXEL/iTerm2 output would currently require application-owned protocol code or an unmerged fork, neither of which is a good dependency for the main reader.

## Migration work for this repository

1. **Align the release family.** Set core and React to the same exact `0.4.5` release, refresh `bun.lock`, and keep React at 19.2 or later. Exact alignment is prudent because OpenTUI's roadmap describes `0.1` through `0.5` as exploration, and each React package release depends on its matching core version. [roadmap #821](https://github.com/anomalyco/opentui/issues/821), [React 0.4.5 package](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/react/package.json)

2. **Remove the old native-package bookkeeping.** Delete the direct `yoga-layout` dependency/override/build external and preferably let `@opentui/core` own its optional native packages. Stable core declares Darwin, Linux glibc, Linux musl, and Windows packages for x64/arm64 itself, whereas quran.sh's manual list omits the newer musl targets. [core 0.4.5 platform packages](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/core/package.json)

3. **Fix the known source break.** OpenTUI `0.4.3` changed `remove(id: string)` to `remove(child: BaseRenderable)` and now throws if passed a string. [`image-reader.tsx`](../src/tui/components/image-reader.tsx#L193) currently calls `boxRef.current.remove(canvas.id)`; it must pass `canvas`. [breaking-change PR #1224](https://github.com/anomalyco/opentui/pull/1224), [v0.4.3 release](https://github.com/anomalyco/opentui/releases/tag/v0.4.3)

4. **Keep the existing renderer bootstrap.** `createCliRenderer()` plus `createRoot(renderer).render(...)` is still the documented React entry path, so quran.sh's startup shape does not need redesign. The older top-level `render(...)` helper is deprecated upstream, but this project does not use it. [React 0.4.5 README](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/react/README.md)

5. **Re-test both distribution modes.** OpenTUI documents that Bun standalone compilation embeds the native package only when the import is statically analyzable. Linux defaults to glibc; a musl target must define `process.env.OPENTUI_LIBC` at build time, and minimal Alpine images need `libstdc++` and `libgcc`. Exercise the normal external-package build and `bun build --compile` for every advertised target after upgrading. [standalone executable guide](https://opentui.com/docs/reference/standalone-executables/)

## Recommendation

Take the `0.4.5` upgrade now for the accumulated renderer, input, native Yoga, platform, and runtime fixes, but retain the Braille framebuffer image mode. Revisit native images only after issue #92 closes and an image API ships in a tagged release; capability detection alone is not image rendering.
