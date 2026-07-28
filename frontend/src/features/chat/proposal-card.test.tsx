import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import {
  CreatePageCard,
  ProposalCard,
  DraftingProposalPlaceholder,
} from "./proposal-card";
import * as wikiApi from "@/features/wiki/api";
import * as targetSelection from "./target-selection";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";

const targetPage: wikiApi.WikiPage = {
  id: 5,
  folder_id: 2,
  title: "Setup",
  slug: "setup",
  position: 0,
  updated_at: "2026-07-01",
  last_author: "owner",
  content: "old line\n",
  last_version: null,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("shows the compact drafting placeholder while the fence is still streaming", () => {
  render(<DraftingProposalPlaceholder />);
  expect(screen.getByText(/drafting page update/i)).toBeInTheDocument();
});

test("renders a diff of the proposed content against the current target page content", () => {
  render(<ProposalCard content={"new line\n"} targetPage={targetPage} />);
  expect(screen.getByText("old line")).toBeInTheDocument();
  expect(screen.getByText("new line")).toBeInTheDocument();
  expect(document.querySelector('[data-type="del"]')).toBeInTheDocument();
  expect(document.querySelector('[data-type="add"]')).toBeInTheDocument();
});

test("Propose posts page_id/title/folder_id/content and citations from the message's sources", async () => {
  const createSpy = vi.spyOn(wikiApi, "createProposal").mockResolvedValue({
    id: 42,
    page_id: 5,
    proposal_number: 3,
    title: "Setup",
    folder_id: 2,
    base_version_id: null,
    content: "new line\n",
    rationale: "",
    citations: [],
    status: "pending",
    created_at: "t",
    decided_at: null,
  });
  const user = userEvent.setup();
  const citations = [{ id: 3, label: "S1", filename: "manual.pdf" }];
  render(<ProposalCard content={"new line\n"} targetPage={targetPage} citations={citations} />);

  await user.click(screen.getByRole("button", { name: "Propose" }));

  expect(createSpy).toHaveBeenCalledWith({
    page_id: 5,
    title: "Setup",
    folder_id: 2,
    content: "new line\n",
    citations,
  });
  // Shows the per-page proposal number (3), not the global DB id (42).
  expect(await screen.findByText("proposal #3 submitted")).toBeInTheDocument();
});

test("citations default to an empty array when the message had no sources event", async () => {
  const createSpy = vi.spyOn(wikiApi, "createProposal").mockResolvedValue({
    id: 1,
    page_id: 5,
    proposal_number: 1,
    title: "Setup",
    folder_id: 2,
    base_version_id: null,
    content: "new line\n",
    rationale: "",
    citations: [],
    status: "pending",
    created_at: "t",
    decided_at: null,
  });
  const user = userEvent.setup();
  render(<ProposalCard content={"new line\n"} targetPage={targetPage} />);
  await user.click(screen.getByRole("button", { name: "Propose" }));
  expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ citations: [] }));
});

test("a 429 (queue full) response surfaces the queue-full copy", async () => {
  vi.spyOn(wikiApi, "createProposal").mockRejectedValue(
    new Error("Rate limited — wait a moment and retry."),
  );
  const user = userEvent.setup();
  render(<ProposalCard content={"new line\n"} targetPage={targetPage} />);
  await user.click(screen.getByRole("button", { name: "Propose" }));
  expect(await screen.findByText(/proposal queue is full/i)).toBeInTheDocument();
});

test("a visitor (no owner token) sees no Approve now button", () => {
  render(<ProposalCard content={"new line\n"} targetPage={targetPage} />);
  expect(screen.queryByRole("button", { name: "Approve now" })).not.toBeInTheDocument();
});

