import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useScrollSpy } from "./use-scroll-spy";

type ObserveEntry = { target: Element; isIntersecting: boolean };

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: (entries: ObserveEntry[]) => void;
  observed: Element[] = [];

  constructor(callback: (entries: ObserveEntry[]) => void) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  document.body.innerHTML = "";
});

afterEach(() => vi.unstubAllGlobals());

function addHeading(id: string): HTMLElement {
  const el = document.createElement("h2");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function latestObserver(): MockIntersectionObserver {
  return MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];
}

test("returns null when there are no heading ids", () => {
  const { result } = renderHook(() => useScrollSpy([]));
  expect(result.current).toBeNull();
});

test("observes every element matching the given ids", () => {
  const a = addHeading("a");
  const b = addHeading("b");
  renderHook(() => useScrollSpy(["a", "b"]));
  expect(latestObserver().observed).toEqual([a, b]);
});

test("becomes active once its heading crosses the detection band", () => {
  addHeading("a");
  addHeading("b");
  const { result } = renderHook(() => useScrollSpy(["a", "b"]));
  const observer = latestObserver();

  act(() => {
    observer.callback([{ target: document.getElementById("a")!, isIntersecting: true }]);
  });
  expect(result.current).toBe("a");

  act(() => {
    observer.callback([
      { target: document.getElementById("a")!, isIntersecting: false },
      { target: document.getElementById("b")!, isIntersecting: true },
    ]);
  });
  expect(result.current).toBe("b");
});

test("prefers the earliest id (in given order) among simultaneously visible headings", () => {
  addHeading("a");
  addHeading("b");
  const { result } = renderHook(() => useScrollSpy(["a", "b"]));
  const observer = latestObserver();

  act(() => {
    observer.callback([
      { target: document.getElementById("a")!, isIntersecting: true },
      { target: document.getElementById("b")!, isIntersecting: true },
    ]);
  });
  expect(result.current).toBe("a");
});

test("keeps the last active id once every heading has scrolled past", () => {
  addHeading("a");
  const { result } = renderHook(() => useScrollSpy(["a"]));
  const observer = latestObserver();

  act(() => observer.callback([{ target: document.getElementById("a")!, isIntersecting: true }]));
  expect(result.current).toBe("a");

  act(() => observer.callback([{ target: document.getElementById("a")!, isIntersecting: false }]));
  expect(result.current).toBe("a");
});

test("disconnects the observer on unmount", () => {
  addHeading("a");
  const { unmount } = renderHook(() => useScrollSpy(["a"]));
  const disconnect = vi.spyOn(latestObserver(), "disconnect");
  unmount();
  expect(disconnect).toHaveBeenCalled();
});
