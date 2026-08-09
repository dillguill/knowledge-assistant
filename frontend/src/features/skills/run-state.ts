import type { Run, RunEvent, RunStep } from "./api";

export type RunState = {
  run: Run | null;
  steps: RunStep[];
  retryAfter?: number;
};

function emptyStep(name: string, ordinal: number): RunStep {
  return {
    ordinal,
    name,
    model: null,
    tokens_in: null,
    tokens_out: null,
    latency_ms: null,
    status: "running",
    error: null,
  };
}

/** Which run status an error code implies. Cancelled is deliberately distinct
 * from failed: the user stopped it on purpose, and history should say so
 * rather than implying a defect. */
function statusForError(code: string): Run["status"] {
  return code === "cancelled" ? "cancelled" : "failed";
}

/**
 * Pure fold of a stream event into `{run, steps}`.
 *
 * The same ordinal can arrive twice — the stream replays completed steps
 * before it follows, and a remount re-runs that replay — so applying an event
 * must be idempotent by ordinal. Keeping that here rather than inside an
 * effect makes it a three-line test instead of a rendering puzzle.
 */
export function applyRunEvent(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case "run-start":
      // Only confirms what the initial fetch already told us.
      return state;

    case "step-start": {
      if (state.steps.some((s) => s.ordinal === event.ordinal)) return state;
      const steps = [...state.steps, emptyStep(event.name, event.ordinal)].sort(
        (a, b) => a.ordinal - b.ordinal,
      );
      return { ...state, steps };
    }

    case "step-done": {
      const existing = state.steps.find((s) => s.ordinal === event.ordinal);
      const merged: RunStep = {
        ...(existing ?? emptyStep(event.name, event.ordinal)),
        status: event.status,
        latency_ms: event.latency_ms ?? null,
        tokens_in: event.tokens_in ?? null,
        tokens_out: event.tokens_out ?? null,
        error: event.error ?? null,
      };
      const steps = [
        ...state.steps.filter((s) => s.ordinal !== event.ordinal),
        merged,
      ].sort((a, b) => a.ordinal - b.ordinal);
      return { ...state, steps };
    }

    case "run-done":
      return {
        ...state,
        run: state.run
          ? { ...state.run, status: "succeeded", output: event.output }
          : null,
      };

    case "error":
      return {
        ...state,
        retryAfter: event.retry_after,
        run: state.run
          ? {
              ...state.run,
              status: statusForError(event.code),
              error_code: event.code,
              error_message: event.message,
            }
          : null,
      };

    default:
      return state;
  }
}

export const isTerminal = (run: Run | null): boolean =>
  run !== null && ["succeeded", "failed", "cancelled"].includes(run.status);
