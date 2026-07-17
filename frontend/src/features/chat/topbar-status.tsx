import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/features/settings/theme-toggle";
import { useBackend } from "./chat-provider";

const STATUS_LABELS = {
  demo: "demo mode",
  waking: "waking backend…",
  online: "online",
  offline: "backend offline",
} as const;

const STATUS_STYLES = {
  demo: "text-muted-foreground",
  waking: "text-amber-600 dark:text-amber-400 animate-pulse motion-reduce:animate-none",
  online: "text-emerald-600 dark:text-emerald-400",
  offline: "text-destructive",
} as const;

export function TopbarStatus() {
  const status = useBackend();

  return (
    <div className="ml-auto flex items-center gap-2">
      <ThemeToggle />
      <span
        className={cn(
          "rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] tracking-wide uppercase",
          STATUS_STYLES[status],
        )}
      >
        {STATUS_LABELS[status]}
      </span>
    </div>
  );
}
