import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AppShell } from "./shell";

function renderShell(children: React.ReactNode = <div>content</div>) {
  return render(
    <AppShell title="Chat" active="chat" onNavigate={vi.fn()}>
      {children}
    </AppShell>,
  );
}

test("sidebar shows the product name and all nav sections", () => {
  renderShell();
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

test("Chat and Settings are real destinations; the rest are marked planned", () => {
  renderShell(<div />);
  expect(screen.getAllByText("planned")).toHaveLength(4);
});

test("renders its children in the main area", () => {
  renderShell(<div>chat goes here</div>);
  expect(screen.getByText("chat goes here")).toBeInTheDocument();
});

test("clicking a non-planned nav item calls onNavigate", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  render(
    <AppShell title="Chat" active="chat" onNavigate={onNavigate}>
      <div />
    </AppShell>,
  );
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(onNavigate).toHaveBeenCalledWith("settings");
});

test("desktop collapse toggle hides nav labels and persists the choice", async () => {
  const user = userEvent.setup();
  localStorage.removeItem("knowledge-assistant:sidebar-collapsed");
  const { unmount } = renderShell(<div />);
  const toggle = screen.getByRole("button", { name: /collapse sidebar/i });
  await user.click(toggle);
  expect(
    screen.getByRole("navigation", { name: "Sections" }),
  ).toHaveAttribute("data-collapsed", "true");
  expect(localStorage.getItem("knowledge-assistant:sidebar-collapsed")).toBe(
    "true",
  );
  unmount();

  renderShell(<div />);
  expect(
    screen.getByRole("navigation", { name: "Sections" }),
  ).toHaveAttribute("data-collapsed", "true");
});
