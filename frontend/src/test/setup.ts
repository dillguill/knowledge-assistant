import "@testing-library/jest-dom/vitest";

// jsdom lacks these; assistant-ui and Radix components touch them.
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.scrollTo ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
if (typeof globalThis.localStorage === "undefined" || !globalThis.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
    configurable: true,
  });
}
// CodeMirror (wiki editor) measures text via Range.getClientRects/getBoundingClientRect,
// neither of which jsdom implements.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () =>
  ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {},
  }) as DOMRect;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;
