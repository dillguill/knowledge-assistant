import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    "Wiki",
    "Documents",
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

test("desktop collapse toggle hides nav labels and persists the choice", async () => {
  const user = userEvent.setup();
  localStorage.removeItem("knowledge-assistant:sidebar-collapsed");
  const { unmount } = render(
    <AppShell>
      <div />
    </AppShell>,
  );
  const toggle = screen.getByRole("button", { name: /collapse sidebar/i });
  await user.click(toggle);
  expect(
    screen.getByRole("navigation", { name: "Sections" }),
  ).toHaveAttribute("data-collapsed", "true");
  expect(localStorage.getItem("knowledge-assistant:sidebar-collapsed")).toBe(
    "true",
  );
  unmount();

  render(
    <AppShell>
      <div />
    </AppShell>,
  );
  expect(
    screen.getByRole("navigation", { name: "Sections" }),
  ).toHaveAttribute("data-collapsed", "true");
});
