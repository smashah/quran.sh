# ADR 004: ship the Mushaf scene model, not unlicensed page assets

Status: accepted (2026-07-21)

QUL layout and script resources can provide useful page, line, and word coordinates, but the QUL CMS repository's MIT license does not grant redistribution rights for every hosted dataset. quran.sh therefore ships a normalized `MushafPageScene`, a lazy repository adapter, and a Three line-following visual, while requiring users to import a dataset whose own manifest records its source, license, attribution, compatibility, size, and checksum.

The page model groups canonical `WordKey` placements into RTL-sorted lines, preserves the active `VerseKey`, and marks active and completed lines. Focus mode shows ordinary Quran text, Memorise mode can conceal the next verse, and an optional OpenTUI Three scaffold makes page progression spatial without rasterizing Arabic into low-resolution 3D cells. Braille page or word images reuse the bounded image viewport only when a compatible `mushaf-image` pack is installed.

No print-perfect claim is made. Terminal fonts, shaping, BiDi behavior, and cell aspect ratios vary, so text remains the accessible source of truth. A `mushaf-layout` import is rejected unless its normalized index covers all 604 pages and 6,236 ayat with canonical coordinates; the Three line rails remain hidden without such a verified row. We would bundle a default layout only after the dataset owner explicitly permits redistribution, so v0.7 keeps the licensed dataset user-supplied and records its exact source and attribution.
