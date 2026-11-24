import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { StepRail, type RailStep } from "./step-rail";

const steps: RailStep[] = [
  { id: 1, kind: "plan", name: "Decided what to look up", status: "succeeded", duration: "0.9s" },
  {
    id: 2,
    kind: "tool · search",
    name: "Documents",
    status: "succeeded",
    detail: "4 matches in Demo corpus",
    payload: '"context precision" → eval-methodology.md ×3',
    duration: "1.2s",
  },
  { id: 3, kind: "draft", name: "Write the answer", status: "running" },
  { id: 4, kind: "verify", name: "Check citations", status: "pending" },
];

test("renders nothing when there are no steps", () => {
  const { container } = render(<StepRail steps={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test("a running rail is open, showing every step including what is still ahead", () => {
  render(<StepRail steps={steps} running />);

  expect(screen.getByText("Working")).toBeInTheDocument();
  // Pending steps are rendered, not hidden: the pipeline declares its full
  // step list up front, which is what makes this read as progress.
  expect(screen.getByText("Check citations")).toBeInTheDocument();
  expect(screen.getByText("4 matches in Demo corpus")).toBeInTheDocument();
  expect(
    screen.getByText('"context precision" → eval-methodology.md ×3'),
  ).toBeInTheDocument();
});

test("a finished rail collapses to a summary and reopens on click", async () => {
  const user = userEvent.setup();
  const finished = steps.map((s) => ({ ...s, status: "succeeded" as const }));
  render(<StepRail steps={finished} summary="searched · read 2 sources · 9.1s" />);

  expect(screen.getByText("4 steps")).toBeInTheDocument();
  expect(screen.getByText("searched · read 2 sources · 9.1s")).toBeInTheDocument();
  expect(screen.queryByText("Write the answer")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /4 steps/ }));
  expect(screen.getByText("Write the answer")).toBeInTheDocument();
});

test("the step list is an ordered list, so the sequence carries in the a11y tree", () => {
  render(<StepRail steps={steps} running />);
  expect(screen.getByRole("list")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
});
