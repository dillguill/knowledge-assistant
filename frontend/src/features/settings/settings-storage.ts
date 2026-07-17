export type ThemeSetting = "light" | "dark" | "system";

export type Settings = {
  theme: ThemeSetting;
  defaultModel: string | null;
  ownerToken: string | null;
  systemPrompt: string | null;
};

export const SETTINGS_KEY = "knowledge-assistant:settings";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  defaultModel: null,
  ownerToken: null,
  systemPrompt: null,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
      defaultModel: typeof p.defaultModel === "string" ? p.defaultModel : null,
      ownerToken: typeof p.ownerToken === "string" ? p.ownerToken : null,
      systemPrompt: typeof p.systemPrompt === "string" ? p.systemPrompt : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