test("owner Approve now chains create then approve, and refreshes the target panel", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const createSpy = vi.spyOn(wikiApi, "createProposal").mockResolvedValue({
    id: 7,
    page_id: 5,
    proposal_number: 2,
    title: "Setup",
    folder_id: 2,
    base_version_id: null,
    content: "new line\n",
    rationale: "",
    citations: [],
    status: "pending",
    created_at: "t",
    decided_at: null,
  });
  const approveSpy = vi.spyOn(wikiApi, "approveProposal").mockResolvedValue({
    ...targetPage,
    content: "new line\n",
  });
  const bumpSpy = vi.spyOn(targetSelection, "bumpTargetRefresh").mockImplementation(() => {});
  const user = userEvent.setup();
  render(<ProposalCard content={"new line\n"} targetPage={targetPage} />);

  await user.click(screen.getByRole("button", { name: "Approve now" }));

  // Displays the per-page number (2); approve still targets the DB id (7).
  expect(await screen.findByText("proposal #2 approved")).toBeInTheDocument();
  expect(createSpy).toHaveBeenCalled();
  expect(approveSpy).toHaveBeenCalledWith(7);
  expect(bumpSpy).toHaveBeenCalled();
});

test("Dismiss removes the card without calling any API", async () => {
  const createSpy = vi.spyOn(wikiApi, "createProposal");
  const user = userEvent.setup();
  render(<ProposalCard content={"new line\n"} targetPage={targetPage} />);

  await user.click(screen.getByRole("button", { name: "Dismiss" }));

  expect(screen.queryByText(/proposed wiki update/i)).not.toBeInTheDocument();
  expect(createSpy).not.toHaveBeenCalled();
});

// --- CreatePageCard (new-page draft) ---

const createDraft = {
  title: "Homelab Guide",
  content: "# Homelab Guide\n\nStart here.",
  folderId: null,
};

const newPageProposal: wikiApi.WikiProposal = {
  id: 11,
  page_id: null,
  proposal_number: 1,
  title: "Homelab Guide",
  folder_id: null,
  base_version_id: null,
  content: "# Homelab Guide\n\nStart here.",
  rationale: "",
  citations: [],
  status: "pending",
  created_at: "t",
  decided_at: null,
};

test("CreatePageCard previews the drafted page title and content", () => {
  render(<CreatePageCard data={createDraft} />);
  expect(screen.getByText("New page draft: Homelab Guide")).toBeInTheDocument();
  // The drafted markdown is previewed (heading rendered).
  expect(
    screen.getByRole("heading", { name: "Homelab Guide" }),
  ).toBeInTheDocument();
});

test("a visitor (no owner token) can only Propose the new page (page_id null)", async () => {
  const createSpy = vi
    .spyOn(wikiApi, "createProposal")
    .mockResolvedValue({ ...newPageProposal, proposal_number: 2 });
  const user = userEvent.setup();
  render(<CreatePageCard data={createDraft} citations={[{ id: 1 }]} />);

  expect(screen.queryByRole("button", { name: "Create page" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Propose page" }));

  expect(createSpy).toHaveBeenCalledWith({
    page_id: null,
    title: "Homelab Guide",
    folder_id: null,
    content: "# Homelab Guide\n\nStart here.",
    citations: [{ id: 1 }],
  });
  expect(await screen.findByText("proposal #2 submitted")).toBeInTheDocument();
});

test("an owner Create page chains create then approve and reports the page created", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const createSpy = vi
    .spyOn(wikiApi, "createProposal")
    .mockResolvedValue(newPageProposal);
  const approveSpy = vi.spyOn(wikiApi, "approveProposal").mockResolvedValue({
    id: 99,
    folder_id: null,
    title: "Homelab Guide",
    slug: "homelab-guide",
    position: 0,
    updated_at: "t",
    last_author: "owner",
    content: "# Homelab Guide\n\nStart here.",
    last_version: null,
  });
  const user = userEvent.setup();
  render(<CreatePageCard data={createDraft} />);

  await user.click(screen.getByRole("button", { name: "Create page" }));

  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({ page_id: null, title: "Homelab Guide" }),
  );
  expect(approveSpy).toHaveBeenCalledWith(11);
  expect(await screen.findByText("page created")).toBeInTheDocument();
});

test("CreatePageCard Dismiss removes the card without calling any API", async () => {
  const createSpy = vi.spyOn(wikiApi, "createProposal");
  const user = userEvent.setup();
  render(<CreatePageCard data={createDraft} />);

  await user.click(screen.getByRole("button", { name: "Dismiss" }));

  expect(screen.queryByText(/new page draft/i)).not.toBeInTheDocument();
  expect(createSpy).not.toHaveBeenCalled();
});
