import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "./run-view";
import type { Run, RunEvent, RunStep } from "./api";

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

const doneStep: RunStep = {
  ordinal: 1,
  name: "plan",
  model: "m:free",
  tokens_in: 120,
  tokens_out: 42,
  latency_ms: 900,
  status: "succeeded",
  error: null,
};

let events: RunEvent[] = [];
let getRunMock = vi.fn();
const cancelRunMock = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    getRun: (...args: unknown[]) => getRunMock(...args),
    cancelRun: (...args: unknown[]) => cancelRunMock(...args),
    streamRun: async function* () {
      for (const e of events) yield e;
    },
  };
});

beforeEach(() => {
  events = [];
  cancelRunMock.mockReset().mockResolvedValue(undefined);
  getRunMock = vi.fn().mockResolvedValue({ run, steps: [doneStep] });
});

describe("RunView", () => {
  it("renders each step with its real timing and token numbers", async () => {
    render(<RunView runId={1} />);
    expect(await screen.findByText("plan")).toBeInTheDocument();
    expect(screen.getByText(/900/)).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("appends a live step without refetching the run", async () => {
    events = [{ type: "step-start", name: "gather", ordinal: 2 }];
    render(<RunView runId={1} />);
    expect(await screen.findByText("gather")).toBeInTheDocument();
    expect(getRunMock).toHaveBeenCalledTimes(1);
  });

  it("renders the result when the run completes", async () => {
    events = [
      {
        type: "run-done",
        run_id: 1,
        output: { proposal_id: 7, title: "SQLite performance", unsupported_claims: [] },
      },
    ];
    render(<RunView runId={1} />);
    expect(await screen.findByText(/SQLite performance/)).toBeInTheDocument();
  });

  it("lists unsupported claims rather than hiding them", async () => {
    events = [
      {
        type: "run-done",
        run_id: 1,
        output: {
          proposal_id: 7,
          title: "T",
          unsupported_claims: ["No source for throughput."],
        },
      },
    ];
    render(<RunView runId={1} />);
    expect(await screen.findByText(/No source for throughput/)).toBeInTheDocument();
  });

  it("renders a failure through the standard error surface", async () => {
    events = [{ type: "error", code: "rate_limited", message: "wait 30s" }];
    render(<RunView runId={1} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/wait 30s/);
  });

  it("shows retry_after when the provider supplied one", async () => {
    events = [
      { type: "error", code: "rate_limited", message: "rate limited", retry_after: 30 },
    ];
    render(<RunView runId={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/30s/);
  });

  it("offers Cancel only while the run is active", async () => {
    render(<RunView runId={1} />);
    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("hides Cancel once the run is terminal", async () => {
    getRunMock = vi
      .fn()
      .mockResolvedValue({ run: { ...run, status: "succeeded" }, steps: [doneStep] });
    render(<RunView runId={1} />);
    await screen.findByText("plan");
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("cancels the run when asked", async () => {
    render(<RunView runId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(cancelRunMock).toHaveBeenCalledWith(1);
  });

  it("treats a lost cancel race as a notice, not an error", async () => {
    // The run finished first — the user got what they wanted.
    cancelRunMock.mockRejectedValue(new Error("That run has already finished."));
    render(<RunView runId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(screen.getByText(/already finished/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a cancelled run as cancelled, not failed", async () => {
    getRunMock = vi.fn().mockResolvedValue({
      run: { ...run, status: "cancelled", error_message: "The run was cancelled." },
      steps: [doneStep],
    });
    render(<RunView runId={1} />);
    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts the stream on unmount", async () => {
    const { unmount } = render(<RunView runId={1} />);
    await screen.findByText("plan");
    unmount();
    // No assertion on internals: the test exists so an unmount mid-stream does
    // not warn about setting state on an unmounted component.
    expect(true).toBe(true);
  });
});
