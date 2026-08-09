import { relativeTime } from "@/lib/time";
import type { Run } from "./api";

const STATUS_TONE: Record<string, string> = {
  succeeded: "text-primary",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
  running: "text-muted-foreground",
  queued: "text-muted-foreground",
};

/** Past runs, newest first. A failed run stays queryable on purpose — history
 * showing what broke beats a run that vanished. */
export function RunHistory({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (id: number) => void;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No runs yet. Starting one will show its progress here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            onClick={() => onOpen(run.id)}
            className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-start hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              {run.skill}
              {typeof run.input?.topic === "string" && (
                <span className="text-muted-foreground"> · {run.input.topic}</span>
              )}
            </span>
            <span
              className={`shrink-0 font-mono text-[11px] ${
                STATUS_TONE[run.status] ?? "text-muted-foreground"
              }`}
            >
              {run.error_code ?? run.status}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(run.created_at)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
