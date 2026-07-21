import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ProposalCard, DraftingProposalPlaceholder } from "./proposal-card";
import * as wikiApi from "@/features/wiki/api";
import * as targetSelection from "./target-selection";
import { SettingsProvider } from "@/features/settings/settings-provider";
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
  render(<SettingsProvider><ProposalCard content={"new line\n"} targetPage={targetPage} /></SettingsProvider>);
  expect(screen.getByText("old line")).toBeInTheDocument();
  expect(screen.getByText("new line")).toBeInTheDocument();
  expect(document.querySelector('[data-type="del"]')).toBeInTheDocument();
  expect(document.querySelector('[data-type="add"]')).toBeInTheDocument();
});

test("Propose posts page_id/title/folder_id/content and citations from the message's sources", async () => {
  const createSpy = vi.spyOn(wikiApi, "createProposal").mockResolvedValue({
    id: 42,
    page_id: 5,
    proposal_number: 42,
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
  render(<SettingsProvider><ProposalCard content={"new line\n"} targetPage={targetPage} citations={citations} /></SettingsProvider>);

  await user.click(screen.getByRole("button", { name: "Propose" }));

  expect(createSpy).toHaveBeenCalledWith({
    page_id: 5,
    title: "Setup",
    folder_id: 2,
    content: "new line\n",
    citations,
  });
  expect(await screen.findByText("proposal #42 submitted")).toBeInTheDocument();
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
  render(<SettingsProvider><ProposalCard content={"new line\n"} targetPage={targetPage} /></SettingsProvider>);
  await user.click(screen.getByRole("button", { name: "Propose" }));
  expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ citations: [] }));
});

test("a 429 (queue full) response surfaces the queue-full copy", async () => {
  vi.spyOn(wikiApi, "createProposal").mockRejectedValue(
    new Error("Rate limited — wait a moment and retry."),
  );
  const user = userEvent.setup();
  render(<SettingsProvider><ProposalCard content={"new line\n"} targetPage={targetPage} /></SettingsProvider>);
  await user.click(screen.getByRole("button", { name: "Propose" }));
  expect(await screen.findByText(/proposal queue is full/i)).toBeInTheDocument();
});

test("a visitor (no owner token) sees no Approve now button", () => {
  render(<SettingsProvider><ProposalCard content={"new line\n"} targetPage={targetPage} /></SettingsProvider>);
  expect(screen.queryByRole("button", { name: "Approve now" })).not.toBeInTheDocument();
});

test("owner Approve now chains create then approve, and refreshes the target panel", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const createSpy = vi.spyOn(wikiApi, "createProposal").mockResolvedValue({
    id: 7,
    page_id: 5,
    proposal_number: 7,
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
  render(<SettingsProvider><ProposalCard content={"new line\n"} targetPage={targetPage} /></SettingsProvider>);

  await user.click(screen.getByRole("button", { name: "Approve now" }));

  expect(await screen.findByText("proposal #7 approved")).toBeInTheDocument();
  expect(createSpy).toHaveBeenCalled();
  expect(approveSpy).toHaveBeenCalledWith(7);
  expect(bumpSpy).toHaveBeenCalled();
});

test("Dismiss removes the card without calling any API", async () => {
  const createSpy = vi.spyOn(wikiApi, "createProposal");
  const user = userEvent.setup();
  render(<SettingsProvider><ProposalCard content={"new line\n"} targetPage={targetPage} /></SettingsProvider>);

  await user.click(screen.getByRole("button", { name: "Dismiss" }));

  expect(screen.queryByText(/proposed wiki update/i)).not.toBeInTheDocument();
  expect(createSpy).not.toHaveBeenCalled();
});
