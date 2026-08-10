import { describe, expect, it } from "vitest";
import { applyRunEvent, type RunState } from "./run-state";
import type { Run, RunEvent } from "./api";

const run = {
  id: 1,
  skill: "research_brief",
  scheduler: "pipeline",
  model: "m:free",
  status: "running",
  input: { topic: "sqlite performance" },
  output: null,
  error_code: null,
  error_message: null,
  created_at: "2026-08-09T00:00:00",
  started_at: "2026-08-09T00:00:01",
  finished_at: null,
} satisfies Run;

const base: RunState = { run, steps: [] };

const apply = (state: RunState, ...events: RunEvent[]) =>
  events.reduce(applyRunEvent, state);

describe("applyRunEvent", () => {
  it("applies a step-start as a running step", () => {
    const next = apply(base, { type: "step-start", name: "plan", ordinal: 1 });
    expect(next.steps).toHaveLength(1);
    expect(next.steps[0]).toMatchObject({ name: "plan", status: "running" });
  });

  it("replaces a running step when its step-done arrives", () => {
    const next = apply(
      base,
      { type: "step-start", name: "plan", ordinal: 1 },
      {
        type: "step-done",
        name: "plan",
        ordinal: 1,
        status: "succeeded",
        latency_ms: 900,
        tokens_out: 42,
      },
    );
    expect(next.steps).toHaveLength(1);
    expect(next.steps[0]).toMatchObject({
      status: "succeeded",
      latency_ms: 900,
      tokens_out: 42,
    });
  });

  it("ignores a duplicate ordinal, so a reconnect's replay does not double the list", () => {
    // The stream replays completed steps before it follows, and a remount
    // re-runs that replay — applying an event must be idempotent by ordinal.
    const next = apply(
      base,
      { type: "step-start", name: "plan", ordinal: 1 },
      { type: "step-start", name: "plan", ordinal: 1 },
    );
    expect(next.steps).toHaveLength(1);
  });

  it("keeps steps sorted by ordinal regardless of arrival order", () => {
    const next = apply(
      base,
      { type: "step-start", name: "gather", ordinal: 2 },
      { type: "step-start", name: "plan", ordinal: 1 },
    );
    expect(next.steps.map((s) => s.name)).toEqual(["plan", "gather"]);
  });

  it("marks the run succeeded and stores the output on run-done", () => {
    const next = apply(base, {
      type: "run-done",
      run_id: 1,
      output: { proposal_id: 7 },
    });
    expect(next.run?.status).toBe("succeeded");
    expect(next.run?.output).toEqual({ proposal_id: 7 });
  });

  it("marks the run failed on an error event, keeping every completed step", () => {
    const next = apply(
      base,
      { type: "step-start", name: "plan", ordinal: 1 },
      { type: "step-done", name: "plan", ordinal: 1, status: "succeeded" },
      { type: "error", code: "rate_limited", message: "wait 30s" },
    );
    expect(next.run?.status).toBe("failed");
    expect(next.run?.error_code).toBe("rate_limited");
    // History has to show how far it got.
    expect(next.steps).toHaveLength(1);
  });

  it("distinguishes a cancelled run from a failed one", () => {
    const next = apply(base, {
      type: "error",
      code: "cancelled",
      message: "The run was cancelled.",
    });
    expect(next.run?.status).toBe("cancelled");
  });

  it("carries retry_after through, since a mid-run 429 is the expected failure", () => {
    const next = apply(base, {
      type: "error",
      code: "rate_limited",
      message: "wait",
      retry_after: 30,
    });
    expect(next.retryAfter).toBe(30);
  });

  it("ignores run-start, which only confirms what the fetch already told us", () => {
    const next = apply(base, {
      type: "run-start",
      run_id: 1,
      skill: "research_brief",
    });
    expect(next).toEqual(base);
  });

  it("survives events arriving before the run record has loaded", () => {
    const next = apply({ run: null, steps: [] }, {
      type: "step-start",
      name: "plan",
      ordinal: 1,
    });
    expect(next.steps).toHaveLength(1);
    expect(next.run).toBeNull();
  });
});
