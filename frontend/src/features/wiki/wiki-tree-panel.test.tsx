import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { WikiTreePanel } from "./wiki-tree-panel";
import { buildWikiTree } from "./tree";
import type { WikiFolder, WikiPageSummary } from "./api";

const folders: WikiFolder[] = [
  { id: 1, name: "Guides", parent_id: null, position: 0, created_at: "2026-01-01" },
  { id: 2, name: "Setup", parent_id: 1, position: 0, created_at: "2026-01-01" },
];

const pages: WikiPageSummary[] = [
  { id: 10, folder_id: null, title: "Welcome", slug: "welcome", position: 0, updated_at: "2026-01-01", last_author: null },
  { id: 11, folder_id: 1, title: "Overview", slug: "overview", position: 0, updated_at: "2026-01-01", last_author: null },
  { id: 12, folder_id: 2, title: "Install", slug: "install", position: 0, updated_at: "2026-01-01", last_author: null },
];

const tree = buildWikiTree(folders, pages);

beforeEach(() => localStorage.clear());

function renderPanel(overrides: Partial<ComponentProps<typeof WikiTreePanel>> = {}) {
  const onNavigateFolder = vi.fn();
  const onNavigatePage = vi.fn();
  const result = render(
    <WikiTreePanel
      tree={tree}
      activeFolderId={null}
      activeSlug={null}
      onNavigateFolder={onNavigateFolder}
      onNavigatePage={onNavigatePage}
      {...overrides}
    />,
  );
  return { onNavigateFolder, onNavigatePage, unmount: result.unmount };
}

test("renders nested folders and root-level pages", () => {
  renderPanel();
  const nav = screen.getByRole("navigation", { name: "Wiki contents" });
  expect(nav).toBeInTheDocument();
  expect(screen.getByText("Guides")).toBeInTheDocument();
  expect(screen.getByText("Welcome")).toBeInTheDocument();
  // Setup (child of Guides) and Overview/Install (pages inside collapsed
  // folders) aren't shown until their ancestor is expanded.
  expect(screen.queryByText("Setup")).not.toBeInTheDocument();
  expect(screen.queryByText("Overview")).not.toBeInTheDocument();
});

test("clicking a folder's chevron expands it and reveals its children", async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole("button", { name: "Expand Guides" }));
  expect(screen.getByText("Setup")).toBeInTheDocument();
  expect(screen.getByText("Overview")).toBeInTheDocument();
});

test("clicking a page calls onNavigatePage with its slug", async () => {
  const user = userEvent.setup();
  const { onNavigatePage } = renderPanel();
  await user.click(screen.getByText("Welcome"));
  expect(onNavigatePage).toHaveBeenCalledWith("welcome");
});

test("clicking a folder name calls onNavigateFolder with its id", async () => {
  const user = userEvent.setup();
  const { onNavigateFolder } = renderPanel();
  await user.click(screen.getByText("Guides"));
  expect(onNavigateFolder).toHaveBeenCalledWith(1);
});

test("the active page's ancestor chain auto-expands and is highlighted", () => {
  renderPanel({ activeSlug: "install" });
  // Both ancestor folders (Guides, then its child Setup) are expanded.
  expect(screen.getByText("Setup")).toBeInTheDocument();
  expect(screen.getByText("Install")).toBeInTheDocument();
  expect(screen.getByText("Install").closest("button")).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the active folder is highlighted and the wiki root is not", () => {
  renderPanel({ activeFolderId: 1 });
  expect(screen.getByText("Guides").closest("button")).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByText("Wiki")).not.toHaveAttribute("aria-current");
});

test("the wiki root button is active and navigates to null at the wiki root", async () => {
  const user = userEvent.setup();
  const { onNavigateFolder } = renderPanel();
  expect(screen.getByText("Wiki")).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByText("Guides"));
  await user.click(screen.getByText("Wiki"));
  expect(onNavigateFolder).toHaveBeenLastCalledWith(null);
});

test("expand state persists across remounts", async () => {
  const user = userEvent.setup();
  const { unmount } = renderPanel();
  await user.click(screen.getByRole("button", { name: "Expand Guides" }));
  expect(screen.getByText("Setup")).toBeInTheDocument();
  unmount();

  renderPanel();
  expect(screen.getByText("Setup")).toBeInTheDocument();
});

test("renders just the Wiki root when there's nothing else in the tree", () => {
  render(
    <WikiTreePanel
      tree={buildWikiTree([], [])}
      activeFolderId={null}
      activeSlug={null}
      onNavigateFolder={vi.fn()}
      onNavigatePage={vi.fn()}
    />,
  );
  expect(screen.getByText("Wiki")).toBeInTheDocument();
  expect(
    screen.getByRole("navigation", { name: "Wiki contents" }).querySelectorAll("li"),
  ).toHaveLength(0);
});
