export type FocusablePane = "sidebar" | "arabic" | "translation" | "transliteration" | "panel";

export interface PaneVisibility {
  showSidebar: boolean;
  showArabic: boolean;
  showTranslation: boolean;
  showTransliteration: boolean;
  showPanel: boolean;
}

export type FocusAction =
  | { type: "set"; pane: FocusablePane }
  | { type: "cycle"; visibility: PaneVisibility };

export function visiblePanes(visibility: PaneVisibility): FocusablePane[] {
  const panes: FocusablePane[] = [];
  if (visibility.showSidebar) panes.push("sidebar");
  if (visibility.showArabic) panes.push("arabic");
  if (visibility.showTranslation) panes.push("translation");
  if (visibility.showTransliteration) panes.push("transliteration");
  if (visibility.showPanel) panes.push("panel");
  return panes;
}

export function focusReducer(current: FocusablePane, action: FocusAction): FocusablePane {
  if (action.type === "set") return action.pane;

  const panes = visiblePanes(action.visibility);
  if (panes.length === 0) return current;
  const currentIndex = panes.indexOf(current);
  return panes[(currentIndex + 1) % panes.length] ?? panes[0]!;
}

/**
 * Tab moves between areas rather than every pane: the Arabic, Translation
 * and Transliteration panes all follow the same verse, so they share one stop.
 */
export type FocusRegion = "surahs" | "stats" | "reader" | "panel";

export function visibleRegions(visibility: PaneVisibility): FocusRegion[] {
  const regions: FocusRegion[] = [];
  if (visibility.showSidebar) regions.push("surahs", "stats");
  if (visibility.showArabic || visibility.showTranslation || visibility.showTransliteration) regions.push("reader");
  if (visibility.showPanel) regions.push("panel");
  return regions;
}

export function regionOf(pane: FocusablePane, sidebarSubFocus: "surahList" | "stats"): FocusRegion {
  if (pane === "sidebar") return sidebarSubFocus === "stats" ? "stats" : "surahs";
  if (pane === "panel") return "panel";
  return "reader";
}

export function stepRegion(current: FocusRegion, visibility: PaneVisibility, direction: 1 | -1): FocusRegion {
  const regions = visibleRegions(visibility);
  if (regions.length === 0) return current;
  const index = regions.indexOf(current);
  if (index === -1) return direction === 1 ? regions[0]! : regions[regions.length - 1]!;
  return regions[(index + direction + regions.length) % regions.length]!;
}

export function isReaderPane(pane: FocusablePane): boolean {
  return pane === "arabic" || pane === "translation" || pane === "transliteration";
}

export function firstReaderPane(visibility: PaneVisibility): FocusablePane {
  const panes = visiblePanes(visibility);
  return panes.find((pane) => pane === "arabic" || pane === "translation" || pane === "transliteration")
    ?? panes[0]
    ?? "arabic";
}
