import type { Font, FontCollection, Glyph, Path } from "fontkit";
import type * as ThreeNamespace from "three";
import { readBoundedResponse } from "../network/bounded-response.ts";
import type { QuranReadingSurface, QuranScriptStyle } from "./types.ts";

const FONT_ORIGIN = "https://quran.com";
const FONT_LIMIT_BYTES = 512 * 1024;
const FONT_CACHE_SIZE = 2;
const FONT_TIMEOUT_MS = 10_000;
const MAX_LINE_GLYPHS = 220;
const MAX_SURFACE_GLYPHS = 1_200;
const MAX_RESPONSIVE_AYAH_LINES = 6;

const FONT_URLS = {
  uthmani: `${FONT_ORIGIN}/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.woff2`,
  indopak: `${FONT_ORIGIN}/fonts/quran/hafs/nastaleeq/indopak/indopak-nastaleeq-waqf-lazim-v4.2.1.woff2`,
} as const;

type ThreeModule = typeof ThreeNamespace;
type LoadedFont = Font & {
  readonly _glyphs?: Record<number, Glyph>;
  _getBaseGlyph?(id: number): Glyph | null | undefined;
  readonly COLR?: {
    readonly baseGlyphRecord: readonly { readonly gid: number; readonly firstLayerIndex: number; readonly numLayers: number }[];
    readonly layerRecords: readonly { readonly gid: number; readonly paletteIndex: number }[];
  };
};

interface FontCacheEntry {
  readonly controller: AbortController;
  readonly promise: Promise<LoadedFont>;
}

const fontCache = new Map<string, FontCacheEntry>();

export interface ResponsiveAyahLineRange {
  readonly start: number;
  readonly end: number;
  readonly width: number;
}

function lineWidth(prefix: readonly number[], spaceWidth: number, start: number, end: number): number {
  return (prefix[end]! - prefix[start]!) + Math.max(0, end - start - 1) * spaceWidth;
}

function balancedRanges(wordWidths: readonly number[], spaceWidth: number, lineCount: number): readonly ResponsiveAyahLineRange[] {
  const count = wordWidths.length;
  const prefix = [0];
  for (const width of wordWidths) prefix.push(prefix.at(-1)! + width);
  const target = (prefix.at(-1)! + Math.max(0, count - lineCount) * spaceWidth) / lineCount;
  const costs = Array.from({ length: lineCount + 1 }, () => Array<number>(count + 1).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: lineCount + 1 }, () => Array<number>(count + 1).fill(-1));
  costs[0]![0] = 0;
  for (let lines = 1; lines <= lineCount; lines++) {
    for (let end = lines; end <= count - (lineCount - lines); end++) {
      for (let start = lines - 1; start < end; start++) {
        if (!Number.isFinite(costs[lines - 1]![start]!)) continue;
        const width = lineWidth(prefix, spaceWidth, start, end);
        const orphanPenalty = end - start === 1 && count > lineCount * 2 ? target * target : 0;
        const raggedLastLinePenalty = lines === lineCount && width < target * 0.55
          ? (target - width) * (target - width) * 2
          : 0;
        const cost = costs[lines - 1]![start]! + (width - target) * (width - target) + orphanPenalty + raggedLastLinePenalty;
        if (cost < costs[lines]![end]!) {
          costs[lines]![end] = cost;
          previous[lines]![end] = start;
        }
      }
    }
  }
  const ranges: ResponsiveAyahLineRange[] = [];
  let end = count;
  for (let lines = lineCount; lines > 0; lines--) {
    const start = previous[lines]![end]!;
    if (start < 0) return [{ start: 0, end: count, width: lineWidth(prefix, spaceWidth, 0, count) }];
    ranges.unshift({ start, end, width: lineWidth(prefix, spaceWidth, start, end) });
    end = start;
  }
  return ranges;
}

