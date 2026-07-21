import { PNG } from "pngjs";
import { FrameBufferRenderable, RGBA } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { getSurah } from "../../data/quran";
import { AYAH_IMAGE_PROVIDER, ayahImageUrl, clearAyahImageCache, fetchAyahImage } from "../utils/ayah-image.ts";
import { DEFAULT_IMAGE_VIEWPORT, dragImageViewport, updateImageViewport, viewportBounds } from "../../features/images/viewport.ts";

interface ImageReaderProps {
  surahId: number;
  verseId: number;
  focused?: boolean;
  onError?: (message: string) => void;
}

interface PreparedImage {
  width: number;
  height: number;
  darkPixels: Uint8Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const preparedImageCache = new Map<string, PreparedImage>();
const PREPARED_IMAGE_CACHE_LIMIT = 24;
const PREPARED_IMAGE_CACHE_BYTES = 16 * 1024 * 1024;
let preparedImageCacheBytes = 0;
const brailleGridCache = new Map<string, { lines: readonly string[]; bytes: number }>();
const BRAILLE_GRID_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 4_000_000;
let brailleGridCacheBytes = 0;
let mountedReaders = 0;
const BRAILLE_MAP = [0x1, 0x8, 0x2, 0x10, 0x4, 0x20, 0x40, 0x80] as const;

function rememberPreparedImage(key: string, image: PreparedImage): void {
  const previous = preparedImageCache.get(key);
  if (previous) preparedImageCacheBytes -= previous.darkPixels.byteLength;
  preparedImageCache.delete(key);
  preparedImageCache.set(key, image);
  preparedImageCacheBytes += image.darkPixels.byteLength;
  while (preparedImageCache.size > PREPARED_IMAGE_CACHE_LIMIT || preparedImageCacheBytes > PREPARED_IMAGE_CACHE_BYTES) {
    const oldest = preparedImageCache.keys().next().value;
    if (!oldest) break;
    const removed = preparedImageCache.get(oldest);
    if (removed) preparedImageCacheBytes -= removed.darkPixels.byteLength;
    preparedImageCache.delete(oldest);
  }
}

function rememberBrailleGrid(key: string, lines: readonly string[]): void {
  const previous = brailleGridCache.get(key);
  if (previous) brailleGridCacheBytes -= previous.bytes;
  const bytes = lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0);
  brailleGridCache.delete(key);
  brailleGridCache.set(key, { lines, bytes });
  brailleGridCacheBytes += bytes;
  while (brailleGridCacheBytes > BRAILLE_GRID_CACHE_BYTES) {
    const oldest = brailleGridCache.keys().next().value;
    if (!oldest) break;
    brailleGridCacheBytes -= brailleGridCache.get(oldest)?.bytes ?? 0;
    brailleGridCache.delete(oldest);
  }
}

function clearImageCaches(): void {
  preparedImageCache.clear();
  preparedImageCacheBytes = 0;
  brailleGridCache.clear();
  brailleGridCacheBytes = 0;
}

const yieldToInput = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function boundedPngDimensions(buffer: Buffer): { readonly width: number; readonly height: number } {
  if (buffer.byteLength < 24
    || buffer.readUInt32BE(8) !== 13
    || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("Image source returned a malformed PNG header");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0
    || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(`Image dimensions ${width}×${height} exceed the safe decode limit`);
  }
  return { width, height };
}

