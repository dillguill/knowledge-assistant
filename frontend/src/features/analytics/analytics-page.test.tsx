import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { AnalyticsPage } from "./analytics-page";

test("every panel says which milestone owns it", async () => {
  render(<AnalyticsPage />);

  expect(
    screen.getByRole("group", { name: /Spend by model — not available yet/ }),
  ).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Quality/ }));
  expect(
    screen.getByRole("group", {
      name: /Retrieval quality — not available yet, planned for v0\.7\.0/,
    }),
  ).toBeInTheDocument();
});

test("states no measured figure, because none has been measured", () => {
  const { container } = render(<AnalyticsPage />);
  // Placeholders are shapes, never numbers. A percentage or a cost here would
  // be a fabricated claim about a product that has not measured one.
  expect(container.textContent).not.toMatch(/\d+(\.\d+)?\s*(%|ms|\$)/);
});
