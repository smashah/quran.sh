import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { getSurah, TOTAL_SURAHS, search } from "../../data/quran";
import { useTheme } from "../theme";

export interface SurahListProps {
  onSelect?: (surahId: number) => void;
  selectedId?: number;
  focused?: boolean;
  disabled?: boolean;
  /** Set of surah IDs that have been fully read (all-time) */
  completedSurahIds?: Set<number>;
  /** Called when the inline search input gains/loses focus */
  onSearchFocusChange?: (focused: boolean) => void;
}

export function SurahList(props: SurahListProps) {
  const { theme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const allOptions = useMemo(() => {
    return Array.from({ length: TOTAL_SURAHS }, (_, i) => {
      const id = i + 1;
      const surah = getSurah(id);
      if (!surah) return { name: "Unknown", description: "", value: id };

      const isCompleted = props.completedSurahIds?.has(id) ?? false;
      const completedMark = isCompleted ? ` ${theme.ornaments.completedIcon}` : "";

      return {
        name: `${id}. ${surah.transliteration}${completedMark}`,
        description: surah.translation,
        value: id,
      };
    });
  }, [props.completedSurahIds, theme.ornaments.completedIcon]);

  const filteredOptions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const rawQuery = searchQuery.trim();
    if (!rawQuery) return allOptions;

    // Filter by surah name / description / number
    const byName = allOptions.filter(
      (opt) =>
        opt.name.toLowerCase().includes(query) ||
        opt.description.toLowerCase().includes(query) ||
        opt.value.toString().includes(query)
    );

    // Search verse content (Arabic + translation) for surahs not already matched
    const nameMatchIds = new Set(byName.map((o) => o.value));
    const verseHits = search(rawQuery);
    const surahCounts = new Map<number, number>();
    for (const v of verseHits) {
      if (!nameMatchIds.has(v.surahId)) {
        surahCounts.set(v.surahId, (surahCounts.get(v.surahId) ?? 0) + 1);
      }
    }

    const byVerse = allOptions
      .filter((o) => surahCounts.has(o.value))
      .map((o) => ({
        ...o,
        description: `${o.description}  (${surahCounts.get(o.value)} ayah match${surahCounts.get(o.value)! > 1 ? "es" : ""})`,
      }));

    return [...byName, ...byVerse];
  }, [searchQuery, allOptions]);

  const [selectedIndex, setSelectedIndex] = useState(
    props.selectedId ? props.selectedId - 1 : 0
  );

  // Sync selection when external navigation changes the surah (bookmarks, cues, etc.)
  useEffect(() => {
    if (props.selectedId !== undefined) {
      const idx = filteredOptions.findIndex(opt => opt.value === props.selectedId);
      if (idx >= 0) setSelectedIndex(idx);
    }
  }, [props.selectedId, filteredOptions]);

  const isFocused = !props.disabled && (props.focused ?? true);

  // Press `/` while the select list is focused to jump into the search input
  useKeyboard((key) => {
    if (!isFocused || searchFocused) return;
    const str = key.sequence || key.name;
    if (str === "/") {
      setSearchFocused(true);
      props.onSearchFocusChange?.(true);
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box
        height={3}
        borderStyle={theme.borderStyle}
        customBorderChars={theme.borderChars}
        borderColor={searchFocused ? theme.colors.highlight : theme.colors.border}
        padding={0}
      >
        <input
          width="100%"
          placeholder=" 🔍 / to search..."
          value={searchQuery}
          focused={isFocused && searchFocused}
          onInput={(value: string) => setSearchQuery(value)}
          onSubmit={() => {
            // Enter → return focus to the select list
            setSearchFocused(false);
            props.onSearchFocusChange?.(false);
          }}
        />
      </box>

      <select
        width="100%"
        height="100%"
        options={filteredOptions}
        selectedIndex={selectedIndex}
        onChange={(index: number) => {
          setSelectedIndex(index);
        }}
        onSelect={(index: number) => {
          const option = filteredOptions[index];
          if (option && option.value) {
            props.onSelect?.(option.value);
            setSearchQuery("");
          }
        }}
        showScrollIndicator={true}
        showDescription={true}

        focused={isFocused && !searchFocused}
        style={{
          selectedColor: theme.colors.highlight,
          selectedBold: true,
          borderColor: theme.colors.primary,
        }}
      />
    </box>
  );
};
