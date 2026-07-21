import { createContext, useContext, useState, type ReactNode } from "react";

/** Module-level ref so the non-React chat adapter can read the active flag
 * without a subscription (same pattern as sourceRef / modelRef). */
export const createPageModeRef = { current: false };

const CreatePageModeContext = createContext<{
  active: boolean;
  setActive: (v: boolean) => void;
}>({
  active: false,
  setActive: () => {},
});

export function useCreatePageMode() {
  return useContext(CreatePageModeContext);
}

export function CreatePageModeProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState(false);
  const setActive = (v: boolean) => {
    createPageModeRef.current = v;
    setActiveState(v);
  };
  return (
    <CreatePageModeContext.Provider value={{ active, setActive }}>
      {children}
    </CreatePageModeContext.Provider>
  );
}
