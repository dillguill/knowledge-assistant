import { beforeEach, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
} from "./settings-storage";

beforeEach(() => localStorage.clear());

test("returns defaults when nothing is stored", () => {
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  expect(loadSettings().theme).toBe("system");
});

test("round-trips saved settings", () => {
  saveSettings({
    theme: "dark",
    defaultModel: "qwen/qwen3-235b:free",
    ownerToken: "tok",
    systemPrompt: "Be brief.",
  });
  expect(loadSettings()).toEqual({
    theme: "dark",
    defaultModel: "qwen/qwen3-235b:free",
    ownerToken: "tok",
    systemPrompt: "Be brief.",
  });
});

test("corrupt JSON falls back to defaults", () => {
  localStorage.setItem(SETTINGS_KEY, "{not json");
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});

test("invalid theme value normalizes to system", () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: "neon" }));
  expect(loadSettings().theme).toBe("system");
});
