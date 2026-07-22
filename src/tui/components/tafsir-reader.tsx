import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPreference, setPreference } from "../../data/preferences.ts";
import type { ResourceRow, ResourceTextBlock } from "../../features/resources/repository.ts";
import type { StudySnapshot } from "../../features/study/service.ts";
import { acceptOnlineSources, onlineSourcesAccepted } from "../../features/network/online-source-consent.ts";
import { alignRTL, renderArabicVerse, wrapTerminalWords } from "../utils/rtl.ts";
import { ChoiceDialog, type DialogChoice } from "./choice-dialog.tsx";

const SELECTED_TAFSIR_RESOURCE_KEY = "selectedTafsirResourceId";

interface OpenDialog {
  readonly title: string;
  readonly description: readonly string[];
  readonly choices: readonly DialogChoice[];
  readonly dismissesReader?: boolean;
}

interface TafsirReaderProps {
  readonly verseKey: string;
  readonly onDismiss: () => void;
  readonly openPicker?: boolean;
}

function savedResourceId(): number | undefined {
  const value = Number(getPreference(SELECTED_TAFSIR_RESOURCE_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function deepestErrorMessage(cause: unknown, fallback: string): string {
  let current = cause;
  let message = fallback;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message) message = current.message;
    current = current.cause;
  }
  return message;
}

function displayBlock(block: ResourceTextBlock, width: number): string {
  return block.direction === "rtl"
    ? renderArabicVerse(block.text, 0, width).split("\n").map((line) => alignRTL(line, width)).join("\n")
    : wrapTerminalWords(block.text, width).join("\n");
}

function fallbackBlock(row: ResourceRow, width: number): string {
  const text = row.text ?? "";
  const rtl = row.direction === "rtl" || row.language?.toLocaleLowerCase("en") === "arabic" || /[\u0600-\u06ff]/u.test(text);
  return rtl
    ? renderArabicVerse(text, 0, width).split("\n").map((line) => alignRTL(line, width)).join("\n")
    : wrapTerminalWords(text, width).join("\n");
}

export function TafsirReader({ verseKey, onDismiss, openPicker = false }: TafsirReaderProps) {
  const dimensions = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const clearCachesRef = useRef(new Set<() => void>());
  const [snapshot, setSnapshot] = useState<StudySnapshot | null>(null);
  const [status, setStatus] = useState("Preparing attributed commentary…");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const currentVerseRef = useRef(verseKey);
  currentVerseRef.current = verseKey;

  const load = useCallback(async (key: string, requestedResourceId = savedResourceId()) => {
    requestRef.current?.abort(new Error("Replaced by a newer tafsir request"));
    const controller = new AbortController();
    requestRef.current = controller;
    setSnapshot(null);
    setStatus(`Loading commentary for ${key}…`);
    try {
      let officialFailure: string | null = null;
      try {
        const provider = await import("../../features/study/quran-foundation-tafsir.ts");
        clearCachesRef.current.add(provider.clearQuranFoundationTafsirCache);
        if (provider.hasQuranFoundationCredentials()) {
          const resources = await provider.fetchQuranFoundationTafsirResources("en", { signal: controller.signal });
          const resource = resources.find((candidate) => candidate.id === requestedResourceId
              && candidate.languageName.toLocaleLowerCase("en") === "english")
            ?? resources.find((candidate) => candidate.id === provider.DEFAULT_TAFSIR_RESOURCE_ID)
            ?? resources.find((candidate) => candidate.languageName.toLocaleLowerCase("en") === "english");
          if (!resource) throw new Error("Quran Foundation returned no English tafsir resource");
          const next = await provider.fetchQuranFoundationTafsirSnapshot(resource, key, { signal: controller.signal });
          controller.signal.throwIfAborted();
          if (currentVerseRef.current !== key) return;
          if (resource.id !== requestedResourceId) setPreference(SELECTED_TAFSIR_RESOURCE_KEY, String(resource.id));
          setSnapshot(next);
          setStatus(`${resource.translatedName} · Quran Foundation · W changes tafsir`);
          return;
        }
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        officialFailure = deepestErrorMessage(cause, "The selected Quran Foundation tafsir is unavailable");
      }
      const fallback = await import("../../features/study/open-provider.ts");
      clearCachesRef.current.add(fallback.clearOpenStudyCache);
      const next = await fallback.fetchOpenStudySnapshot(key, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (currentVerseRef.current !== key) return;
      setSnapshot(next);
      setStatus(officialFailure
        ? `${fallback.OPEN_STUDY_PROVIDER.editionName} keyless fallback · ${officialFailure}`
        : `${fallback.OPEN_STUDY_PROVIDER.editionName} · ${fallback.OPEN_STUDY_PROVIDER.name}`);
    } catch (cause) {
      if (controller.signal.aborted || currentVerseRef.current !== key) return;
      setStatus(`${deepestErrorMessage(cause, "Online tafsir is unavailable")} · Esc returns to reading`);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  const chooseResource = useCallback(async function chooseResourceImpl() {
    requestRef.current?.abort(new Error("Opening the tafsir picker"));
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("Loading the English tafsir catalogue…");
    try {
      const provider = await import("../../features/study/quran-foundation-tafsir.ts");
      if (!provider.hasQuranFoundationCredentials()) {
        setDialog({
          title: "Choose tafsir",
          description: [
            "The Quran.com browser proxy needs browser session context, so quran.sh does not copy cookies or call it.",
            "Set QF_CLIENT_ID and QF_CLIENT_SECRET to choose Quran Foundation resources. The keyless Tafsir al-Muyassar fallback remains available.",
          ],
          choices: [{ key: "m", label: "Use Tafsir al-Muyassar", action: () => { setDialog(null); void load(currentVerseRef.current); } }],
        });
        return;
      }
      const resources = (await provider.fetchQuranFoundationTafsirResources("en", { signal: controller.signal }))
        .filter((resource) => resource.languageName.toLocaleLowerCase("en") === "english")
        .sort((left, right) => left.id === provider.DEFAULT_TAFSIR_RESOURCE_ID ? -1 : right.id === provider.DEFAULT_TAFSIR_RESOURCE_ID ? 1 : left.translatedName.localeCompare(right.translatedName));
      controller.signal.throwIfAborted();
      if (resources.length === 0) throw new Error("Quran Foundation returned no English tafsir resources");
      const current = savedResourceId() ?? provider.DEFAULT_TAFSIR_RESOURCE_ID;
      const pageSize = 7;
      const pageCount = Math.ceil(resources.length / pageSize);
      const showPage = (page: number): void => {
        const choices: DialogChoice[] = resources.slice(page * pageSize, (page + 1) * pageSize).map((resource, index) => ({
          key: String(index + 1),
          label: `${resource.id === current ? "Current · " : ""}${resource.translatedName}`,
          detail: resource.authorName ?? resource.name,
          action: () => {
            setPreference(SELECTED_TAFSIR_RESOURCE_KEY, String(resource.id));
            setDialog(null);
            void load(currentVerseRef.current, resource.id);
          },
        }));
        if (page > 0) choices.push({ key: "b", label: "Previous resources", action: () => showPage(page - 1) });
        if (page + 1 < pageCount) choices.push({ key: "n", label: "Next resources", action: () => showPage(page + 1) });
        setDialog({
          title: "Choose tafsir",
          description: [`English resources · page ${page + 1} of ${pageCount} · the selection is saved locally`],
          choices,
        });
      };
      showPage(0);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setDialog({
        title: "Tafsir catalogue unavailable",
        description: [deepestErrorMessage(cause, "The tafsir catalogue is unavailable")],
        choices: [{ key: "r", label: "Retry catalogue", action: () => { setDialog(null); void chooseResourceImpl(); } }, {
          key: "m", label: "Use Tafsir al-Muyassar", action: () => { setDialog(null); void load(currentVerseRef.current); },
        }],
      });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0);
    const begin = (): void => {
      if (openPicker) void chooseResource();
      else void load(verseKey);
    };
    if (onlineSourcesAccepted()) {
      begin();
      return;
    }
    setDialog({
      title: "Online Quran commentary",
      dismissesReader: true,
      description: [
        "Tafsir uses Quran Foundation when you provide developer credentials, with Al Quran Cloud as the keyless fallback.",
        "The provider receives your IP address and requested ayah. quran.sh sends no account data, notes, bookmarks, history, or telemetry.",
        "Commentary is loaded only while this view is open and kept in a bounded memory cache.",
      ],
      choices: [{
        key: "o",
        label: "OK for this session",
        action: () => { acceptOnlineSources(false); setDialog(null); begin(); },
      }, {
        key: "d",
        label: "Don't show again",
        action: () => {
          acceptOnlineSources(true);
          setDialog(null);
          begin();
        },
      }, {
        key: "c",
        label: "Cancel",
        action: onDismiss,
      }],
    });
  }, [chooseResource, load, onDismiss, openPicker, verseKey]);

  useEffect(() => () => {
    requestRef.current?.abort(new Error("Tafsir reader closed"));
    for (const clear of clearCachesRef.current) clear();
    clearCachesRef.current.clear();
  }, []);

  useKeyboard((key) => {
    if (dialog) return;
    if (key.name === "escape" || key.sequence === "w") { key.preventDefault(); key.stopPropagation(); onDismiss(); return; }
    if (key.sequence === "W") { key.preventDefault(); key.stopPropagation(); void chooseResource(); return; }
    if (key.sequence === "r" && !snapshot) { key.preventDefault(); key.stopPropagation(); void load(currentVerseRef.current); return; }
    if (key.sequence === "[") { key.preventDefault(); key.stopPropagation(); scrollRef.current?.scrollBy(-5); }
    if (key.sequence === "]") { key.preventDefault(); key.stopPropagation(); scrollRef.current?.scrollBy(5); }
  });

  const row = snapshot?.tafsir[0];
  const width = Math.max(24, dimensions.width - 8);
  const contentWidth = Math.max(18, width - 6);
  const covered = Array.isArray(row?.raw.coveredVerseKeys) ? row.raw.coveredVerseKeys : [];
  return (
    <box position="absolute" top={1} left={2} width={Math.max(1, dimensions.width - 4)} height={Math.max(1, dimensions.height - 3)} zIndex={170} backgroundColor="#081017" borderStyle="double" borderColor="#d8b45d" flexDirection="column" padding={1} title={` Tafsir · ${verseKey} `} titleAlignment="center">
      <text fg="#7f969d">{`${status} · [/] scroll · W choose · r retry · w/Esc close`}</text>
      <scrollbox ref={scrollRef} flexGrow={1} width="100%" scrollY={true} viewportCulling={true} scrollbarOptions={{ visible: true }}>
        {!row && <text fg="#60727a">{status}</text>}
        {row && (
          <box flexDirection="column">
            <text fg="#d8b45d" attributes={TextAttributes.BOLD}>{typeof row.raw.resourceName === "string" ? row.raw.resourceName : "Tafsir"}</text>
            {covered.length > 1 && <text fg="#60727a">{`Commentary covers ${String(covered[0])}–${String(covered.at(-1))}`}</text>}
            {row.contentBlocks?.length
              ? row.contentBlocks.map((block, index) => <text key={`block-${index}`} fg={block.direction === "rtl" ? "#f2ead8" : "#aeb8b6"} marginBottom={1}>{displayBlock(block, contentWidth)}</text>)
              : <text fg="#aeb8b6">{fallbackBlock(row, contentWidth)}</text>}
            {row.provenance && <text fg="#60727a" wrapMode="char">{`${row.provenance.attribution} · ${row.provenance.license} · ${row.provenance.sourceUrl}`}</text>}
          </box>
        )}
      </scrollbox>
      <ChoiceDialog
        visible={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.description ?? []}
        choices={dialog?.choices ?? []}
        onDismiss={() => {
          const dismissesReader = dialog?.dismissesReader === true;
          setDialog(null);
          if (dismissesReader) onDismiss();
        }}
      />
    </box>
  );
}
