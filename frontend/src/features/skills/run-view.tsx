import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cancelRun, getRun, streamRun, type Run } from "./api";
import { applyRunEvent, isTerminal, type RunState } from "./run-state";

const STATUS_DOT: Record<string, string> = {
  running: "bg-muted-foreground animate-pulse",
  succeeded: "bg-primary",
  failed: "bg-destructive",
};

/** A tool call is recorded as a step named `tool:<name>`; the prefix is the
 * only thing distinguishing it from a model step, and it is the seam the UI
 * pass later replaces with a real assistant-ui tool-call part. */
function stepLabel(name: string): { label: string; isTool: boolean } {
  return name.startsWith("tool:")
    ? { label: name.slice("tool:".length), isTool: true }
    : { label: name, isTool: false };
}

function metrics(step: {
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
}): string {
  const parts: string[] = [];
  if (step.latency_ms !== null) parts.push(`${step.latency_ms}ms`);
  if (step.tokens_in !== null || step.tokens_out !== null) {
    parts.push(`${step.tokens_in ?? 0} in / ${step.tokens_out ?? 0} out`);
  }
  return parts.join(" · ");
}

function Outcome({ run }: { run: Run }) {
  const output = run.output ?? {};
  const title = typeof output.title === "string" ? output.title : null;
  const claims = Array.isArray(output.unsupported_claims)
    ? (output.unsupported_claims as string[])
    : [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium">
        Filed {title ? `“${title}”` : "the brief"} as a wiki proposal for review.
      </p>
      {claims.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase">
            Claims without a cited source
          </p>
          <ul className="mt-1 list-disc space-y-1 ps-5 text-sm">
            {claims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RunView({ runId }: { runId: number }) {
  const [state, setState] = useState<RunState>({ run: null, steps: [] });
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    controller.current = abort;

    void (async () => {
      try {
        const { run, steps } = await getRun(runId);
        if (!live) return;
        setState({ run, steps });
        if (isTerminal(run)) return;
        for await (const event of streamRun(runId, abort.signal)) {
          if (!live) return;
          setState((prev) => applyRunEvent(prev, event));
        }
      } catch (e) {
        if (!live || abort.signal.aborted) return;
        setNotice(e instanceof Error ? e.message : "Could not load that run.");
      }
    })();

    return () => {
      live = false;
      abort.abort();
    };
  }, [runId]);

  const { run, steps } = state;

  async function handleCancel() {
    setCancelling(true);
    setNotice(null);
    try {
      await cancelRun(runId);
    } catch (e) {
      // Losing the race means the run finished on its own — the user got what
      // they wanted, so this is a notice rather than an error.
      setNotice(e instanceof Error ? e.message : "Could not cancel that run.");
    } finally {
      setCancelling(false);
    }
  }

  if (!run) {
    return <Skeleton className="h-24 w-full" />;
  }

  const failed = run.status === "failed";
  const active = !isTerminal(run);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{run.skill}</p>
          <p className="text-xs text-muted-foreground">
            {run.status}
            {run.model ? ` · ${run.model}` : ""}
          </p>
        </div>
        {active && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleCancel()}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>

      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {run.error_message ?? "The run failed."}
          {state.retryAfter ? ` Try again in ~${state.retryAfter}s.` : ""}
        </p>
      )}

      <ol className="flex flex-col gap-1">
        {steps.map((step) => {
          const { label, isTool } = stepLabel(step.name);
          return (
            <li
              key={step.ordinal}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${
                  STATUS_DOT[step.status] ?? "bg-muted-foreground"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {isTool && (
                  <span className="me-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                    tool
                  </span>
                )}
                {label}
              </span>
              {step.status === "running" ? (
                <Skeleton className="h-3 w-20" />
              ) : (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {step.error ?? metrics(step)}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {run.status === "succeeded" && <Outcome run={run} />}
    </div>
  );
}
