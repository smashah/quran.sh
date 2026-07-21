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

export function firstReaderPane(visibility: PaneVisibility): FocusablePane {
  const panes = visiblePanes(visibility);
  return panes.find((pane) => pane === "arabic" || pane === "translation" || pane === "transliteration")
    ?? panes[0]
    ?? "arabic";
}
