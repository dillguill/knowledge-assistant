import { type ReactNode } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * A run's steps as beads on a vertical rail, inside a collapsible box.
 *
 * Shared by the Skills run view and the chat thread because both render the
 * same thing: an ordered sequence of steps, each with a status, a duration,
 * and sometimes a payload worth showing. v0.6.0 records every model call and
 * every tool call as a `skill_run_steps` row precisely so this can be a
 * projection of stored rows rather than a second source of truth.
 *
 * `pending` steps are rendered greyed rather than hidden: the pipeline
 * scheduler declares its full step list before the run starts, so the rail
 * can show where the run is going, which is what makes it read as progress
 * instead of a log. The agent scheduler cannot do that — it discovers steps
 * as it goes — so its callers simply pass no pending steps and the rail grows.
 */

export type StepStatus = "pending" | "running" | "succeeded" | "failed";

export type RailStep = {
  /** Stable identity. `skill_run_steps.ordinal` on the Skills page. */
  id: string | number;
  /** Mono kind label: "plan", "tool · search", "draft". */
  kind?: string;
  /** Plain-language name. The thing a person reads first. */
  name: string;
  status: StepStatus;
  /** One line under the name — what the step found or is doing. */
  detail?: ReactNode;
  /** Verbatim payload (a query, a match list) in mono, scrollable. */
  payload?: string;
  /** Right-aligned, tabular. Pre-formatted by the caller. */
  duration?: string;
};

const BEAD: Record<StepStatus, string> = {
  succeeded: "border-success bg-success",
  running: "border-warning bg-warning",
  failed: "border-destructive bg-destructive",
  pending: "border-border bg-card",
};

/**
 * One node. Exported standalone because the chat thread receives its tool
 * calls as already-rendered children and cannot hand this component a step
 * array — it composes `StepRailBox` + `StepRailNode` directly instead.
 *
 * The connector is a `::after` on the row with `last:after:hidden`, rather
 * than a `last` prop, so a caller that maps over children never has to know
 * which node is final.
 */
export function StepRailNode({
  kind,
  name,
  status,
  detail,
  payload,
  duration,
}: Omit<RailStep, "id">) {
  const muted = status === "pending";
  return (
    <li
      data-status={status}
      className={cn(
        "relative grid grid-cols-[16px_1fr] gap-2.5 pb-3 last:pb-0",
        // Connector to the next bead, tinted once the step has passed so the
        // completed span of the run reads at a glance.
        "after:absolute after:top-4 after:bottom-0 after:left-[7.25px] after:w-0.5 after:bg-border after:content-['']",
        "data-[status=succeeded]:after:bg-success/45 last:after:hidden",
      )}
    >
      <span className="flex justify-center">
        <span
          aria-hidden
          className={cn(
            "relative z-10 mt-1 size-2.5 shrink-0 rounded-full border-2",
            BEAD[status],
            status === "running" && "animate-pulse motion-reduce:animate-none",
          )}
        />
      </span>

      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          {kind && (
            <span
              className={cn(
                "shrink-0 font-mono text-eyebrow text-muted-foreground uppercase",
                muted && "opacity-45",
              )}
            >
              {kind}
            </span>
          )}
          <span className={cn("truncate text-body font-medium", muted && "opacity-45")}>
            {name}
          </span>
          {duration && (
            <span className="ms-auto shrink-0 font-mono text-eyebrow tabular-nums text-muted-foreground">
              {duration}
            </span>
          )}
        </div>
        {detail && <p className="text-meta text-muted-foreground">{detail}</p>}
        {payload && (
          <pre className="mt-0.5 overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-eyebrow text-muted-foreground">
            {payload}
          </pre>
        )}
      </div>
    </li>
  );
}

/** The collapsible shell, without opinions about what fills it. */
export function StepRailBox({
  label,
  summary,
  running,
  failed,
  defaultOpen,
  className,
  children,
}: {
  label: string;
  summary?: string;
  running?: boolean;
  failed?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible
      // Open while it works so the user can watch; closed once finished so a
      // long thread is not a wall of machinery.
      defaultOpen={defaultOpen ?? running}
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <CollapsibleTrigger className="group/rail flex w-full items-center gap-2 px-3 py-2 text-start text-meta text-muted-foreground hover:bg-accent/40">
        {running ? (
          <Loader2
            aria-hidden
            className="size-3 shrink-0 animate-spin text-warning [animation-duration:0.7s] motion-reduce:animate-none"
          />
        ) : failed ? (
          <X aria-hidden className="size-3 shrink-0 text-destructive" />
        ) : (
          <Check aria-hidden className="size-3 shrink-0 text-success" />
        )}
        <span className="text-body font-medium text-foreground">{label}</span>
        {summary && <span className="truncate font-mono text-eyebrow">{summary}</span>}
        <ChevronDown
          aria-hidden
          className="ms-auto size-3 shrink-0 -rotate-90 transition-transform duration-200 ease-emphasis group-data-open/rail:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-closed:animate-collapsible-up data-open:animate-collapsible-down">
        <ol className="flex flex-col border-t border-border/60 px-3 pt-2.5 pb-3">
          {children}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Data-driven convenience wrapper — what a caller holding step rows uses. */
export function StepRail({
  steps,
  running,
  summary,
  defaultOpen,
  className,
}: {
  steps: RailStep[];
  /** Drives the spinner and keeps the box open by default. */
  running?: boolean;
  /** The collapsed line: what the steps proved, not just how many. */
  summary?: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  if (steps.length === 0) return null;

  const done = steps.filter((s) => s.status === "succeeded").length;

  return (
    <StepRailBox
      label={
        running ? "Working" : `${steps.length} step${steps.length === 1 ? "" : "s"}`
      }
      summary={summary ?? (running ? `step ${done + 1} of ${steps.length}` : undefined)}
      running={running}
      failed={steps.some((s) => s.status === "failed")}
      defaultOpen={defaultOpen}
      className={className}
    >
      {steps.map(({ id, ...step }) => (
        <StepRailNode key={id} {...step} />
      ))}
    </StepRailBox>
  );
}
