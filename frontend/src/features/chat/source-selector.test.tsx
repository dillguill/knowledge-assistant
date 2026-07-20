import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SourceSelector } from "./source-selector";
import {
  SourceSelectionProvider,
  SOURCE_STORAGE_KEY,
  WIKI_SOURCE_STORAGE_KEY,
} from "./source-selection";
import * as api from "@/features/knowledge/api";
import * as wikiApi from "@/features/wiki/api";

// The selector only renders when the backend is online; mock just that hook so
// we exercise the real selection state + persistence without the chat runtime.
vi.mock("./chat-provider", () => ({ useBackend: () => "online" }));

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(wikiApi, "getTree").mockResolvedValue({ folders: [], pages: [] });
});

function renderSelector() {
  return render(
    <SourceSelectionProvider>
      <SourceSelector />
    </SourceSelectionProvider>,
  );
}

test("renders a checkbox per collection and reflects selection in the label", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([
    { id: 1, name: "Garage", file_count: 2 },
    { id: 2, name: "Manuals", file_count: 1 },
  ]);
  const user = userEvent.setup();
  renderSelector();

  await user.click(await screen.findByRole("button", { name: /sources/i }));
  expect(screen.getByRole("checkbox", { name: /Garage/ })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Manuals/ })).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: /Garage/ }));
  expect(
    screen.getByRole("button", { name: /sources: 1/i }),
  ).toBeInTheDocument();
});

test("persists the choice to localStorage", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([
    { id: 1, name: "Garage", file_count: 2 },
  ]);
  const user = userEvent.setup();
  renderSelector();

  await user.click(await screen.findByRole("button", { name: /sources/i }));
  await user.click(screen.getByRole("checkbox", { name: /Garage/ }));

  expect(JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY)!)).toEqual([1]);
});

test("shows a Wiki group listing folder-grouped pages, selectable per page", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([]);
  vi.spyOn(wikiApi, "getTree").mockResolvedValue({
    folders: [{ id: 1, name: "Guides", parent_id: null, position: 0, created_at: "t" }],
    pages: [
      {
        id: 10,
        folder_id: 1,
        title: "Install",
        slug: "install",
        position: 0,
        updated_at: "t",
        last_author: "owner",
      },
      {
        id: 11,
        folder_id: null,
        title: "Welcome",
        slug: "welcome",
        position: 0,
        updated_at: "t",
        last_author: "owner",
      },
    ],
  });
  const user = userEvent.setup();
  renderSelector();

  await user.click(await screen.findByRole("button", { name: /sources/i }));
  const group = screen.getByRole("group", { name: /source collections/i });
  expect(within(group).getByText("Wiki")).toBeInTheDocument();
  expect(within(group).getByText("Guides")).toBeInTheDocument();
  const installCheckbox = within(group).getByRole("checkbox", { name: /Install/ });
  const welcomeCheckbox = within(group).getByRole("checkbox", { name: /Welcome/ });
  expect(installCheckbox).not.toBeChecked();
  expect(welcomeCheckbox).not.toBeChecked();

  await user.click(welcomeCheckbox);
  expect(screen.getByRole("button", { name: /sources: 1/i })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(WIKI_SOURCE_STORAGE_KEY)!)).toEqual([11]);
});

test("selecting a folder toggles all of its pages (client-side expansion to page ids)", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([]);
  vi.spyOn(wikiApi, "getTree").mockResolvedValue({
    folders: [{ id: 1, name: "Guides", parent_id: null, position: 0, created_at: "t" }],
    pages: [
      {
        id: 10,
        folder_id: 1,
        title: "Install",
        slug: "install",
        position: 0,
        updated_at: "t",
        last_author: "owner",
      },
      {
        id: 12,
        folder_id: 1,
        title: "Configure",
        slug: "configure",
        position: 1,
        updated_at: "t",
        last_author: "owner",
      },
    ],
  });
  const user = userEvent.setup();
  renderSelector();

  await user.click(await screen.findByRole("button", { name: /sources/i }));
  const group = screen.getByRole("group", { name: /source collections/i });
  await user.click(within(group).getByRole("checkbox", { name: "Guides" }));

  expect(within(group).getByRole("checkbox", { name: /Install/ })).toBeChecked();
  expect(within(group).getByRole("checkbox", { name: /Configure/ })).toBeChecked();
  expect(JSON.parse(localStorage.getItem(WIKI_SOURCE_STORAGE_KEY)!).sort()).toEqual([10, 12]);

  // Unchecking the folder clears both pages again.
  await user.click(within(group).getByRole("checkbox", { name: "Guides" }));
  expect(within(group).getByRole("checkbox", { name: /Install/ })).not.toBeChecked();
  expect(within(group).getByRole("checkbox", { name: /Configure/ })).not.toBeChecked();
});
