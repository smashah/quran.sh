export interface ImageBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface ImageViewport {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export const DEFAULT_IMAGE_VIEWPORT: ImageViewport = { zoom: 1, panX: 0, panY: 0 };

export function updateImageViewport(
  viewport: ImageViewport,
  action: "zoom-in" | "zoom-out" | "left" | "right" | "up" | "down" | "reset",
): ImageViewport {
  if (action === "reset") return DEFAULT_IMAGE_VIEWPORT;
  if (action === "zoom-in") return { ...viewport, zoom: Math.min(8, viewport.zoom * 1.25) };
  if (action === "zoom-out") {
    const zoom = Math.max(1, viewport.zoom / 1.25);
    return zoom === 1 ? DEFAULT_IMAGE_VIEWPORT : { ...viewport, zoom };
  }
  const step = 0.1 / viewport.zoom;
  if (action === "left") return { ...viewport, panX: Math.max(-0.5, viewport.panX - step) };
  if (action === "right") return { ...viewport, panX: Math.min(0.5, viewport.panX + step) };
  if (action === "up") return { ...viewport, panY: Math.max(-0.5, viewport.panY - step) };
  return { ...viewport, panY: Math.min(0.5, viewport.panY + step) };
}

export function viewportBounds(bounds: ImageBounds, viewport: ImageViewport): ImageBounds {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const visibleWidth = width / viewport.zoom;
  const visibleHeight = height / viewport.zoom;
  const centerX = bounds.minX + width * (0.5 + viewport.panX * (1 - 1 / viewport.zoom));
  const centerY = bounds.minY + height * (0.5 + viewport.panY * (1 - 1 / viewport.zoom));
  const minX = Math.max(bounds.minX, Math.min(bounds.maxX - visibleWidth + 1, centerX - visibleWidth / 2));
  const minY = Math.max(bounds.minY, Math.min(bounds.maxY - visibleHeight + 1, centerY - visibleHeight / 2));
  return {
    minX: Math.floor(minX),
    maxX: Math.ceil(Math.min(bounds.maxX, minX + visibleWidth - 1)),
    minY: Math.floor(minY),
    maxY: Math.ceil(Math.min(bounds.maxY, minY + visibleHeight - 1)),
  };
}

export function dragImageViewport(viewport: ImageViewport, deltaX: number, deltaY: number): ImageViewport {
  if (viewport.zoom <= 1) return DEFAULT_IMAGE_VIEWPORT;
  const scale = 0.02 / viewport.zoom;
  return {
    ...viewport,
    panX: Math.max(-0.5, Math.min(0.5, viewport.panX - deltaX * scale)),
    panY: Math.max(-0.5, Math.min(0.5, viewport.panY - deltaY * scale)),
  };
}
