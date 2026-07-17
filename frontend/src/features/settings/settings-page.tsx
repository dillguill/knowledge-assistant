import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { API_URL, useBackend } from "@/features/chat/chat-provider";
import { useModels } from "@/features/chat/use-models";
import { useSettings } from "./settings-provider";
import type { ThemeSetting } from "./settings-storage";

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function Section({
  heading,
  hint,
  children,
}: {
  heading: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">{heading}</h2>
      {children}
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </section>
  );
}

const inputClass =
  "w-full max-w-sm rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function SettingsPage() {
  const settings = useSettings();
  const status = useBackend();
  const models = useModels(status === "online" ? API_URL : null);

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          App preferences and the global system prompt. Changes save
          automatically to this browser.
        </p>

        <Section heading="Theme" hint="System follows your device preference.">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="inline-flex overflow-hidden rounded-md border border-border"
          >
            {THEMES.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-checked={settings.theme === t.value}
                onClick={() => settings.update("theme", t.value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium",
                  settings.theme === t.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section
          heading="Default model"
          hint="Pre-selected when the app opens. You can still switch models from the chat composer anytime."
        >
          <label htmlFor="default-model" className="sr-only">
            Default model
          </label>
          <select
            id="default-model"
            className={inputClass}
            disabled={models.length === 0}
            value={settings.defaultModel ?? ""}
            onChange={(e) =>
              settings.update("defaultModel", e.target.value || null)
            }
          >
            <option value="">Backend default</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Section>

        <Section
          heading="System prompt"
          hint="Applies to all conversations. Leave empty to send no system prompt."
        >
          <label htmlFor="system-prompt" className="sr-only">
            System prompt
          </label>
          <textarea
            id="system-prompt"
            rows={6}
            className={cn(inputClass, "max-w-full font-mono text-xs")}
            value={settings.systemPrompt ?? ""}
            onChange={(e) =>
              settings.update("systemPrompt", e.target.value || null)
            }
          />
        </Section>

        <Section
          heading="Owner token"
          hint="Stored only in this browser. Unlocks uploads and wiki approvals starting v0.3.0."
        >
          <label htmlFor="owner-token" className="sr-only">
            Owner token
          </label>
          <input
            id="owner-token"
            type="password"
            autoComplete="off"
            className={inputClass}
            value={settings.ownerToken ?? ""}
            onChange={(e) =>
              settings.update("ownerToken", e.target.value || null)
            }
          />
        </Section>
      </div>
    </div>
  );
}
