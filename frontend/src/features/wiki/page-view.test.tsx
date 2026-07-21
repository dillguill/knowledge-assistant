import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { WikiPageView } from "./page-view";
import * as api from "./api";
import type { WikiPage } from "./api";
import type { WikiFolderTree } from "./tree";
import { SettingsProvider } from "@/features/settings/settings-provider";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";

const EMPTY_TREE: WikiFolderTree = { roots: [], rootPages: [], byId: new Map() };
const noResolve = () => ({ slug: "", exists: false });

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 1,
    folder_id: null,
    title: "Welcome",
    slug: "welcome",
    position: 0,
    updated_at: "2026-07-01",
    last_author: "owner",
    content: "# Hello",
    last_version: { author: "owner", created_at: "2026-07-01", note: "" },
    ...overrides,
  };
}

function renderPage(overrides: Partial<Parameters<typeof WikiPageView>[0]> = {}) {
  const onNavigateFolder = vi.fn();
  const onNavigatePage = vi.fn();
  const utils = render(
    <SettingsProvider>
      <WikiPageView
        slug="welcome"
        tree={EMPTY_TREE}
        resolve={noResolve}
        onNavigateFolder={onNavigateFolder}
        onNavigatePage={onNavigatePage}
        {...overrides}
      />
    </SettingsProvider>,
  );
  return { ...utils, onNavigateFolder, onNavigatePage };
}

function setOwner() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test("clicking Edit switches to the editor and preserves further typed text", async () => {
  setOwner();
  vi.spyOn(api, "getPageBySlug").mockResolvedValue(makePage({ content: "# Hello" }));
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("button", { name: /^edit$/i }));

  const editor = document.querySelector(".cm-content") as HTMLElement;
  expect(editor).toBeTruthy();
  expect(editor).toHaveTextContent("Hello");

  editor.focus();
  await user.type(editor, "more-unsaved-text");

  expect(editor.textContent).toContain("more-unsaved-text");
  // still in the editor, not bounced back to the rendered view
  expect(document.querySelector(".cm-content")).toBeTruthy();
});

test("Save calls PUT then shows the updated author badge", async () => {
  setOwner();
  vi.spyOn(api, "getPageBySlug")
    .mockResolvedValueOnce(
      makePage({
        content: "old content",
        last_version: { author: "assistant", created_at: "t1", note: "" },
      }),
    )
    .mockResolvedValueOnce(
      makePage({
        content: "new content",
        last_version: { author: "owner", created_at: "t2", note: "" },
      }),
    );
  const updateSpy = vi.spyOn(api, "updatePage").mockResolvedValue(makePage({ content: "new content" }));
  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByText(/edited by assistant/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^edit$/i }));
  const editor = document.querySelector(".cm-content") as HTMLElement;
  editor.focus();
  await user.type(editor, "!");

  await user.click(screen.getByRole("button", { name: /^save$/i }));

  await waitFor(() => expect(updateSpy).toHaveBeenCalled());
  expect(updateSpy.mock.calls[0]?.[0]).toBe(1);
  expect(await screen.findByText(/edited by owner/i)).toBeInTheDocument();
});

test("a visitor (no owner token) sees no Edit button or other write affordances", async () => {
  vi.spyOn(api, "getPageBySlug").mockResolvedValue(makePage());
  renderPage();

  await screen.findByRole("heading", { name: "Welcome" });
  expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^rename$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^move$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
});

test("deleting a page confirms then navigates back to its folder", async () => {
  setOwner();
  vi.spyOn(api, "getPageBySlug").mockResolvedValue(makePage({ folder_id: 7 }));
  const deleteSpy = vi.spyOn(api, "deletePage").mockResolvedValue(undefined);
  const user = userEvent.setup();
  const { onNavigateFolder } = renderPage();

  await user.click(await screen.findByRole("button", { name: /^delete$/i }));
  await user.click(await screen.findByRole("button", { name: /^delete page$/i }));

  await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
  expect(onNavigateFolder).toHaveBeenCalledWith(7);
});

test("Cancel discards the draft and returns to the rendered view", async () => {
  setOwner();
  vi.spyOn(api, "getPageBySlug").mockResolvedValue(makePage({ content: "saved content" }));
  const updateSpy = vi.spyOn(api, "updatePage");
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("button", { name: /^edit$/i }));
  const editor = document.querySelector(".cm-content") as HTMLElement;
  editor.focus();
  await user.type(editor, "throwaway");

  await user.click(screen.getByRole("button", { name: /^cancel$/i }));

  expect(document.querySelector(".cm-content")).not.toBeInTheDocument();
  expect(updateSpy).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: /^edit$/i })).toBeInTheDocument();
});

test("renaming a page saves the new title and refreshes", async () => {
  setOwner();
  vi.spyOn(api, "getPageBySlug")
    .mockResolvedValueOnce(makePage({ title: "Welcome" }))
    .mockResolvedValueOnce(makePage({ title: "Welcome, renamed" }));
  const patchSpy = vi.spyOn(api, "patchPage").mockResolvedValue(makePage({ title: "Welcome, renamed" }));
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("button", { name: /^rename$/i }));
  const input = await screen.findByLabelText("Name");
  await user.clear(input);
  await user.type(input, "Welcome, renamed");
  await user.click(screen.getByRole("button", { name: /^save$/i }));

  await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(1, { title: "Welcome, renamed" }));
  expect(await screen.findByRole("heading", { name: "Welcome, renamed" })).toBeInTheDocument();
});
