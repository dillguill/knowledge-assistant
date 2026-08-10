import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { TargetPanel } from "./target-panel";
import { SourcePills } from "./source-pills";
import {
  TargetSelectionProvider,
  TARGET_STORAGE_KEY,
  useTargetSelection,
} from "./target-selection";
import * as wikiApi from "@/features/wiki/api";
import * as knowledgeApi from "@/features/knowledge/api";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const page: wikiApi.WikiPage = {
  id: 5,
  folder_id: null,
  title: "Setup",
  slug: "setup",
  position: 0,
  updated_at: "2026-07-01",
  last_author: "owner",
  content: "# Setup steps",
  last_version: null,
};

const summary: wikiApi.WikiPageSummary = {
  id: 5,
  folder_id: null,
  title: "Setup",
  slug: "setup",
  position: 0,
  updated_at: "2026-07-01",
  last_author: "owner",
};

/** The two halves of the target UI as `chat-page.tsx` mounts them. */
function TargetSurface() {
  const { targetPageId, panelOpen } = useTargetSelection();
  return (
    <>
      <SourcePills />
      {targetPageId !== null && panelOpen && <TargetPanel />}
    </>
  );
}

function renderPanel() {
  return render(
    <TargetSelectionProvider>
      <TargetPanel />
    </TargetSelectionProvider>,
  );
}

test("renders nothing when no target page is selected", () => {
  renderPanel();
  expect(screen.queryByLabelText("Target page")).not.toBeInTheDocument();
});

test("picking a target opens the panel and renders the page via WikiMarkdown", async () => {
  localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(5));
  vi.spyOn(wikiApi, "getPage").mockResolvedValue(page);
  renderPanel();

  expect(await screen.findByText("Target: Setup")).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Setup steps" })).toBeInTheDocument();
});

test("a visitor (no owner token) sees no Edit button", async () => {
  localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(5));
  vi.spyOn(wikiApi, "getPage").mockResolvedValue(page);
  renderPanel();

  await screen.findByText("Target: Setup");
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
});

test("an owner can flip to edit (reusing PageEditor) and save", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(5));
  // Saving triggers a refetch (shared `useTargetPage()` refresh-token effect)
  // rather than an optimistic local update, so the second `getPage` call
  // needs to reflect the saved content.
  vi.spyOn(wikiApi, "getPage")
    .mockResolvedValueOnce(page)
    .mockResolvedValue({ ...page, content: "# Updated" });
  const updateSpy = vi.spyOn(wikiApi, "updatePage").mockResolvedValue({
    ...page,
    content: "# Updated",
  });
  const user = userEvent.setup();
  renderPanel();

  await user.click(await screen.findByRole("button", { name: "Edit" }));
  expect(document.querySelector(".cm-content")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("heading", { name: "Updated" })).toBeInTheDocument();
  expect(updateSpy).toHaveBeenCalled();
});

test("clearing the target closes the panel", async () => {
  localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(5));
  vi.spyOn(wikiApi, "getPage").mockResolvedValue(page);
  const user = userEvent.setup();
  renderPanel();

  await screen.findByText("Target: Setup");
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByLabelText("Target page")).not.toBeInTheDocument();
});

test("the panel is a labelled region with a heading, not a bare div", async () => {
  localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(5));
  vi.spyOn(wikiApi, "getPage").mockResolvedValue(page);
  renderPanel();

  // `aria-label` on a role-less <div> has nothing to name; the panel has to
  // be a real complementary landmark for it to mean anything.
  expect(
    await screen.findByRole("complementary", { name: "Target page" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Target: Setup" })).toBeInTheDocument();
});

test("closing the panel keeps the page pinned, and the pill reopens it", async () => {
  localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(5));
  vi.spyOn(wikiApi, "getPage").mockResolvedValue(page);
  vi.spyOn(wikiApi, "getTree").mockResolvedValue({
    folders: [],
    pages: [summary],
  });
  vi.spyOn(knowledgeApi, "listCollections").mockResolvedValue([]);
  const user = userEvent.setup();
  // The pill and the panel are separate components joined only by
  // `TargetSelectionProvider`, so the round trip is only real when both are
  // mounted together — this mirrors `chat-page.tsx`'s wiring.
  render(
    <TargetSelectionProvider>
      <TargetSurface />
    </TargetSelectionProvider>,
  );

  await screen.findByRole("complementary", { name: "Target page" });
  await user.click(screen.getByRole("button", { name: "Close target panel" }));

  // Closing is not unpinning: the panel goes, the target stays, and the
  // composer pill is the way back.
  expect(screen.queryByRole("complementary", { name: "Target page" })).not
    .toBeInTheDocument();
  const pill = await screen.findByRole("button", { name: /^Editing: / });
  await user.click(pill);
  expect(
    await screen.findByRole("complementary", { name: "Target page" }),
  ).toBeInTheDocument();
});
