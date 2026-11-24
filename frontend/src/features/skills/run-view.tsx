import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StepRail, type RailStep } from "@/components/assistant-ui/step-rail";
import { cancelRun, getRun, streamRun, type Run, type RunStep } from "./api";
import { applyRunEvent, isTerminal, type RunState } from "./run-state";

/** Plain-language names for the step ids the backend records. The mono kind
 * label beside each one still carries the technical identity, so nothing is
 * hidden — this only decides what a person reads first. Unknown steps fall
 * through to their raw name rather than being dropped. */
const STEP_NAMES: Record<string, string> = {
  plan: "Decided what to look up",
  gather: "Collected sources",
  outline: "Outlined the sections",
  verify: "Checked every claim has a source",
};

const TOOL_NAMES: Record<string, string> = {
  web_search: "Searched the web",
  fetch_url: "Read a page",
  site_map: "Mapped a site",
};

function humanStep(name: string): { kind: string; label: string } {
  if (name.startsWith("tool:")) {
    const tool = name.slice("tool:".length);
    return { kind: `tool · ${tool}`, label: TOOL_NAMES[tool] ?? tool };
  }
  // `draft:2` — the section index is what distinguishes one draft call from
  // the next, so it belongs in the readable name, not just the kind.
  const [base, index] = name.split(":");
  if (base === "draft") {
    return { kind: name, label: index ? `Drafted section ${index}` : "Drafted" };
  }
  return { kind: name, label: STEP_NAMES[base] ?? name };
}

function duration(ms: number | null): string | undefined {
  if (ms === null) return undefined;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function tokenDetail(step: RunStep): string | undefined {
  if (step.tokens_in === null && step.tokens_out === null) return undefined;
  return `${step.tokens_in ?? 0} in / ${step.tokens_out ?? 0} out`;
}

function toRailStep(step: RunStep): RailStep {
  const { kind, label } = humanStep(step.name);
  return {
    id: step.ordinal,
    kind,
    name: label,
    // A step row is only ever running/succeeded/failed — cancelling a run
    // closes its open step as failed, so there is no cancelled case here.
    status: step.status,
    detail: step.error ?? tokenDetail(step),
    duration: duration(step.latency_ms),
  };
}

/** The collapsed line. Says what the run did, not just how many steps it
 * took — a count alone is the least useful thing to leave behind. */
function railSummary(steps: RunStep[]): string {
  const tools = steps.filter((s) => s.name.startsWith("tool:")).length;
  const total = steps.reduce((sum, s) => sum + (s.latency_ms ?? 0), 0);
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} tool ${tools === 1 ? "call" : "calls"}`);
  if (total > 0) parts.push(`${(total / 1000).toFixed(1)}s`);
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

      <StepRail
        steps={steps.map(toRailStep)}
        running={active}
        summary={active ? undefined : railSummary(steps)}
      />

      {run.status === "succeeded" && <Outcome run={run} />}
    </div>
  );
}
