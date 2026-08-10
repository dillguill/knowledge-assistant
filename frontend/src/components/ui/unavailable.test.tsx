import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Unavailable } from "./unavailable";

test("says it is unavailable in text, not only in texture", () => {
  render(
    <Unavailable title="Cost per run" milestone="v0.8.0" note="Spend by model.">
      <button>Export</button>
    </Unavailable>,
  );

  expect(screen.getByText("Cost per run")).toBeInTheDocument();
  expect(screen.getByText("v0.8.0")).toBeInTheDocument();
  // The diagonal hatch is decorative; the group's label is what a screen
  // reader gets, so the state has to survive without the visuals.
  expect(
    screen.getByRole("group", {
      name: /Cost per run — not available yet, planned for v0\.8\.0/,
    }),
  ).toBeInTheDocument();
});

test("nothing inside is operable", () => {
  render(
    <Unavailable title="Cost per run">
      <button>Export</button>
    </Unavailable>,
  );

  // `inert` removes the subtree from the a11y tree, so a placeholder control
  // is never offered to a keyboard or screen-reader user at all.
  expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
});

test("omits the milestone when the work is genuinely unscheduled", () => {
  render(
    <Unavailable title="Retrieval quality">
      <span>x</span>
    </Unavailable>,
  );

  expect(
    screen.getByRole("group", { name: "Retrieval quality — not available yet" }),
  ).toBeInTheDocument();
});
