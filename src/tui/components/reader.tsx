import { lazy, Suspense, useMemo, useEffect, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { getSurah } from "../../data/quran";
import type { VerseRef } from "../../data/quran";
import { useTheme } from "../theme";
import type { FocusablePane, ArabicAlign, ArabicWidth, ArabicFlow } from "../app";
import { renderArabicVerse, processArabicText, isRtlLanguage } from "../utils/rtl";

// React.lazy does not evaluate image-reader (or pngjs) until the user has
// explicitly enabled the image pane.
const LazyImageReader = lazy(async () => {
  const module = await import("./image-reader.tsx");
  return { default: module.ImageReader };
});

export interface ReaderProps {
  surahId: number;
  focusedPane: FocusablePane;
  currentVerseId?: number;
  bookmarkedAyahs?: Set<number>;
  /** Set of ayah IDs already read/tracked for the current surah */
  readVerseIds?: Set<number>;
  searchResults?: VerseRef[];
  searchQuery?: string;
  isSearchMode?: boolean;
  searchInput?: string;
  showArabic?: boolean;
  showTranslation?: boolean;
  showTransliteration?: boolean;
  showArabicImage?: boolean;
  language?: string;
  arabicZoom?: number;
  modalOpen?: boolean;
  arabicAlign?: ArabicAlign;
  arabicWidth?: ArabicWidth;
  arabicFlow?: ArabicFlow;
  onVerseSelect?: (verseId: number) => void;
}

export function Reader(props: ReaderProps) {
  const { theme } = useTheme();
  const surah = useMemo(() => getSurah(props.surahId, props.language), [props.surahId, props.language]);
  const hasSearchResults =
    (props.searchResults && props.searchResults.length > 0) || false;
  const arabicZoom = props.arabicZoom ?? 0;

  const isArabicFocused = props.focusedPane === "arabic";
  const isTranslationFocused = props.focusedPane === "translation";
  const isTransliterationFocused = props.focusedPane === "transliteration";
  const isAnyReaderFocused = !props.modalOpen && (isArabicFocused || isTranslationFocused || isTransliterationFocused);

  // Terminal width for line-aware Arabic reverse
  const { width: termCols } = useTerminalDimensions();

  // Refs for non-focused pane scroll sync
  const scrollRefs = useRef<Record<string, any>>({});

  // Sync all panes to currentVerseId
  useEffect(() => {
    if (props.currentVerseId === undefined) return;

    const timer = setTimeout(() => {
      ["arabic", "translation", "transliteration"].forEach(mode => {
        const ref = scrollRefs.current[mode];
        if (ref && typeof ref.getChildren === "function") {
          const children = ref.getChildren();
          const target = children[props.currentVerseId! - 1];
          if (target) {
            const y = target.getLayoutNode().getComputedTop();
            ref.scrollTo(y);
          }
        }
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [props.currentVerseId]);

  const paneTitle = (label: string, focused: boolean, extra?: string) => {
    const icon = focused ? ` ${theme.ornaments.focusIcon} ` : " ";
    const suffix = extra ? ` ${extra} ` : " ";
    // Build progress bar from current verse position
    const totalVerses = surah?.verses.length ?? 0;
    const currentVerse = props.currentVerseId ?? 1;
    if (totalVerses === 0) return `${icon}${label}${suffix}`;
    const barWidth = 10;
    const filled = Math.round((currentVerse / totalVerses) * barWidth);
    const empty = barWidth - filled;
    const bar = theme.ornaments.progressFilled.repeat(filled) + theme.ornaments.progressEmpty.repeat(empty);
    const pct = Math.round((currentVerse / totalVerses) * 100);
    return `${icon}${label}${suffix}${bar} ${pct}% `;
  };

  const searchTitle = () => {
    if (props.isSearchMode) return ` Search: ${props.searchInput ?? ""}_  `;
    if (hasSearchResults) return ` Search: "${props.searchQuery}" (${props.searchResults!.length} results) `;
    return "";
  };

  const surahLabel = useMemo(() => {
    if (!surah) return "Reader";
    return `${theme.ornaments.headerLeft} ${surah.id}. ${surah.transliteration} · ${surah.translation} ${theme.ornaments.headerRight}`;
  }, [surah, theme.ornaments.headerLeft, theme.ornaments.headerRight]);

  const showTranslation = props.showTranslation ?? true;
  const showTransliteration = props.showTransliteration ?? false;
  const showArabic = props.showArabic ?? true;
  const showArabicImage = props.showArabicImage ?? false;

  const bottomPaneCount = (showTranslation ? 1 : 0) + (showTransliteration ? 1 : 0);

  const renderVerseList = (
    mode: "arabic" | "translation" | "transliteration",
    focused: boolean,
  ) => {
    if (!surah) return null;

    const arabicAlign = props.arabicAlign ?? "right";
    const arabicWidth = props.arabicWidth ?? "100%";
    const arabicFlow = props.arabicFlow ?? "verse";
    const isArabic = mode === "arabic";
    const isRtlTranslation = mode === "translation" && isRtlLanguage(props.language ?? "en");
    const isRtlPane = isArabic || isRtlTranslation;

    // Map alignment names to flexbox values (for text within verse boxes)
    const alignMap = { right: "flex-end", center: "center", left: "flex-start" } as const;
    const textAlign = isRtlPane ? alignMap[arabicAlign] : "flex-start";
    // Center the verse boxes in the scrollbox when width is constrained
    const containerAlign = isRtlPane && arabicWidth !== "100%" ? "center" : textAlign;

    // Compute available columns for line-aware reverse.
    // Account for sidebar (~30 cols), borders (2), padding (4%).
    const paneWidthFraction = arabicWidth === "60%" ? 0.6 : arabicWidth === "80%" ? 0.8 : 1;
    const availableCols = Math.max(20, Math.floor(termCols * 0.7 * paneWidthFraction) - 6);

    // Continuous flow mode for Arabic: join all verses into one text block
    if (isArabic && arabicFlow === "continuous") {
      const parts = surah.verses.map((v) => {
        const text = renderArabicVerse(v.text, arabicZoom, availableCols);
        const isCurrent = v.id === (props.currentVerseId ?? 1);
        const marker = theme.ornaments.sectionMarker;
        return `${text} ${marker}${v.id}${marker}`;
      });

      return (
        <scrollbox
          ref={(el: any) => { scrollRefs.current[mode] = el; }}
          width="100%"
          height="100%"
          margin="auto"
          focusable={true}
          focused={focused}
          scrollbarOptions={
            {
              visible:false,
            }
          }
          flexDirection="column"
          overflow="hidden"
          alignItems={containerAlign}
          backgroundColor={theme.colors.background}
          viewportCulling={true}
        >
          <box maxWidth={arabicWidth} paddingLeft={2} paddingRight={2} flexDirection="column">
            {parts.join("  ").split("\n").map((line, li) => (
              <text key={li} fg={theme.colors.arabic} attributes={TextAttributes.BOLD}>
                {line}
              </text>
            ))}
          </box>
        </scrollbox>
      );
    }

    return (
      <scrollbox
        ref={(el: any) => { scrollRefs.current[mode] = el; }}
        width="100%"
        height="100%"
        padding="2%"
        focusable={true}
        focused={focused}
        scrollY={true}
          scrollbarOptions={
            {
              visible:false,
            }
          }
        flexDirection="column"
        overflow="hidden"
        alignItems={containerAlign}
        backgroundColor={theme.colors.background}
                viewportCulling={true}
              >
                {surah.verses.map((v) => {

          const isCurrent = v.id === (props.currentVerseId ?? 1);
          const isBookmarked = props.bookmarkedAyahs?.has(v.id) ?? false;
          const isRead = props.readVerseIds?.has(v.id) ?? false;
          const marker = isCurrent ? theme.ornaments.verseMarker : " ";
          const bookmark = isBookmarked ? ` ${theme.ornaments.bookmarkIcon}` : "";
          const readMark = isRead && !isCurrent ? ` ${theme.ornaments.completedIcon}` : "";

          const verseNumColor = isCurrent ? theme.colors.highlight : theme.colors.verseNum;
          const bookmarkColor = theme.colors.bookmark;
          const readColor = theme.colors.completed;

          let textContent: string;
          let textColor: string;

          if (mode === "arabic") {
            textContent = renderArabicVerse(v.text, arabicZoom, availableCols);
            textColor = isCurrent ? theme.colors.highlight : theme.colors.arabic;
          } else if (mode === "translation") {
            textContent = isRtlTranslation ? processArabicText(v.translation, availableCols) : v.translation;
            textColor = isCurrent ? theme.colors.highlight : theme.colors.translation;
          } else {
            textContent = v.transliteration || "";
            textColor = isCurrent ? theme.colors.highlight : theme.colors.transliteration;
          }


          return (
            <box
              key={`${mode}-${v.id}`}
              flexDirection="column"
              paddingBottom={1}
              paddingLeft={isRtlPane ? 2 : 0}
              marginLeft={isRtlPane && (textAlign === "center" || textAlign === "flex-end" )  ? "auto" : "0%"}
              marginRight={isRtlPane && (textAlign === "center" || textAlign === "flex-start" ) ? "auto" : "0%"}
              paddingRight={isRtlPane ? 2 : 0}
              maxWidth={isRtlPane ? arabicWidth : "100%"}
              alignItems={isRtlPane ? textAlign : "flex-start"}
              justifyContent={isRtlPane ? textAlign : "flex-start"}
              onMouseDown={() => {
                if (props.onVerseSelect) props.onVerseSelect(v.id);
              }}
            >
              <text fg={verseNumColor} attributes={TextAttributes.BOLD}>
                {marker} {v.id}{isBookmarked ? <span fg={bookmarkColor}>{bookmark}</span> : ""}{isRead && !isCurrent ? <span fg={readColor}>{readMark}</span> : ""}
              </text>
              {textContent.split("\n").map((line, li) => (
                <text key={li} fg={textColor} attributes={(isArabic || isRtlTranslation) ? TextAttributes.BOLD : TextAttributes.NONE}>
                  {line}
                </text>
              ))}
            </box>
          );
        })}
      </scrollbox>
    );
  };

  const renderSearchResults = () => (
    <scrollbox
      width="100%"
      height="100%"
      focusable={true}
      focused={isAnyReaderFocused}
      scrollY={true}
      flexDirection="column"
      overflow="hidden"
      borderStyle={theme.borderStyle}
      borderColor={theme.colors.border}
      backgroundColor={theme.colors.background}
      viewportCulling={true}
    >
      <box paddingBottom={1}>
        <text fg={theme.colors.header} attributes={TextAttributes.BOLD}>
          {`Found ${props.searchResults!.length} result(s) for "${props.searchQuery}"`}
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.colors.muted}>{"Press ESC to return to surah view"}</text>
      </box>
      {props.searchResults!.map((r) => (
        <box key={r.reference} flexDirection="column" paddingBottom={1}>
          <text fg={theme.colors.verseNum} attributes={TextAttributes.BOLD}>
            {`  [${r.reference}]`}
          </text>
          <text fg={theme.colors.translation}>{r.translation}</text>
        </box>
      ))}
    </scrollbox>
  );

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.background}>
      {props.isSearchMode && (
        <box height={1} width="100%" borderStyle={theme.borderStyle} borderColor={theme.colors.secondary}>
          <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD}>
            {"/"}{props.searchInput ?? ""}{"_"}
          </text>
        </box>
      )}

      {hasSearchResults && !props.isSearchMode && renderSearchResults()}

      {!hasSearchResults && !props.isSearchMode && (
        <>
          {!surah ? (
            <box
              width="100%"
              height="100%"
              borderStyle={theme.borderStyle}
              borderColor={theme.colors.border}
              title={paneTitle("Reader", false)}
              titleAlignment="left"
            >
              <text fg={theme.colors.muted}>Surah not found</text>
            </box>
          ) : (
            <>
              {showArabic && (
                <box
                  height={bottomPaneCount > 0 ? "50%" : "100%"}
                  width="100%"
                  overflow="hidden"
                  borderStyle={isArabicFocused ? theme.borderStyleFocused : theme.borderStyle}
                  borderColor={isArabicFocused ? theme.colors.borderFocused : theme.colors.border}
                  customBorderChars={theme.borderChars}
                  focusedBorderColor={theme.colors.borderFocused}
                  title={paneTitle(surahLabel, isArabicFocused, searchTitle())}
                  titleAlignment="left"
                >
                  {showArabicImage ? (
                    <Suspense fallback={<text fg={theme.colors.muted}>Activating image viewer…</text>}>
                      <LazyImageReader surahId={surah.id} verseId={props.currentVerseId ?? 1} focused={isArabicFocused} />
                    </Suspense>
                  ) : (
                    renderVerseList("arabic", isArabicFocused)
                  )}
                </box>
              )}

              {bottomPaneCount > 0 && (
                <box
                  flexDirection="row"
                  height={showArabic ? "50%" : "100%"}
                  width="100%"
                >
                  {showTranslation && (
                    <box
                      width={showTransliteration ? "50%" : "100%"}
                      overflow="hidden"
                      borderStyle={isTranslationFocused ? theme.borderStyleFocused : theme.borderStyle}
                      borderColor={isTranslationFocused ? theme.colors.borderFocused : theme.colors.border}
                      customBorderChars={theme.borderChars}
                      focusedBorderColor={theme.colors.borderFocused}
                      title={paneTitle("Translation", isTranslationFocused, `[${(props.language ?? "en").toUpperCase()}]`)}
                      titleAlignment="left"
                    >
                      {renderVerseList("translation", isTranslationFocused)}
                    </box>
                  )}

                  {showTransliteration && (
                    <box
                      width={showTranslation ? "50%" : "100%"}
                      overflow="hidden"
                      borderStyle={isTransliterationFocused ? theme.borderStyleFocused : theme.borderStyle}
                      borderColor={isTransliterationFocused ? theme.colors.borderFocused : theme.colors.border}
                      customBorderChars={theme.borderChars}
                      focusedBorderColor={theme.colors.borderFocused}
                      title={paneTitle("Transliteration", isTransliterationFocused)}
                      titleAlignment="left"
                    >
                      {renderVerseList("transliteration", isTransliterationFocused)}
                    </box>
                  )}
                </box>
              )}
            </>
          )}
        </>
      )}
    </box>
  );
};
