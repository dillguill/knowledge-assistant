import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { SettingsProvider } from "./settings-provider";
import { ThemeToggle } from "./theme-toggle";
import { loadSettings } from "./settings-storage";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

test("toggle flips the effective theme and persists it", async () => {
  const user = userEvent.setup();
  render(
    <SettingsProvider>
      <ThemeToggle />
    </SettingsProvider>,
  );
  const btn = screen.getByRole("button", { name: /toggle light\/dark theme/i });
  // setup.ts polyfill: matchMedia.matches === false → "system" resolves to light
  await user.click(btn);
  expect(loadSettings().theme).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await user.click(btn);
  expect(loadSettings().theme).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});
