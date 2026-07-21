# ADR 003: adopt a restrained, opt-in OpenTUI Three backdrop

Status: experimental (2026-07-21)

quran.sh will offer one optional geometric illumination scene built with the released `@opentui/three` 0.4.5 package. It is disabled by default, dynamically imported only after activation, and has no authority over Quran text, layout, keyboard input, or navigation. Unsupported WebGPU runtimes fall back to the normal reader.

The scene uses simple generated geometry, so it performs no network requests and holds no GLTF, texture, or HDR assets. Fifteen perspective line rails model a Mushaf page only when an imported, attributed QUL row supplies the active page and line; without verified layout data the rails stay hidden rather than inventing Quran layout semantics. A verse change adjusts the static arch palette and progressive ambient geometry visibility; there is no idle animation loop owned by quran.sh, and reduced motion fixes the scene orientation. Quran text stays in ordinary OpenTUI cells above the visual rather than becoming a blurry 3D texture.

This does not claim terminal image-protocol support. OpenTUI Three renders WebGPU pixels back into character cells. The existing Braille ayah image mode remains the portable calligraphy view until a released Kitty/SIXEL/iTerm image API exists.

We will remove or leave the experiment disabled if it misses the performance budgets, lowers Arabic contrast, leaks GPU resources, or requires branch-only APIs. The adapter owns every geometry, material, and renderable and disposes all of them when disabled or when the renderer shuts down.

The experimental gate is a 500 ms warning/2 s blocker for device activation, a 160 MiB warning/256 MiB blocker for incremental RSS, zero requested frames while an unchanged scene is idle, and exact disposal of the probe device, geometry, materials, renderer, frame callback, and WebGPU device. Hardware readings are reported separately from deterministic capability/disposal tests; the normal reader never fails because a CI host has no adapter.
