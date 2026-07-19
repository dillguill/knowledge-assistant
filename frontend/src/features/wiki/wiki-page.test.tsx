import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { WikiPage } from "./wiki-page";
import * as api from "./api";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test("root view shows folder cards and root pages", async () => {
  vi.spyOn(api, "getTree").mockResolvedValue({
    folders: [
      { id: 1, name: "Guides", parent_id: null, position: 0, created_at: "t" },
    ],
    pages: [
      {
        id: 1,
        folder_id: null,
        title: "Welcome",
        slug: "welcome",
        position: 0,
        updated_at: "2026-07-01",
        last_author: "owner",
      },
    ],
  });
  render(<WikiPage />);
  expect(await screen.findByRole("button", { name: /guides/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /welcome/i })).toBeInTheDocument();
});

test("opening a folder shows a breadcrumb, its subfolders, and its pages with updated-at and author", async () => {
  vi.spyOn(api, "getTree").mockResolvedValue({
    folders: [
      { id: 1, name: "Guides", parent_id: null, position: 0, created_at: "t" },
      { id: 2, name: "Setup", parent_id: 1, position: 0, created_at: "t" },
    ],
    pages: [
      {
        id: 1,
        folder_id: 1,
        title: "Install",
        slug: "install",
        position: 0,
        updated_at: "2026-07-02",
        last_author: "assistant",
      },
    ],
  });
  const user = userEvent.setup();
  render(<WikiPage />);
  await user.click(await screen.findByRole("button", { name: /guides/i }));

  const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
  expect(breadcrumb).toHaveTextContent("Wiki");
  expect(breadcrumb).toHaveTextContent("Guides");
  expect(screen.getByRole("button", { name: /setup/i })).toBeInTheDocument();
  const pageRow = screen.getByRole("button", { name: /install/i });
  expect(pageRow).toHaveTextContent("2026-07-02");
  expect(pageRow).toHaveTextContent("assistant");
});

test("an empty folder shows a plain message to a visitor (no owner token)", async () => {
  vi.spyOn(api, "getTree").mockResolvedValue({
    folders: [{ id: 1, name: "Empty", parent_id: null, position: 0, created_at: "t" }],
    pages: [],
  });
  const user = userEvent.setup();
  render(<WikiPage />);
  await user.click(await screen.findByRole("button", { name: /empty/i }));
  expect(await screen.findByText("Nothing here yet.")).toBeInTheDocument();
});

test("an empty folder shows owner-oriented copy when an owner token is set", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  vi.spyOn(api, "getTree").mockResolvedValue({
    folders: [{ id: 1, name: "Empty", parent_id: null, position: 0, created_at: "t" }],
    pages: [],
  });
  const user = userEvent.setup();
  render(<WikiPage />);
  await user.click(await screen.findByRole("button", { name: /empty/i }));
  expect(
    await screen.findByText(/nothing here yet\. pages and folders you add/i),
  ).toBeInTheDocument();
});

test("opening a page renders its content via WikiMarkdown", async () => {
  vi.spyOn(api, "getTree").mockResolvedValue({
    folders: [],
    pages: [
      {
        id: 1,
        folder_id: null,
        title: "Welcome",
        slug: "welcome",
        position: 0,
        updated_at: "2026-07-01",
        last_author: "owner",
      },
    ],
  });
  vi.spyOn(api, "getPageBySlug").mockResolvedValue({
    id: 1,
    folder_id: null,
    title: "Welcome",
    slug: "welcome",
    position: 0,
    updated_at: "2026-07-01",
    last_author: "owner",
    content: "# Hello wiki",
    last_version: { author: "owner", created_at: "2026-07-01", note: "" },
  });
  const user = userEvent.setup();
  render(<WikiPage />);
  await user.click(await screen.findByRole("button", { name: /welcome/i }));
  expect(await screen.findByRole("heading", { name: "Hello wiki" })).toBeInTheDocument();
});
