import { render, screen, within } from "@testing-library/react";
import { AppShell } from "./shell";

test("sidebar shows the product name and all nav sections", () => {
  render(
    <AppShell>
      <div>content</div>
    </AppShell>,
  );
  expect(screen.getByText("Knowledge Assistant")).toBeInTheDocument();
  const nav = within(screen.getByRole("navigation", { name: "Sections" }));
  for (const label of [
    "Chat",
    "Documents",
    "Knowledge bases",
    "Analytics",
    "Skills",
    "Settings",
  ]) {
    expect(nav.getByText(label)).toBeInTheDocument();
  }
});

test("only Chat is active; the rest are marked planned", () => {
  render(
    <AppShell>
      <div />
    </AppShell>,
  );
  expect(screen.getAllByText("planned")).toHaveLength(5);
});

test("renders its children in the main area", () => {
  render(
    <AppShell>
      <div>chat goes here</div>
    </AppShell>,
  );
  expect(screen.getByText("chat goes here")).toBeInTheDocument();
});
