import { beforeEach, describe, expect, it } from "vitest";
import {
  WEB_SEARCH_STORAGE_KEY,
  loadWebSearchMode,
  setWebSearchMode,
  webSearchRef,
} from "./web-search-mode";

describe("web search mode", () => {
  beforeEach(() => {
    localStorage.clear();
    webSearchRef.current = "off";
  });

  it("defaults to off", () => {
    expect(loadWebSearchMode()).toBe("off");
  });

  it("persists and mirrors into the module ref", () => {
    setWebSearchMode("auto");
    expect(localStorage.getItem(WEB_SEARCH_STORAGE_KEY)).toBe("auto");
    expect(webSearchRef.current).toBe("auto");
    expect(loadWebSearchMode()).toBe("auto");
  });

  it("falls back to off for an unrecognized stored value", () => {
    localStorage.setItem(WEB_SEARCH_STORAGE_KEY, "nonsense");
    expect(loadWebSearchMode()).toBe("off");
  });

  it("keeps the ref usable when storage throws", () => {
    // Private-mode browsers throw on setItem; the mode must still apply for
    // this session rather than taking the composer down with it.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => setWebSearchMode("on")).not.toThrow();
      expect(webSearchRef.current).toBe("on");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
