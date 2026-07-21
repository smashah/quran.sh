import { useMemo } from "react";
import { useTheme } from "../theme";
import type { Bookmark } from "../../data/bookmarks";
import type { Cue } from "../../data/cues";
import type { Reflection } from "../../data/reflections";

export type PanelTab = "bookmarks" | "cues" | "reflections";

interface PanelProps {
  bookmarks: Bookmark[];
  cues: Cue[];
  reflections: Reflection[];
  activeTab: PanelTab;
  selectedIndex: number;
  focused: boolean;
}

export function Panel(props: PanelProps) {
  const { theme } = useTheme();

  const currentItems = useMemo(() => {
    if (props.activeTab === "bookmarks") return props.bookmarks;
    if (props.activeTab === "cues") return props.cues;
    return props.reflections;
  }, [props.activeTab, props.bookmarks, props.cues, props.reflections]);

  const tabTitle = (tab: PanelTab, label: string) => {
    const isActive = props.activeTab === tab;
    if (isActive) {
      return `\u25C2 ${label} \u25B8`;
    }
    return `  ${label}  `;
  };

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.colors.background}
    >
      {/* Tab Header */}
      <box
        flexDirection="row"
        justifyContent="space-around"
        borderStyle="single"
        borderColor={theme.colors.border}
        padding={0}
        height={3}
        alignItems="center"
      >
        <text fg={props.activeTab === "bookmarks" ? theme.colors.highlight : theme.colors.muted}>
          {props.activeTab === "bookmarks" ? <strong>{tabTitle("bookmarks", "Bookmarks")}</strong> : tabTitle("bookmarks", "Bookmarks")}
        </text>
        <text fg={props.activeTab === "cues" ? theme.colors.highlight : theme.colors.muted}>
          {props.activeTab === "cues" ? <strong>{tabTitle("cues", "Cues")}</strong> : tabTitle("cues", "Cues")}
        </text>
        <text fg={props.activeTab === "reflections" ? theme.colors.highlight : theme.colors.muted}>
          {props.activeTab === "reflections" ? <strong>{tabTitle("reflections", "Reflections")}</strong> : tabTitle("reflections", "Reflections")}
        </text>
      </box>

      {/* Item List */}
      <scrollbox
        flexGrow={1}
        width="100%"
        scrollY={true}
        scrollbarOptions={{ visible: true }}
        focusable={true}
        focused={props.focused}
        viewportCulling={true}
        backgroundColor={theme.colors.background}
      >
        {currentItems.length === 0 && (
          <box padding={1} justifyContent="center">
            <text fg={theme.colors.muted}>No items found</text>
          </box>
        )}
        {currentItems.map((item, i) => {
          const isSelected = i === props.selectedIndex;
          
          let label: string;
          let subLabel: string | null = null;

          if (props.activeTab === "bookmarks") {
            const b = item as Bookmark;
            label = b.verseRef;
            subLabel = b.label;
          } else if (props.activeTab === "cues") {
            const c = item as Cue;
            label = `Cue ${c.slot}: ${c.verseRef}`;
          } else {
            const r = item as Reflection;
            label = r.verseRef;
            subLabel = r.note.length > 20 ? r.note.substring(0, 17) + "..." : r.note;
          }

          return (
            <box
              key={`${props.activeTab}-${i}`}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={isSelected && props.focused ? theme.colors.border : "transparent"}
            >
              <text fg={isSelected ? theme.colors.highlight : theme.colors.text}>
                {isSelected ? <strong>{`${theme.ornaments.verseMarker} ${label}`}</strong> : `  ${label}`}
              </text>
              {subLabel && (
                <text fg={theme.colors.muted}>
                  {`  ${subLabel}`}
                </text>
              )}
            </box>
          );
        })}
      </scrollbox>

      {/* Footer / Help */}
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.statusBar}>
        <text fg={theme.colors.muted}>
          {"\u2190\u2192 Tab  \u2191\u2193 Item  Ent Jump"}
        </text>
      </box>
    </box>
  );
};