export function responsiveAyahLineRanges(
  wordWidths: readonly number[],
  spaceWidth: number,
  lineHeight: number,
  viewportAspect: number,
): readonly ResponsiveAyahLineRange[] {
  if (wordWidths.length === 0) return [];
  if (wordWidths.some((width) => !Number.isFinite(width) || width <= 0)
    || !Number.isFinite(spaceWidth) || spaceWidth < 0
    || !Number.isFinite(lineHeight) || lineHeight <= 0) {
    throw new Error("Cannot wrap an ayah with invalid font measurements");
  }
  const aspect = Math.max(0.35, Math.min(8, viewportAspect));
  const maximumLines = Math.min(MAX_RESPONSIVE_AYAH_LINES, Math.max(1, Math.ceil(wordWidths.length / 4)));
  let best = balancedRanges(wordWidths, spaceWidth, 1);
  let bestScore = 0;
  for (let lineCount = 1; lineCount <= maximumLines; lineCount++) {
    const ranges = balancedRanges(wordWidths, spaceWidth, lineCount);
    const maximumWidth = Math.max(...ranges.map((range) => range.width));
    const totalHeight = lineHeight * (lineCount + Math.max(0, lineCount - 1) * 0.28);
    const fit = Math.min(aspect / maximumWidth, 1 / totalHeight);
    const score = lineHeight * fit * (1 - Math.max(0, lineCount - 1) * 0.012);
    if (score > bestScore) {
      best = ranges;
      bestScore = score;
    }
  }
  return best;
}

function fontUrl(script: QuranScriptStyle, page?: number): string {
  if (script === "tajweed") {
    if (!page || page < 1 || page > 604) throw new Error("Tajweed rendering needs a verified Mushaf page number");
    return `${FONT_ORIGIN}/fonts/quran/hafs/v4/colrv1/woff2/p${page}.woff2`;
  }
  return FONT_URLS[script];
}

