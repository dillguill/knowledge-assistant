import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { FolderOutline } from "./folder-outline";
import { buildWikiTree } from "./tree";
import type { WikiFolder, WikiPageSummary } from "./api";

const folders: WikiFolder[] = [
  { id: 1, name: "Guides", parent_id: null, position: 0, created_at: "t" },
  { id: 2, name: "Setup", parent_id: 1, position: 0, created_at: "t" },
  { id: 3, name: "Other", parent_id: null, position: 1, created_at: "t" },
];

const pages: WikiPageSummary[] = [
  { id: 10, folder_id: null, title: "Welcome", slug: "welcome", position: 0, updated_at: "t", last_author: null },
  { id: 11, folder_id: 1, title: "Overview", slug: "overview", position: 0, updated_at: "t", last_author: null },
  { id: 12, folder_id: 2, title: "Install", slug: "install", position: 0, updated_at: "t", last_author: null },
];

const tree = buildWikiTree(folders, pages);

function renderOutline(folderId: number | null = null) {
  const onNavigateFolder = vi.fn();
  const onNavigatePage = vi.fn();
  render(
    <FolderOutline
      tree={tree}
      folderId={folderId}
      onNavigateFolder={onNavigateFolder}
      onNavigatePage={onNavigatePage}
    />,
  );
  return { onNavigateFolder, onNavigatePage };
}

test("renders the full nested subtree, not just immediate children", () => {
  renderOutline(null);
  const outline = screen.getByRole("navigation", { name: "Folder contents" });
  // Setup and Install are nested two levels deep under the wiki root, but the
  // outline shows the whole subtree at once — no expand/collapse needed.
  for (const label of ["Guides", "Setup", "Other", "Welcome", "Overview", "Install"]) {
    expect(outline).toHaveTextContent(label);
  }
});

test("scopes to the current folder's own subtree when browsing a subfolder", () => {
  renderOutline(1);
  const outline = screen.getByRole("navigation", { name: "Folder contents" });
  expect(outline).toHaveTextContent("Setup");
  expect(outline).toHaveTextContent("Overview");
  expect(outline).toHaveTextContent("Install");
  // Siblings of the current folder (and the root's own page) aren't shown.
  expect(outline).not.toHaveTextContent("Other");
  expect(outline).not.toHaveTextContent("Welcome");
});

test("clicking a folder or page entry navigates", async () => {
  const user = userEvent.setup();
  const { onNavigateFolder, onNavigatePage } = renderOutline(null);

  await user.click(screen.getByText("Setup"));
  expect(onNavigateFolder).toHaveBeenCalledWith(2);

  await user.click(screen.getByText("Install"));
  expect(onNavigatePage).toHaveBeenCalledWith("install");
});

test("renders nothing for an empty folder", () => {
  const { container } = render(
    <FolderOutline
      tree={buildWikiTree([], [])}
      folderId={null}
      onNavigateFolder={vi.fn()}
      onNavigatePage={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});
