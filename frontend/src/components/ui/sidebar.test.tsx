import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Sidebar, SidebarProvider, useSidebar } from "./sidebar";

/**
 * Covers the one local modification to this vendored shadcn file:
 * `enableKeyboardShortcut`. The Target panel nests a second provider inside
 * the shell's, and `SidebarProvider` registers ⌘B as a bare window listener —
 * so without the opt-out both providers answer the same keypress.
 */

function State({ label }: { label: string }) {
  const { state } = useSidebar();
  return <span>{`${label}:${state}`}</span>;
}

test("⌘B toggles a provider that enables the shortcut", async () => {
  const user = userEvent.setup();
  render(
    <SidebarProvider>
      <Sidebar>
        <State label="outer" />
      </Sidebar>
    </SidebarProvider>,
  );

  expect(screen.getByText("outer:expanded")).toBeInTheDocument();
  await user.keyboard("{Meta>}b{/Meta}");
  expect(screen.getByText("outer:collapsed")).toBeInTheDocument();
});

test("a nested provider that opts out leaves ⌘B to the outer one", async () => {
  const user = userEvent.setup();
  render(
    <SidebarProvider>
      <Sidebar>
        <State label="outer" />
      </Sidebar>
      <SidebarProvider enableKeyboardShortcut={false}>
        <Sidebar side="right">
          <State label="inner" />
        </Sidebar>
      </SidebarProvider>
    </SidebarProvider>,
  );

  expect(screen.getByText("outer:expanded")).toBeInTheDocument();
  expect(screen.getByText("inner:expanded")).toBeInTheDocument();

  await user.keyboard("{Meta>}b{/Meta}");

  // Only the outer sidebar responds. Before `enableKeyboardShortcut` both
  // providers had a live listener and one keypress collapsed both.
  expect(screen.getByText("outer:collapsed")).toBeInTheDocument();
  expect(screen.getByText("inner:expanded")).toBeInTheDocument();
});