async function fetchFont(url: string, cacheSignal: AbortSignal): Promise<LoadedFont> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.origin !== FONT_ORIGIN) throw new Error("Blocked an unapproved Quran font origin");
  const timeoutController = new AbortController();
  const signal = AbortSignal.any([cacheSignal, timeoutController.signal]);
  const timer = setTimeout(() => timeoutController.abort(new Error("Quran font request timed out")), FONT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal, redirect: "error", headers: { accept: "font/woff2" } });
    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== "https:" || finalUrl.origin !== FONT_ORIGIN) {
      await response.body?.cancel().catch(() => {});
      throw new Error("The Quran font request redirected outside quran.com");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Quran font request failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase();
    if (contentType && !["font/woff2", "application/font-woff2", "application/octet-stream"].includes(contentType)) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Quran font request returned ${contentType}`);
    }
    const bytes = await readBoundedResponse(response, { maxBytes: FONT_LIMIT_BYTES, signal, label: "The Quran font" });
    signal.throwIfAborted();
    const module = await import("fontkit");
    signal.throwIfAborted();
    const loaded = module.create(bytes) as Font | FontCollection;
    const font = "fonts" in loaded ? loaded.fonts[0] : loaded;
    if (!font) throw new Error("The Quran font contains no usable face");
    return font as LoadedFont;
  } finally {
    clearTimeout(timer);
  }
}

function waitForFont(entry: FontCacheEntry, signal: AbortSignal): Promise<LoadedFont> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("Quran font request cancelled"));
    signal.addEventListener("abort", aborted, { once: true });
    void entry.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

function loadFont(script: QuranScriptStyle, page: number | undefined, signal: AbortSignal): Promise<LoadedFont> {
  const url = fontUrl(script, page);
  const cached = fontCache.get(url);
  if (cached) {
    fontCache.delete(url);
    fontCache.set(url, cached);
    return waitForFont(cached, signal);
  }
  const controller = new AbortController();
  let entry: FontCacheEntry;
  const promise = fetchFont(url, controller.signal).catch((cause) => {
    if (fontCache.get(url) === entry) fontCache.delete(url);
    throw cause;
  });
  entry = { controller, promise };
  fontCache.set(url, entry);
  while (fontCache.size > FONT_CACHE_SIZE) {
    const oldest = fontCache.entries().next().value as [string, FontCacheEntry] | undefined;
    if (!oldest) break;
    fontCache.delete(oldest[0]);
    oldest[1].controller.abort(new Error("Superseded by a newer Quran font"));
  }
  return waitForFont(entry, signal);
}

function recoverWoff2BaseGlyph(font: LoadedFont, id: number): Glyph | null {
  // fontkit 2.0.4's WOFF2 override forgets to return a cached base glyph. Temporarily
  // removing the COLR wrapper lets it decode the outline, after which the wrapper is restored.
  const glyphs = font._glyphs;
  const wrapper = glyphs?.[id];
  if (glyphs) delete glyphs[id];
  try { return font._getBaseGlyph?.(id) ?? null; }
  finally { if (glyphs && wrapper) glyphs[id] = wrapper; }
}

function colorLayers(font: LoadedFont, glyph: Glyph): readonly { readonly glyph: Glyph; readonly color: { red: number; green: number; blue: number; alpha: number } }[] {
  const exposed = glyph.layers;
  if (!exposed?.length || exposed.some((layer) => !layer.color)) return [];
  const record = font.COLR?.baseGlyphRecord.find((candidate) => candidate.gid === glyph.id);
  if (!record || exposed.length !== record.numLayers) return [];
  if (exposed.every((layer) => Boolean(layer.glyph))) {
    return exposed as readonly { readonly glyph: Glyph; readonly color: { red: number; green: number; blue: number; alpha: number } }[];
  }
  const layers = Array.from({ length: record.numLayers }, (_, index) => {
    const layerRecord = font.COLR?.layerRecords[record.firstLayerIndex + index];
    const recovered = layerRecord ? recoverWoff2BaseGlyph(font, layerRecord.gid) : null;
    const color = exposed[index]?.color;
    return recovered && color ? { glyph: recovered, color } : null;
  }).filter((layer): layer is { glyph: Glyph; color: { red: number; green: number; blue: number; alpha: number } } => layer !== null);
  return layers.length === record.numLayers ? layers : [];
}

function appendPath(THREE: ThreeModule, target: InstanceType<ThreeModule["ShapePath"]>, path: Path, x: number, y: number): void {
  for (const command of path.commands) {
    const args = command.args;
    if (command.command === "moveTo") target.moveTo(x + args[0]!, y + args[1]!);
    else if (command.command === "lineTo") target.lineTo(x + args[0]!, y + args[1]!);
    else if (command.command === "quadraticCurveTo") target.quadraticCurveTo(x + args[0]!, y + args[1]!, x + args[2]!, y + args[3]!);
    else if (command.command === "bezierCurveTo") target.bezierCurveTo(x + args[0]!, y + args[1]!, x + args[2]!, y + args[3]!, x + args[4]!, y + args[5]!);
    else target.currentPath?.closePath();
  }
}

function disposeObject(object: ThreeNamespace.Object3D): void {
  const geometries = new Set<ThreeNamespace.BufferGeometry>();
  const materials = new Set<ThreeNamespace.Material>();
  object.traverse((child) => {
    const mesh = child as ThreeNamespace.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of meshMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function materialFor(
  THREE: ThreeModule,
  cache: Map<string, ThreeNamespace.MeshStandardMaterial>,
  color: number,
  active: boolean,
  opacity = 1,
  wordPosition = 0,
): ThreeNamespace.MeshStandardMaterial {
  const key = `${color}:${active}:${opacity}:${wordPosition}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: active ? color : 0x152126,
    emissiveIntensity: active ? 4 : 1.15,
    roughness: 0.58,
    metalness: 0.06,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
  cache.set(key, material);
  return material;
}

