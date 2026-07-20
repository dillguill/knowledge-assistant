import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

/** Session-global source selection. Per-thread selection is deferred (v0.3.0
 * deviation noted in the plan); this persists one choice across the app. */
export const SOURCE_STORAGE_KEY = "knowledge-assistant:source-collections";
export const WIKI_SOURCE_STORAGE_KEY = "knowledge-assistant:source-wiki-pages";

// Module-level refs so the module-level chat adapter can read the current
// selection without a React subscription (same pattern as modelRef).
export const sourceRef = { current: [] as number[] };
export const wikiSourceRef = { current: [] as number[] };

function loadIds(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is number => typeof x === "number")
      : [];
  } catch {
    return [];
  }
}

const SourceContext = createContext<{
  collectionIds: number[];
  setCollectionIds: (ids: number[]) => void;
  wikiPageIds: number[];
  setWikiPageIds: (ids: number[]) => void;
}>({
  collectionIds: [],
  setCollectionIds: () => {},
  wikiPageIds: [],
  setWikiPageIds: () => {},
});

export function useSourceSelection() {
  return useContext(SourceContext);
}

export function SourceSelectionProvider({ children }: { children: ReactNode }) {
  const [collectionIds, setCollectionState] = useState<number[]>(() => {
    const init = loadIds(SOURCE_STORAGE_KEY);
    sourceRef.current = init;
    return init;
  });
  const [wikiPageIds, setWikiState] = useState<number[]>(() => {
    const init = loadIds(WIKI_SOURCE_STORAGE_KEY);
    wikiSourceRef.current = init;
    return init;
  });
  const setCollectionIds = (ids: number[]) => {
    sourceRef.current = ids;
    localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(ids));
    setCollectionState(ids);
  };
  const setWikiPageIds = (ids: number[]) => {
    wikiSourceRef.current = ids;
    localStorage.setItem(WIKI_SOURCE_STORAGE_KEY, JSON.stringify(ids));
    setWikiState(ids);
  };
  return (
    <SourceContext.Provider
      value={{ collectionIds, setCollectionIds, wikiPageIds, setWikiPageIds }}
    >
      {children}
    </SourceContext.Provider>
  );
}
