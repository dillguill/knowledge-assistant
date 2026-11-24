import type { ReactNode } from "react";
import {
  KeyRound,
  MessageSquare,
  Palette,
  Server,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { API_URL, useBackend } from "@/features/chat/chat-provider";
import { useModels } from "@/features/chat/use-models";
import { useSettings } from "./settings-provider";
import type { ThemeSetting } from "./settings-storage";

const BACKEND_DEFAULT_MODEL = "__backend_default__";

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const STATUS: Record<string, { label: string; tone: string }> = {
  online: { label: "online", tone: "text-success border-success/35 bg-success/10" },
  waking: { label: "waking", tone: "text-warning border-warning/35 bg-warning/10" },
  offline: {
    label: "offline",
    tone: "text-destructive border-destructive/35 bg-destructive/10",
  },
  demo: { label: "demo mode", tone: "text-muted-foreground border-border" },
};

function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "font-mono text-eyebrow uppercase",
        className ?? "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** A settings group. Cards carry a title, an icon, and one quiet line saying
 * what the group affects — the explanation sits under the heading rather than
 * trailing the controls, so it is read before the thing it describes. */
function Group({
  title,
  icon: Icon,
  hint,
  aside,
  className,
  children,
}: {
  title: string;
  icon: typeof Server;
  hint: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("gap-3 p-4 shadow-raised", className)}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-heading">{title}</h2>
        {aside && <span className="ms-auto">{aside}</span>}
      </div>
      <p className="text-meta text-muted-foreground">{hint}</p>
      {children}
    </Card>
  );
}

/**
 * A control that is designed but not built yet. Rendered disabled with a
 * "planned" badge, matching how `NAV_ITEMS` already marks planned sections —
 * so it reads as a roadmap item rather than a broken toggle. Deliberately
 * inert: `aria-disabled` plus `pointer-events-none` on the switch, and the
 * whole row is dimmed.
 */
function PlannedRow({
  label,
  hint,
  action,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 opacity-60 last:border-b-0">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="text-body font-medium">{label}</span>
          <span className="rounded border border-border px-1.5 font-mono text-eyebrow tracking-wide text-muted-foreground uppercase">
            planned
          </span>
        </span>
        {hint && <span className="text-meta text-muted-foreground">{hint}</span>}
      </span>
      {action ?? (
        <span
          aria-hidden
          className="pointer-events-none h-5 w-9 shrink-0 rounded-full bg-border p-0.5"
        >
          <span className="block size-4 rounded-full bg-card" />
        </span>
      )}
    </div>
  );
}

/** A read-only fact about the current session. Settings pages that only show
 * inputs never tell you where you stand. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-body text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-meta tabular-nums">{value}</span>
    </div>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const status = useBackend();
  const models = useModels(status === "online" ? API_URL : null);
  const state = STATUS[status] ?? STATUS.demo;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-display">Settings</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            Access, model defaults, and appearance. Everything here is stored in
            this browser only.
          </p>
        </header>

        <div className="grid items-start gap-4 md:grid-cols-2">
          <Group
            title="Owner access"
            icon={KeyRound}
            hint="Stored only in this browser. Unlocks uploads, direct wiki edits, and approving proposals; visitors keep read-only access."
            aside={
              <Pill
                className={
                  settings.ownerToken
                    ? "border-success/35 bg-success/10 text-success"
                    : undefined
                }
              >
                {settings.ownerToken ? "token set" : "visitor"}
              </Pill>
            }
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner-token">Owner token</Label>
              <input
                id="owner-token"
                type="password"
                autoComplete="off"
                placeholder="Paste your token"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-meta focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                value={settings.ownerToken ?? ""}
                onChange={(e) =>
                  settings.update("ownerToken", e.target.value || null)
                }
              />
            </div>
          </Group>

          <Group
            title="Backend"
            icon={Server}
            hint="The Space sleeps when idle. The first request after a nap takes 30–60 seconds."
            aside={<Pill className={state.tone}>{state.label}</Pill>}
          >
            <div className="flex flex-col">
              <Fact label="Endpoint" value={API_URL ?? "not configured"} />
              <Fact
                label="Models available"
                value={models.length > 0 ? String(models.length) : "—"}
              />
            </div>
          </Group>

          <Group
            title="Model"
            icon={Sparkles}
            hint="Pre-selected when the app opens. You can still switch models from the chat composer at any time."
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="default-model">Default model</Label>
              <Select
                value={settings.defaultModel ?? BACKEND_DEFAULT_MODEL}
                onValueChange={(v) =>
                  settings.update(
                    "defaultModel",
                    v === BACKEND_DEFAULT_MODEL ? null : v,
                  )
                }
                disabled={models.length === 0}
              >
                <SelectTrigger id="default-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BACKEND_DEFAULT_MODEL}>
                    Backend default
                  </SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Group>

          <Group
            title="Appearance"
            icon={Palette}
            hint="System follows your device preference and updates when it changes."
          >
            <div className="flex flex-col gap-1.5">
              <span className="text-body font-medium">Theme</span>
              <div
                role="radiogroup"
                aria-label="Theme"
                className="inline-flex w-fit overflow-hidden rounded-md border border-border"
              >
                {THEMES.map((t) => (
                  <button
                    key={t.value}
                    role="radio"
                    aria-checked={settings.theme === t.value}
                    onClick={() => settings.update("theme", t.value)}
                    className={cn(
                      "px-3.5 py-2 text-meta font-medium transition-colors duration-200 ease-emphasis",
                      settings.theme === t.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </Group>

          <Group
            title="Chat behaviour"
            icon={MessageSquare}
            hint="Per-message defaults. Today these are chosen in the composer each time; making them stick lives in a later milestone."
          >
            <div className="flex flex-col">
              <PlannedRow
                label="Web search by default"
                hint="Start every thread with search enabled."
              />
              <PlannedRow
                label="Always cite inline"
                hint="Require a citation chip on every claim."
              />
              <PlannedRow
                label="Stream responses"
                hint="Chat already streams; this would make it optional."
              />
            </div>
          </Group>

          <Group
            title="System prompt"
            icon={Sparkles}
            hint="Applies to every conversation. Leave it empty to send no system prompt at all."
            className="md:col-span-2"
          >
            <div className="flex flex-col gap-1.5">
              {/* The card heading is the visible label, so a second one would
                  just repeat it — the accessible name comes from aria-label
                  and keeps the field's user-facing name unchanged. */}
              <textarea
                id="system-prompt"
                aria-label="System prompt"
                rows={6}
                placeholder="e.g. Answer concisely, and always cite the source you used."
                className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-meta focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                value={settings.systemPrompt ?? ""}
                onChange={(e) =>
                  settings.update("systemPrompt", e.target.value || null)
                }
              />
            </div>
          </Group>

          <Group
            title="Danger zone"
            icon={TriangleAlert}
            hint="Destructive actions, kept away from everything else so a click here is always deliberate."
            className="md:col-span-2 border-destructive/30"
            aside={
              <Pill className="border-destructive/35 bg-destructive/10 text-destructive">
                irreversible
              </Pill>
            }
          >
            <div className="flex flex-col">
              <PlannedRow
                label="Clear local chat history"
                hint="Removes threads from this browser. Wiki pages and documents are untouched."
                action={
                  <span className="pointer-events-none shrink-0 rounded-md border border-destructive/35 px-2.5 py-1 text-meta text-destructive">
                    Clear
                  </span>
                }
              />
            </div>
          </Group>
        </div>
      </div>
    </div>
  );
}
