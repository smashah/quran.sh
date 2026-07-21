export type ReaderLayoutMode = "compact" | "standard" | "immersive";

export interface ReaderLayout {
  readonly mode: ReaderLayoutMode;
  readonly showSidebar: boolean;
  readonly showAuxiliaryPanel: boolean;
  readonly showDecoration: boolean;
  readonly footerHeight: number;
}

export function chooseReaderLayout(width: number, height: number): ReaderLayout {
  if (width < 72 || height < 20) {
    return { mode: "compact", showSidebar: false, showAuxiliaryPanel: false, showDecoration: false, footerHeight: 2 };
  }
  if (width < 120 || height < 32) {
    return { mode: "standard", showSidebar: true, showAuxiliaryPanel: false, showDecoration: false, footerHeight: 3 };
  }
  return { mode: "immersive", showSidebar: true, showAuxiliaryPanel: true, showDecoration: true, footerHeight: 4 };
}

export interface ReaderAnchor {
  readonly verseKey: string;
  readonly focus: string;
  readonly zoom: number;
}

export function preserveReaderAnchor<T extends ReaderAnchor>(anchor: T, _next: ReaderLayout): T {
  return anchor;
}

export function readerTransitionDuration(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 180;
}
