import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

/** Session-global source selection. Per-thread selection is deferred (v0.3.0
 * deviation noted in the plan); this persists one choice across the app. */
export const SOURCE_STORAGE_KEY = "knowledge-assistant:source-collections";

// Module-level ref so the module-level chat adapter can read the current
// selection without a React subscription (same pattern as modelRef).
export const sourceRef = { current: [] as number[] };

function loadSourceIds(): number[] {
  try {
    const raw = localStorage.getItem(SOURCE_STORAGE_KEY);
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
}>({ collectionIds: [], setCollectionIds: () => {} });

export function useSourceSelection() {
  return useContext(SourceContext);
}

export function SourceSelectionProvider({ children }: { children: ReactNode }) {
  const [collectionIds, setState] = useState<number[]>(() => {
    const init = loadSourceIds();
    sourceRef.current = init;
    return init;
  });
  const setCollectionIds = (ids: number[]) => {
    sourceRef.current = ids;
    localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(ids));
    setState(ids);
  };
  return (
    <SourceContext.Provider value={{ collectionIds, setCollectionIds }}>
      {children}
    </SourceContext.Provider>
  );
}
