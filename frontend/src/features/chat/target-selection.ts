import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getPage, type WikiPage } from "@/features/wiki/api";

/** Session-global target page selection — one page max, mirrors
 * `source-selection.tsx`'s shape (context + module-level ref so the
 * module-level chat adapter can read the current target without a React
 * subscription, same pattern as `modelRef`/`sourceRef`). */
export const TARGET_STORAGE_KEY = "knowledge-assistant:target-page";

export const targetRef = { current: null as number | null };

function loadTargetId(): number | null {
  try {
    const raw = localStorage.getItem(TARGET_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "number" ? parsed : null;
  } catch {
    return null;
  }
}

// A second, independent module-level pub/sub for "something outside React
// changed and the target panel should refetch" (a chat "target" SSE event
// confirming the pinned page, or Task 16's "Approve now" chaining
// create+approve then needing the panel to pick up the newly-approved
// content). Separate from `targetPageId` itself since the page being
// targeted hasn't changed — only its content might have.
type RefreshListener = () => void;
let refreshListener: RefreshListener | null = null;

/** Bumps the target panel's refresh signal from anywhere. No-op if no panel
 * is currently mounted to listen. */
export function bumpTargetRefresh(): void {
  refreshListener?.();
}

// Module-level bridge so the module-level chat adapter can pin a page as the
// edit target (e.g. after the assistant creates a page) without a React
// handle — same pattern as `wiki-navigation`/`composer-actions`.
type EditTargetListener = (pageId: number) => void;
let editTargetListener: EditTargetListener | null = null;

/** Pins a page as the edit target from outside React. No-op if no provider is
 * mounted to listen. */
export function requestEditTarget(pageId: number): void {
  editTargetListener?.(pageId);
}

export function onEditTargetRequest(fn: EditTargetListener): () => void {
  editTargetListener = fn;
  return () => {
    if (editTargetListener === fn) editTargetListener = null;
  };
}

const TargetContext = createContext<{
  targetPageId: number | null;
  setTargetPageId: (id: number | null) => void;
  refreshToken: number;
}>({ targetPageId: null, setTargetPageId: () => {}, refreshToken: 0 });

export function useTargetSelection() {
  return useContext(TargetContext);
}

export function TargetSelectionProvider({ children }: { children: ReactNode }) {
  const [targetPageId, setState] = useState<number | null>(() => {
    const init = loadTargetId();
    targetRef.current = init;
    return init;
  });
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    refreshListener = () => setRefreshToken((t) => t + 1);
    return () => {
      if (refreshListener) refreshListener = null;
    };
  }, []);

  useEffect(
    () =>
      onEditTargetRequest((id) => {
        targetRef.current = id;
        localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(id));
        setState(id);
      }),
    [],
  );

  const setTargetPageId = (id: number | null) => {
    targetRef.current = id;
    if (id === null) localStorage.removeItem(TARGET_STORAGE_KEY);
    else localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(id));
    setState(id);
  };

  return createElement(
    TargetContext.Provider,
    { value: { targetPageId, setTargetPageId, refreshToken } },
    children,
  );
}

/** Fetches the full content of the currently-targeted page, refetching
 * whenever the target changes or `bumpTargetRefresh()` fires. Shared by
 * `target-panel.tsx` (the visible panel) and `proposal-card.tsx` (needs the
 * current target content to diff a `wiki-update` fence against) so there's
 * one fetch-on-target-change implementation, not two. */
export function useTargetPage(): { targetPageId: number | null; page: WikiPage | null } {
  const { targetPageId, refreshToken } = useTargetSelection();
  const [page, setPage] = useState<WikiPage | null>(null);

  useEffect(() => {
    if (targetPageId === null) {
      setPage(null);
      return;
    }
    let cancelled = false;
    getPage(targetPageId)
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch(() => {
        if (!cancelled) setPage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetPageId, refreshToken]);

  return { targetPageId, page };
}
