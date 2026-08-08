/**
 * Session-global web search mode. The module-level ref mirrors the stored value
 * so the module-level chat adapter can read it without a React subscription —
 * the same split used by `sourceRef` / `targetRef` / `createPageRef`.
 *
 * Defaults to "off" on purpose: searching costs quota and tokens, so it is
 * always an explicit choice.
 */
export const WEB_SEARCH_STORAGE_KEY = "knowledge-assistant:web-search-mode";

export type WebSearchMode = "off" | "on" | "auto";

const MODES: WebSearchMode[] = ["off", "on", "auto"];

export const webSearchRef = { current: "off" as WebSearchMode };

export function loadWebSearchMode(): WebSearchMode {
  try {
    const raw = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
    return MODES.find((m) => m === raw) ?? "off";
  } catch {
    return "off";
  }
}

export function setWebSearchMode(mode: WebSearchMode): void {
  webSearchRef.current = mode;
  try {
    localStorage.setItem(WEB_SEARCH_STORAGE_KEY, mode);
  } catch {
    // Private-mode storage failures must not break the composer; the mode
    // still applies for this session via the ref.
  }
}
