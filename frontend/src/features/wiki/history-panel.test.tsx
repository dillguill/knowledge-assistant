import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { HistoryPanel } from "./history-panel";
import * as api from "./api";

const noResolve = () => ({ slug: "", exists: false });

beforeEach(() => {
  vi.restoreAllMocks();
});

test("versions render newest-first with author and note badges", async () => {
  vi.spyOn(api, "listVersions").mockResolvedValue([
    { id: 3, author: "owner", note: "third edit", citations: [], created_at: "2026-07-03" },
    { id: 2, author: "assistant", note: "", citations: [], created_at: "2026-07-02" },
    { id: 1, author: "owner", note: "first edit", citations: [], created_at: "2026-07-01" },
  ]);

  render(
    <HistoryPanel
      pageId={1}
      currentContent="current"
      resolve={noResolve}
      isOwner={false}
      onClose={vi.fn()}
      onRestored={vi.fn()}
    />,
  );

  const items = await screen.findAllByRole("button", { name: /owner|assistant/i });
  expect(items).toHaveLength(3);
  expect(within(items[0]!).getByText("third edit")).toBeInTheDocument();
  expect(within(items[0]!).getByText(/^(2w|\d+d) ago$/)).toBeInTheDocument();
  expect(within(items[2]!).getByText("first edit")).toBeInTheDocument();
});

test("selecting a version fetches it and shows a unified diff against current content", async () => {
  vi.spyOn(api, "listVersions").mockResolvedValue([
    { id: 2, author: "owner", note: "", citations: [], created_at: "2026-07-02" },
  ]);
  vi.spyOn(api, "getVersion").mockResolvedValue({
    id: 2,
    author: "owner",
    note: "",
    citations: [],
    created_at: "2026-07-02",
    page_id: 1,
    content: "old line\n",
  });
  const user = userEvent.setup();

  render(
    <HistoryPanel
      pageId={1}
      currentContent={"new line\n"}
      resolve={noResolve}
      isOwner={false}
      onClose={vi.fn()}
      onRestored={vi.fn()}
    />,
  );

  await user.click(await screen.findByRole("button", { name: /owner/i }));

  expect(await screen.findByText("old line")).toBeInTheDocument();
  expect(screen.getByText("new line")).toBeInTheDocument();
  expect(document.querySelector('[data-type="del"]')).toBeInTheDocument();
  expect(document.querySelector('[data-type="add"]')).toBeInTheDocument();
});

test("Restore (owner) POSTs the restore then refetches the version list", async () => {
  const listSpy = vi.spyOn(api, "listVersions").mockResolvedValue([
    { id: 2, author: "owner", note: "", citations: [], created_at: "2026-07-02" },
  ]);
  vi.spyOn(api, "getVersion").mockResolvedValue({
    id: 2,
    author: "owner",
    note: "",
    citations: [],
    created_at: "2026-07-02",
    page_id: 1,
    content: "old line\n",
  });
  const restoreSpy = vi.spyOn(api, "restoreVersion").mockResolvedValue({
    id: 1,
    folder_id: null,
    title: "t",
    slug: "t",
    position: 0,
    updated_at: "x",
    last_author: "owner",
    content: "old line\n",
    last_version: null,
  });
  const onRestored = vi.fn();
  const user = userEvent.setup();

  render(
    <HistoryPanel
      pageId={1}
      currentContent={"new line\n"}
      resolve={noResolve}
      isOwner
      onClose={vi.fn()}
      onRestored={onRestored}
    />,
  );

  await user.click(await screen.findByRole("button", { name: /owner/i }));
  await user.click(await screen.findByRole("button", { name: /restore this version/i }));

  await waitFor(() => expect(restoreSpy).toHaveBeenCalledWith(1, 2));
  await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  expect(onRestored).toHaveBeenCalled();
});

test("a visitor sees no Restore button", async () => {
  vi.spyOn(api, "listVersions").mockResolvedValue([
    { id: 2, author: "owner", note: "", citations: [], created_at: "2026-07-02" },
  ]);
  vi.spyOn(api, "getVersion").mockResolvedValue({
    id: 2,
    author: "owner",
    note: "",
    citations: [],
    created_at: "2026-07-02",
    page_id: 1,
    content: "old\n",
  });
  const user = userEvent.setup();

  render(
    <HistoryPanel
      pageId={1}
      currentContent="new\n"
      resolve={noResolve}
      isOwner={false}
      onClose={vi.fn()}
      onRestored={vi.fn()}
    />,
  );

  await user.click(await screen.findByRole("button", { name: /owner/i }));
  expect(screen.queryByRole("button", { name: /restore this version/i })).not.toBeInTheDocument();
});
