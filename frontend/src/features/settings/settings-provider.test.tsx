import { act, render } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { SettingsProvider, useSettings } from "./settings-provider";
import { loadSettings } from "./settings-storage";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

function Probe({
  onReady,
}: {
  onReady: (s: ReturnType<typeof useSettings>) => void;
}) {
  onReady(useSettings());
  return null;
}

function renderWithProbe() {
  let latest: ReturnType<typeof useSettings>;
  render(
    <SettingsProvider>
      <Probe onReady={(s) => (latest = s)} />
    </SettingsProvider>,
  );
  return () => latest!;
}

test("update persists to storage", () => {
  const get = renderWithProbe();
  act(() => get().update("systemPrompt", "Cite everything."));
  expect(loadSettings().systemPrompt).toBe("Cite everything.");
  expect(get().systemPrompt).toBe("Cite everything.");
});

test("theme dark adds the dark class; light removes it", () => {
  const get = renderWithProbe();
  act(() => get().update("theme", "dark"));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  act(() => get().update("theme", "light"));
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("theme system follows matchMedia", () => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("dark"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  const get = renderWithProbe();
  act(() => get().update("theme", "system"));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});
