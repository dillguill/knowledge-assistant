import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ProposalsInbox } from "./proposals-inbox";
import * as api from "./api";
import { SettingsProvider } from "@/features/settings/settings-provider";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
});

const proposal: api.WikiProposal = {
  id: 1,
  page_id: 5,
  title: "Setup",
  folder_id: 2,
  base_version_id: null,
  content: "new content\n",
  rationale: "asked to update",
  citations: [],
  status: "pending",
  created_at: "t",
  decided_at: null,
  current_content: "old content\n",
};

test("shows the pending list, and a diff once a proposal is selected", async () => {
  vi.spyOn(api, "listProposals").mockResolvedValue([proposal]);
  const user = userEvent.setup();
  render(<SettingsProvider><ProposalsInbox /></SettingsProvider>);

  expect(await screen.findByRole("button", { name: /setup/i })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /setup/i }));

  expect(screen.getByText("old content")).toBeInTheDocument();
  expect(screen.getByText("new content")).toBeInTheDocument();
  expect(document.querySelector('[data-type="del"]')).toBeInTheDocument();
  expect(document.querySelector('[data-type="add"]')).toBeInTheDocument();
});

test("empty state shows when there are no pending proposals", async () => {
  vi.spyOn(api, "listProposals").mockResolvedValue([]);
  render(<SettingsProvider><ProposalsInbox /></SettingsProvider>);
  expect(await screen.findByText("No pending proposals.")).toBeInTheDocument();
});

test("approve removes the proposal from the list and reports the approved page's slug", async () => {
  vi.spyOn(api, "listProposals")
    .mockResolvedValueOnce([proposal])
    .mockResolvedValueOnce([]);
  const approveSpy = vi.spyOn(api, "approveProposal").mockResolvedValue({
    id: 5,
    folder_id: 2,
    title: "Setup",
    slug: "setup",
    position: 0,
    updated_at: "t",
    last_author: "owner",
    content: "new content\n",
    last_version: null,
  });
  const onApproved = vi.fn();
  const user = userEvent.setup();
  render(<SettingsProvider><ProposalsInbox onApproved={onApproved} /></SettingsProvider>);

  await user.click(await screen.findByRole("button", { name: /setup/i }));
  await user.click(screen.getByRole("button", { name: "Approve" }));

  expect(approveSpy).toHaveBeenCalledWith(1);
  expect(onApproved).toHaveBeenCalledWith("setup");
  expect(await screen.findByText("No pending proposals.")).toBeInTheDocument();
});

test("reject removes the proposal from the list", async () => {
  vi.spyOn(api, "listProposals")
    .mockResolvedValueOnce([proposal])
    .mockResolvedValueOnce([]);
  const rejectSpy = vi
    .spyOn(api, "rejectProposal")
    .mockResolvedValue({ ...proposal, status: "rejected" });
  const user = userEvent.setup();
  render(<SettingsProvider><ProposalsInbox /></SettingsProvider>);

  await user.click(await screen.findByRole("button", { name: /setup/i }));
  await user.click(screen.getByRole("button", { name: "Reject" }));

  expect(rejectSpy).toHaveBeenCalledWith(1);
  expect(await screen.findByText("No pending proposals.")).toBeInTheDocument();
});

test("a visitor (no owner token) sees only a read-only pending count, no list or actions", async () => {
  localStorage.clear();
  vi.spyOn(api, "listProposals").mockResolvedValue([proposal]);
  render(<SettingsProvider><ProposalsInbox /></SettingsProvider>);

  expect(await screen.findByText("1 pending proposal")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /setup/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
});