async function prepareImage(buffer: Buffer, signal: AbortSignal): Promise<PreparedImage> {
  const expected = boundedPngDimensions(buffer);
  const png = await new Promise<PNG>((resolve, reject) => {
    new PNG().parse(buffer, (error, decoded) => error ? reject(error) : resolve(decoded));
  });
  if (png.width !== expected.width || png.height !== expected.height
    || png.width * png.height > MAX_IMAGE_PIXELS) {
    throw new Error("Decoded image dimensions did not match the bounded PNG header");
  }
  const darkPixels = new Uint8Array(png.width * png.height);
  let minX = png.width;
  let maxX = 0;
  let minY = png.height;
  let maxY = 0;

  for (let y = 0; y < png.height; y++) {
    if (y % 64 === 0) {
      signal.throwIfAborted();
      await yieldToInput();
    }
    for (let x = 0; x < png.width; x++) {
      const pixel = png.width * y + x;
      const index = pixel << 2;
      const alpha = (png.data[index + 3] ?? 255) / 255;
      const red = (png.data[index] ?? 255) / 255;
      const green = (png.data[index + 1] ?? 255) / 255;
      const blue = (png.data[index + 2] ?? 255) / 255;
      const luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha + (1 - alpha);

      if (luma < 0.85) darkPixels[pixel] = 1;
      if (luma < 0.95) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX > maxX) {
    minX = 0;
    maxX = png.width - 1;
    minY = 0;
    maxY = png.height - 1;
  }

  return {
    width: png.width,
    height: png.height,
    darkPixels,
    minX: Math.max(0, minX - 4),
    maxX: Math.min(png.width - 1, maxX + 4),
    minY: Math.max(0, minY - 4),
    maxY: Math.min(png.height - 1, maxY + 4),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to load image";
}

export function ImageReader({ surahId, verseId, focused = false, onError }: ImageReaderProps) {
  const boxRef = useRef<ScrollBoxRenderable | null>(null);
  const renderer = useRenderer();
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"fetching" | "decoding" | "rasterizing" | "cached" | "ready">("fetching");
  const [resizeCount, setResizeCount] = useState(0);
  const [viewport, setViewport] = useState(DEFAULT_IMAGE_VIEWPORT);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    mountedReaders += 1;
    return () => {
      mountedReaders -= 1;
      if (mountedReaders === 0) {
        clearImageCaches();
        clearAyahImageCache();
      }
    };
  }, []);

  useEffect(() => setViewport(DEFAULT_IMAGE_VIEWPORT), [surahId, verseId]);

  useKeyboard((key) => {
    if (!focused) return;
    const action = key.sequence === "+" || key.sequence === "=" ? "zoom-in"
      : key.sequence === "-" ? "zoom-out"
      : key.name === "left" ? "left"
      : key.name === "right" ? "right"
      : key.name === "up" ? "up"
      : key.name === "down" ? "down"
      : key.sequence === "0" ? "reset"
      : null;
    if (key.sequence === "C") {
      clearImageCaches();
      return;
    }
    if (!action) return;
    key.preventDefault();
    key.stopPropagation();
    setViewport((current) => updateImageViewport(current, action));
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setResizeCount((count) => count + 1), 80);
    };
    renderer.on("resize", handleResize);
    return () => {
      if (timer) clearTimeout(timer);
      renderer.off("resize", handleResize);
    };
  }, [renderer]);

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = ayahImageUrl(surahId, verseId);
    let active = true;

    setLoading(true);
    setStatus("fetching");
    setError(null);
    setImage(null);

    const cached = preparedImageCache.get(cacheKey);
    if (cached) {
      rememberPreparedImage(cacheKey, cached);
      setImage(cached);
      setStatus("cached");
      setLoading(false);
      return () => controller.abort();
    }

    fetchAyahImage(surahId, verseId, { signal: controller.signal })
      .then(async (buffer) => {
        if (!active) return;
        setStatus("decoding");
        const prepared = await prepareImage(buffer, controller.signal);
        if (!active || controller.signal.aborted) return;
        rememberPreparedImage(cacheKey, prepared);
        setImage(prepared);
        setStatus("ready");
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        const message = errorMessage(cause);
        setError(message);
        setLoading(false);
        onError?.(message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [onError, surahId, verseId]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !image) return;
    let active = true;
    let canvas: FrameBufferRenderable | null = null;
    void (async () => {
      const boxWidth = Math.floor(box.getLayoutNode().getComputedWidth()) || 80;
    const sourceBounds = viewportBounds(image, viewport);
    const croppedWidth = sourceBounds.maxX - sourceBounds.minX + 1;
    const croppedHeight = sourceBounds.maxY - sourceBounds.minY + 1;
    const width = boxWidth > 10 ? boxWidth - 4 : 80;
    const height = Math.max(Math.ceil(width * (croppedHeight / croppedWidth) * 0.45), 5);
    const virtualWidth = width * 2;
    const virtualHeight = height * 4;
    const scaleX = croppedWidth / virtualWidth;
    const scaleY = croppedHeight / virtualHeight;

      canvas = new FrameBufferRenderable(renderer, {
      id: `canvas-${surahId}-${verseId}-${resizeCount}`,
      width,
      height,
      alignItems: "center",
      justifyContent: "center",
    });

      const isDark = (virtualX: number, virtualY: number): boolean => {
      const startX = sourceBounds.minX + Math.floor(virtualX * scaleX);
      const startY = sourceBounds.minY + Math.floor(virtualY * scaleY);
      const endX = Math.min(sourceBounds.maxX + 1, sourceBounds.minX + Math.max(Math.floor((virtualX + 1) * scaleX), Math.floor(virtualX * scaleX) + 1));
      const endY = Math.min(sourceBounds.maxY + 1, sourceBounds.minY + Math.max(Math.floor((virtualY + 1) * scaleY), Math.floor(virtualY * scaleY) + 1));

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          if (image.darkPixels[image.width * y + x] === 1) return true;
        }
      }
      return false;
    };

      const background = RGBA.fromValues(0, 0, 0, 0);
      const foreground = RGBA.fromValues(0.9, 0.9, 0.9, 1);
      canvas.frameBuffer.fillRect(0, 0, width, height, background);

    const gridKey = `${surahId}:${verseId}:${width}:${height}:${viewport.zoom}:${viewport.panX}:${viewport.panY}`;
    let lines = brailleGridCache.get(gridKey)?.lines;
    if (!lines) {
      setStatus("rasterizing");
      const next: string[] = [];
      for (let y = 0; y < height; y++) {
        if (!active) return;
        if (y % 4 === 0) await yieldToInput();
        let line = "";
        for (let x = 0; x < width; x++) {
          let charCode = 0x2800;
          for (let dotY = 0; dotY < 4; dotY++) {
            for (let dotX = 0; dotX < 2; dotX++) {
              if (isDark(x * 2 + dotX, y * 4 + dotY)) charCode += BRAILLE_MAP[dotY * 2 + dotX]!;
            }
          }
          line += String.fromCharCode(charCode);
        }
        next.push(line);
      }
      lines = next;
      rememberBrailleGrid(gridKey, lines);
      setStatus("ready");
    } else {
      setStatus("cached");
    }
    if (!active || !canvas) return;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
          canvas.frameBuffer.setCellWithAlphaBlending(
          x,
          y,
          lines[y]?.[x] ?? " ",
          foreground,
          background,
        );
      }
    }

    box.add(canvas);
    })().catch((cause: unknown) => {
      if (active) setError(errorMessage(cause));
    });
    return () => {
      active = false;
      if (canvas) {
        if (box.getChildren().includes(canvas)) box.remove(canvas);
        if (!canvas.isDestroyed) canvas.destroy();
      }
    };
  }, [image, renderer, resizeCount, surahId, verseId, viewport]);

  return (
    <scrollbox
      ref={boxRef}
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      scrollY={true}
      focusable={true}
      focused={focused}
      scrollbarOptions={{ visible: false }}
      viewportCulling={true}
      onMouseScroll={(event) => {
        if (!focused || !event.scroll) return;
        event.preventDefault();
        event.stopPropagation();
        setViewport((current) => updateImageViewport(current, event.scroll!.direction === "up" ? "zoom-in" : "zoom-out"));
      }}
      onMouseDown={(event) => { if (focused) dragRef.current = { x: event.x, y: event.y }; }}
      onMouseDrag={(event) => {
        if (!focused || !dragRef.current) return;
        const previous = dragRef.current;
        dragRef.current = { x: event.x, y: event.y };
        setViewport((current) => dragImageViewport(current, event.x - previous.x, event.y - previous.y));
      }}
      onMouseDragEnd={() => { dragRef.current = null; }}
    >
      {loading && (
        <text fg="#888888">Loading image for {getSurah(surahId)?.transliteration} {surahId}:{verseId}...</text>
      )}
      {error && <text fg="#ff5555">{error}</text>}
      {image && <text fg="#777777">{`${status} · ${AYAH_IMAGE_PROVIDER} · ${image.width}×${image.height} · zoom ${viewport.zoom.toFixed(1)}× · wheel/+/- zoom · drag/arrows pan · 0 reset · C clear ${Math.ceil((preparedImageCacheBytes + brailleGridCacheBytes) / 1024)} KiB`}</text>}
    </scrollbox>
  );
}
