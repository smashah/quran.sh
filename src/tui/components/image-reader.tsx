import { PNG } from "pngjs";
import { FrameBufferRenderable, RGBA } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { useRenderer } from "@opentui/react";
import { getSurah } from "../../data/quran";
import { ayahImageUrl, fetchAyahImage } from "../utils/ayah-image.ts";

interface ImageReaderProps {
  surahId: number;
  verseId: number;
  focused?: boolean;
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
const BRAILLE_MAP = [0x1, 0x8, 0x2, 0x10, 0x4, 0x20, 0x40, 0x80] as const;

function rememberPreparedImage(key: string, image: PreparedImage): void {
  preparedImageCache.delete(key);
  preparedImageCache.set(key, image);
  if (preparedImageCache.size > PREPARED_IMAGE_CACHE_LIMIT) {
    const oldest = preparedImageCache.keys().next().value;
    if (oldest) preparedImageCache.delete(oldest);
  }
}

function prepareImage(buffer: Buffer): PreparedImage {
  const png = PNG.sync.read(buffer);
  const darkPixels = new Uint8Array(png.width * png.height);
  let minX = png.width;
  let maxX = 0;
  let minY = png.height;
  let maxY = 0;

  for (let y = 0; y < png.height; y++) {
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

export function ImageReader({ surahId, verseId, focused = false }: ImageReaderProps) {
  const boxRef = useRef<ScrollBoxRenderable | null>(null);
  const renderer = useRenderer();
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resizeCount, setResizeCount] = useState(0);

  useEffect(() => {
    const handleResize = () => setResizeCount((count) => count + 1);
    renderer.on("resize", handleResize);
    return () => {
      renderer.off("resize", handleResize);
    };
  }, [renderer]);

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = ayahImageUrl(surahId, verseId);
    let active = true;

    setLoading(true);
    setError(null);
    setImage(null);

    const cached = preparedImageCache.get(cacheKey);
    if (cached) {
      rememberPreparedImage(cacheKey, cached);
      setImage(cached);
      setLoading(false);
      return () => controller.abort();
    }

    fetchAyahImage(surahId, verseId, { signal: controller.signal })
      .then((buffer) => {
        if (!active) return;
        const prepared = prepareImage(buffer);
        rememberPreparedImage(cacheKey, prepared);
        setImage(prepared);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(errorMessage(cause));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [surahId, verseId]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !image) return;

    const boxWidth = Math.floor(box.getLayoutNode().getComputedWidth()) || 80;
    const croppedWidth = image.maxX - image.minX + 1;
    const croppedHeight = image.maxY - image.minY + 1;
    const width = boxWidth > 10 ? boxWidth - 4 : 80;
    const height = Math.max(Math.ceil(width * (croppedHeight / croppedWidth) * 0.45), 5);
    const virtualWidth = width * 2;
    const virtualHeight = height * 4;
    const scaleX = croppedWidth / virtualWidth;
    const scaleY = croppedHeight / virtualHeight;

    const canvas = new FrameBufferRenderable(renderer, {
      id: `canvas-${surahId}-${verseId}-${resizeCount}`,
      width,
      height,
      alignItems: "center",
      justifyContent: "center",
    });

    const isDark = (virtualX: number, virtualY: number): boolean => {
      const startX = image.minX + Math.floor(virtualX * scaleX);
      const startY = image.minY + Math.floor(virtualY * scaleY);
      const endX = Math.min(image.maxX + 1, image.minX + Math.max(Math.floor((virtualX + 1) * scaleX), Math.floor(virtualX * scaleX) + 1));
      const endY = Math.min(image.maxY + 1, image.minY + Math.max(Math.floor((virtualY + 1) * scaleY), Math.floor(virtualY * scaleY) + 1));

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

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let charCode = 0x2800;
        for (let dotY = 0; dotY < 4; dotY++) {
          for (let dotX = 0; dotX < 2; dotX++) {
            if (isDark(x * 2 + dotX, y * 4 + dotY)) {
              charCode += BRAILLE_MAP[dotY * 2 + dotX]!;
            }
          }
        }
        canvas.frameBuffer.setCellWithAlphaBlending(
          x,
          y,
          String.fromCharCode(charCode),
          foreground,
          background,
        );
      }
    }

    box.add(canvas);
    return () => {
      box.remove(canvas);
      canvas.destroy();
    };
  }, [image, renderer, resizeCount, surahId, verseId]);

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
    >
      {loading && (
        <text fg="#888888">Loading image for {getSurah(surahId)?.transliteration} {surahId}:{verseId}...</text>
      )}
      {error && <text fg="#ff5555">{error}</text>}
    </scrollbox>
  );
}