function buildLine(
  THREE: ThreeModule,
  font: LoadedFont,
  text: string,
  script: QuranScriptStyle,
  active: boolean,
  extruded: boolean,
  glyphBudget: number,
  trackWordPositions: boolean,
  lastWordPosition?: number,
  normalize = true,
): ThreeNamespace.Group {
  const line = new THREE.Group();
  const materials = new Map<string, ThreeNamespace.MeshStandardMaterial>();
  const run = font.layout(text, {}, "arab", "ARA", "rtl");
  if (run.glyphs.length > MAX_LINE_GLYPHS) throw new Error("A Quran page line exceeded the bounded vector-glyph limit");
  if (run.glyphs.length > glyphBudget) throw new Error("The Quran page exceeded the bounded vector-glyph memory limit");
  let cursorX = 0;
  let currentWordPosition = trackWordPositions
    ? lastWordPosition ?? text.trim().split(/\s+/u).filter(Boolean).length
    : 0;
  for (let index = 0; index < run.glyphs.length; index++) {
    const glyph = run.glyphs[index]!;
    const position = run.positions[index]!;
    if (glyph.codePoints.includes(32)) {
      cursorX += position.xAdvance;
      if (trackWordPositions) currentWordPosition--;
      continue;
    }
    const layers = script === "tajweed" ? colorLayers(font, glyph) : [{ glyph }];
    if (script === "tajweed" && layers.length === 0) {
      const colorRecord = font.COLR?.baseGlyphRecord.some((candidate) => candidate.gid === glyph.id);
      if (!colorRecord && glyph.path.commands.length === 0) {
        cursorX += position.xAdvance;
        continue;
      }
      throw new Error("This QCF glyph has no verified Tajweed color outlines");
    }
    for (const layer of layers) {
      if (layer.glyph.path.commands.length === 0) continue;
      const path = new THREE.ShapePath();
      appendPath(THREE, path, layer.glyph.path, cursorX + position.xOffset, position.yOffset);
      const shapes = path.toShapes(false);
      if (shapes.length === 0) continue;
      const geometry = extruded
        ? new THREE.ExtrudeGeometry(shapes, { depth: 48, bevelEnabled: true, bevelSize: 7, bevelThickness: 7, bevelSegments: 2, curveSegments: 5 })
        : new THREE.ShapeGeometry(shapes, 4);
      const palette = "color" in layer && layer.color
        ? (layer.color.red << 16) | (layer.color.green << 8) | layer.color.blue
        : active ? 0xf3d98b : 0xdce7e4;
      const opacity = "color" in layer && layer.color ? layer.color.alpha / 255 : active ? 1 : 0.82;
      const baseEmissive = active ? palette : 0x152126;
      const baseEmissiveIntensity = active ? 4 : 1.15;
      const baseZ = active ? 0.08 : 0;
      const mesh = new THREE.Mesh(geometry, materialFor(THREE, materials, palette, active, opacity, currentWordPosition));
      mesh.position.z = baseZ;
      if (trackWordPositions) {
        mesh.userData = { quranWordPosition: currentWordPosition, baseEmissive, baseEmissiveIntensity, baseZ };
      }
      line.add(mesh);
    }
    cursorX += position.xAdvance;
  }
  if (line.children.length === 0) throw new Error("The selected Quran font produced no vector outlines for this text");
  const bounds = new THREE.Box3().setFromObject(line);
  const width = Math.max(1, bounds.max.x - bounds.min.x);
  const height = Math.max(1, bounds.max.y - bounds.min.y);
  if (normalize) {
    const targetWidth = active ? 9.35 : 8.65;
    const targetHeight = active ? 1.72 : 0.72;
    const scale = Math.min(targetWidth / width, targetHeight / height);
    line.scale.setScalar(scale);
    line.position.x = -(bounds.min.x + width / 2) * scale;
    line.position.y = -(bounds.min.y + height / 2) * scale;
  } else {
    line.position.x = -(bounds.min.x + width / 2);
    line.position.y = -(bounds.min.y + height / 2);
  }
  line.userData.glyphCount = run.glyphs.length;
  return line;
}

