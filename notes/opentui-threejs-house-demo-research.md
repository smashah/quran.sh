# OpenTUI `threejs-house-demo` research

Checked 2026-07-21 against the original X post and video, the branch at commit `698653c7`, the GitHub comparison, and the tagged OpenTUI `0.4.5` source.

## Verdict

The video does not show newly released Kitty, SIXEL, or iTerm2 image support. It shows released `@opentui/three` rendering a Three.js scene through WebGPU and converting the resulting pixels into true-colour terminal character cells, with unreleased demo code adding progressive GLTF loading, camera controls, tone mapping, and an audio-reactive logo. The result looks unusually close to pixels because it was recorded in a very dense terminal grid, but the branch still writes quadrant/block glyphs into OpenTUI's framebuffer. [Original X post and video](https://x.com/kmdrfx/status/2079355176234741793), [branch canvas](https://github.com/anomalyco/opentui/blob/698653c76facf74ccdaf4f438b4c1d3a9399c8dc/packages/three/src/canvas.ts), [quadrant supersampling shader](https://github.com/anomalyco/opentui/blob/698653c76facf74ccdaf4f438b4c1d3a9399c8dc/packages/three/src/shaders/supersampling.wgsl)

This does not change the earlier image-support conclusion: quran.sh should keep its Braille framebuffer renderer until an actual terminal-image API lands in a tagged OpenTUI release. Its monochrome Braille representation has 2x4 samples per cell, while this Three.js renderer's default colour path reduces a 2x2 pixel group to a quadrant glyph with foreground and background colours, so adding WebGPU and Three.js would increase weight without making Arabic calligraphy sharper.

## What the demo actually does

The first part of the 57.7-second video is an interactive fantasy scene assembled from three remote assets: Mobile Home, an animated Peachy Balloon airship, and The Forgotten Knight, plus an HDR environment and fog. The user orbits, pans, and zooms while an application-owned `ProgressiveGLTFManager` loads base GLBs and then selects mesh and texture levels of detail from each object's projected screen coverage. It supports DRACO, KTX2, Meshopt, and WebP resources, queues up to 50 requests, caches resources, cancels obsolete work, and reports base/progressive bytes and request activity in a status line. [Progressive GLTF demo source](https://github.com/anomalyco/opentui/blob/698653c76facf74ccdaf4f438b4c1d3a9399c8dc/packages/examples/src/gltf-progressive-lod-demo.ts)

The second part is a separate audio demo. It synthesizes kick, snare, and hi-hat grooves or loads a local WAV, MP3, or FLAC file; reads OpenTUI's audio tap; performs an FFT and adaptive kick/snare detection; then changes a text logo's scale, position, opacity, and colours at 60 FPS. The useful primitives are native audio playback, spectrum data, explicit live-render lifecycle, and responsive text animation—the bouncing, flashing treatment itself is not appropriate for a Quran reader. [Beat demo source](https://github.com/anomalyco/opentui/blob/698653c76facf74ccdaf4f438b4c1d3a9399c8dc/packages/examples/src/opentui-beat-demo.ts), [adaptive spectrum source](https://github.com/anomalyco/opentui/blob/698653c76facf74ccdaf4f438b4c1d3a9399c8dc/packages/examples/src/lib/adaptive-spectrum.ts)

## Released versus experimental

The branch is seven commits ahead and two commits behind `main`, changes nine files, and is not a tag or release. The comparison therefore documents an experiment, not a supported API surface. [GitHub comparison](https://github.com/anomalyco/opentui/compare/main...threejs-house-demo), [comparison API](https://api.github.com/repos/anomalyco/opentui/compare/main...threejs-house-demo), [branch tip](https://github.com/anomalyco/opentui/tree/698653c76facf74ccdaf4f438b4c1d3a9399c8dc)

Already released in `0.4.5`:

- `@opentui/three`, `ThreeRenderable`, Three.js textures and sprites, and WebGPU-to-character-cell supersampling are available now. They are suitable for colour graphics and 3D scenes, but they do not send a terminal image protocol. [released Three renderable](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/three/src/ThreeRenderable.ts), [released canvas](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/three/src/canvas.ts)
- OpenTUI's `Audio` engine and audio tap are released core APIs; the branch uses them to prove a richer interactive audio experience rather than introducing them as a new package. [released audio source](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/core/src/audio.ts)

Experimental on this branch:

- The progressive `NEEDLE_progressive` GLTF loader, its projected-size LOD policy, network queue, WebP decoder, asset composition, controls, and status UI are example code rather than reusable OpenTUI APIs.
- The beat visualizer, file picker, FFT analyzer, and adaptive kick/snare detector are branch-only examples.
- ACES tone mapping, exposure/output colour-space options, serialized GPU operations, and safer asynchronous renderer teardown are changes to `@opentui/three` on this unmerged branch. They should not be copied or depended on until they reach `main` and a release. [renderer branch source](https://github.com/anomalyco/opentui/blob/698653c76facf74ccdaf4f438b4c1d3a9399c8dc/packages/three/src/WGPURenderer.ts)

## Experience improvements worth borrowing

1. **Make ayah images zoomable and pannable.** The immediate improvement is to add `+`/`-` or wheel zoom and focused arrow/drag panning to the existing Braille image pane. Re-rasterizing the decoded monochrome bitmap at a chosen crop and scale preserves the current portable, high-density output while giving users the useful part of the 3D demo's interaction model.
2. **Make rasterization viewport-aware.** quran.sh already aborts stale fetches and caches both PNG bytes and decoded dark-pixel maps, so that work should be retained. The missing layer is a cache of final Braille grids keyed by verse, viewport, zoom, and crop, plus debounced resize rendering; that avoids recomputing every Braille cell during repeated resize events and lets the previous grid remain visible until the replacement is ready. [`ImageReader`](../src/tui/components/image-reader.tsx), [`fetchAyahImage`](../src/tui/utils/ayah-image.ts)
3. **Use audio for recitation state, not spectacle.** If recitation is added later, released OpenTUI audio can support play/pause, auto-advance, elapsed progress, and a restrained level or waveform row. Frame-driven animation should be requested only while audio is active and should honour a reduced-motion option; beat detection, pulsing scale, and rapid colour changes add distraction without helping reading.
4. **Expose useful work status.** The GLTF demo continuously reports loaded bytes, queued requests, and pause state. For quran.sh, a much smaller status treatment—fetching, decoding, ready, cached, or failed—would make image mode feel responsive without importing any Three.js code.

Tone mapping, HDR, 3D models, and `@opentui/three` are not useful additions for quran.sh's mostly monochrome verse images. They solve colour-scene rendering, while this product's problem is calligraphy legibility and low-latency navigation.

## Issue-ready recommendation

**Title:** Add zoom and pan to the Braille ayah image viewer

Keep the current PNG decode and Braille framebuffer path, then add viewer state for zoom and crop, `+`/`-` and mouse-wheel zoom, and pan controls while the image pane is focused. Cache the final rasterized Braille grid by `{surah, ayah, viewportWidth, viewportHeight, zoom, crop}`, debounce resize-driven rerasterization, retain the prior grid until the new one is ready, and clear viewer state when the verse changes. Do not add `@opentui/three` or depend on the `threejs-house-demo` branch; the acceptance criterion is sharper, controllable reading in every terminal quran.sh currently supports.
