import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * "Create a new wiki page" composer mode. Toggled by the `/` "New page with AI"
 * command and shown as a removable pill above the composer (like the source /
 * target pills). It's a one-shot intent: the next message the user sends is
 * turned into a page-drafting instruction by the chat adapter, which then
 * clears the mode. The state lives both in React (for the pill) and in a
 * module-level ref (so the module-level chat adapter can read + consume it
 * without a React subscription) — the same split used by `targetRef` /
 * `sourceRef`.
 */

export const createPageRef = { current: false };

// Bridges the module-level adapter back to React so consuming the mode also
// clears the pill. No-op if no provider is mounted.
type ClearListener = () => void;
let clearListener: ClearListener | null = null;

/**
 * Reads whether create-page mode is armed and, if so, disarms it (ref + pill).
 * Called once per send by the chat adapter so a single "New page" pill drafts
 * exactly one page and doesn't stick to every subsequent turn.
 */
export function consumeCreatePageMode(): boolean {
  const active = createPageRef.current;
  if (active) {
    createPageRef.current = false;
    clearListener?.();
  }
  return active;
}

const CreatePageModeContext = createContext<{
  active: boolean;
  setActive: (v: boolean) => void;
}>({ active: false, setActive: () => {} });

export function useCreatePageMode() {
  return useContext(CreatePageModeContext);
}

export function CreatePageModeProvider({ children }: { children: ReactNode }) {
  const [active, setState] = useState(false);

  useEffect(() => {
    clearListener = () => setState(false);
    return () => {
      if (clearListener) clearListener = null;
    };
  }, []);

  const setActive = (v: boolean) => {
    createPageRef.current = v;
    setState(v);
  };

  return createElement(
    CreatePageModeContext.Provider,
    { value: { active, setActive } },
    children,
  );
}
