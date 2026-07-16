import { cn } from "@/lib/utils";
import { API_URL, useBackend, useModelSelection } from "./chat-provider";
import { ModelSelect } from "./model-select";
import { useModels } from "./use-models";

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
  const { model, setModel } = useModelSelection();
  const models = useModels(status === "online" ? API_URL : null);

  return (
    <div className="ml-auto flex items-center gap-2">
      <ModelSelect models={models} value={model} onChange={setModel} />
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