function measuredAdvance(font: LoadedFont, text: string): number {
  const run = font.layout(text, {}, "arab", "ARA", "rtl");
  return Math.max(1, run.positions.reduce((total, position) => total + Math.abs(position.xAdvance), 0));
}

function responsiveAyahLines(font: LoadedFont, text: string, viewportAspect: number): readonly {
  readonly text: string;
  readonly startWord: number;
  readonly endWord: number;
}[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const lineHeight = Math.max(1, Math.abs(font.ascent - font.descent));
  const spaceWidth = measuredAdvance(font, " ");
  const ranges = responsiveAyahLineRanges(words.map((word) => measuredAdvance(font, word)), spaceWidth, lineHeight, viewportAspect);
  return ranges.map((range) => ({
    text: words.slice(range.start, range.end).join(" "),
    startWord: range.start + 1,
    endWord: range.end,
  }));
}

export async function buildArabicReadingGroup(
  THREE: ThreeModule,
  surface: QuranReadingSurface,
  signal: AbortSignal,
  options: { readonly viewportAspect?: number } = {},
): Promise<ThreeNamespace.Group> {
  if (surface.lines.length < 1 || surface.lines.length > 15) throw new Error("The spatial reader supports one to fifteen bounded Quran lines");
  const font = await loadFont(surface.script, surface.page, signal);
  signal.throwIfAborted();
  const group = new THREE.Group();
  try {
    const pageMode = surface.layout === "page";
    const ayahLines = !pageMode && surface.lines.length === 1
      ? responsiveAyahLines(font, surface.lines[0]!.text, options.viewportAspect ?? 2)
      : [];
    const renderLines = ayahLines.length > 0
      ? ayahLines.map((line, index) => ({
        id: `${surface.lines[0]!.id}-wrap-${index + 1}`,
        text: line.text,
        active: surface.lines[0]!.active,
        endWord: line.endWord,
      }))
      : surface.lines.map((line) => ({ ...line, endWord: undefined }));
    const naturalAyahLines = !pageMode && ayahLines.length > 0;
    const fontLineHeight = Math.max(1, Math.abs(font.ascent - font.descent));
    const gap = pageMode ? 0.54 : naturalAyahLines ? fontLineHeight * 1.28 : 1.55;
    const center = (renderLines.length - 1) / 2;
    let remainingGlyphs = MAX_SURFACE_GLYPHS;
    for (let index = 0; index < renderLines.length; index++) {
      signal.throwIfAborted();
      const input = renderLines[index]!;
      const trackWordPositions = !pageMode && (naturalAyahLines || input.id === surface.verseKey);
      const line = buildLine(
        THREE,
        font,
        input.text,
        surface.script,
        input.active,
        !pageMode,
        remainingGlyphs,
        trackWordPositions,
        input.endWord,
        !naturalAyahLines,
      );
      remainingGlyphs -= Number(line.userData.glyphCount ?? 0);
      line.position.y += (center - index) * gap;
      line.position.z = input.active ? 0.3 : pageMode ? -0.25 : 0;
      if (input.active && pageMode) line.scale.multiplyScalar(1.06);
      line.userData = { ...line.userData, quranLineId: input.id, active: input.active };
      group.add(line);
    }
    group.rotation.x = pageMode ? -0.035 : 0;
    group.userData.renderedLineCount = renderLines.length;
    return group;
  } catch (cause) {
    disposeObject(group);
    throw cause;
  }
}

export function disposeArabicReadingGroup(group: ThreeNamespace.Object3D): void {
  disposeObject(group);
}

export function clearQuranFontCache(): void {
  for (const entry of fontCache.values()) entry.controller.abort(new Error("The spatial reader closed"));
  fontCache.clear();
}
