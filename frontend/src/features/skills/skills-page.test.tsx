import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";
import { SkillsPage } from "./skills-page";
import type { Run, SkillSummary } from "./api";

const skill: SkillSummary = {
  name: "research_brief",
  label: "Research brief",
  description: "Plans, gathers, drafts, verifies.",
  estimated_calls: 7,
  scheduler: "pipeline",
  input_schema: {
    type: "object",
    required: ["topic"],
    properties: { topic: { type: "string", title: "Topic" } },
  },
};

const finishedRun = {
  id: 4,
  skill: "research_brief",
  scheduler: "pipeline",
  model: "m:free",
  status: "succeeded",
  input: { topic: "sqlite" },
  output: { proposal_id: 9, title: "SQLite", unsupported_claims: [] },
  error_code: null,
  error_message: null,
  created_at: new Date().toISOString(),
  started_at: null,
  finished_at: new Date().toISOString(),
} satisfies Run;

const listSkillsMock = vi.fn();
const listRunsMock = vi.fn();
const startRunMock = vi.fn();
const getRunMock = vi.fn();
const requestWikiProposalsMock = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    listSkills: () => listSkillsMock(),
    listRuns: () => listRunsMock(),
    startRun: (...a: unknown[]) => startRunMock(...a),
    getRun: (...a: unknown[]) => getRunMock(...a),
    cancelRun: vi.fn(),
    streamRun: async function* () {},
  };
});

vi.mock("@/features/knowledge/api", () => ({ listCollections: async () => [] }));

vi.mock("@/app/wiki-navigation", () => ({
  requestWikiProposals: () => requestWikiProposalsMock(),
}));

vi.mock("@/features/chat/chat-provider", () => ({
  API_URL: "https://api.test",
  useModelSelection: () => ({ model: "m:free", setModel: () => {} }),
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  listSkillsMock.mockReset().mockResolvedValue([skill]);
  listRunsMock.mockReset().mockResolvedValue([]);
  startRunMock.mockReset().mockResolvedValue({ run_id: 4, status: "queued" });
  getRunMock.mockReset().mockResolvedValue({ run: finishedRun, steps: [] });
  requestWikiProposalsMock.mockReset();
});

describe("SkillsPage", () => {
  it("explains itself to a visitor instead of showing a broken form", async () => {
    localStorage.clear();
    render(<SkillsPage />);
    expect(await screen.findByText(/owner token/i)).toBeInTheDocument();
    expect(listSkillsMock).not.toHaveBeenCalled();
  });

  it("lists skill cards with description and cost", async () => {
    render(<SkillsPage />);
    expect(await screen.findByText("Research brief")).toBeInTheDocument();
    expect(screen.getByText(/Plans, gathers/)).toBeInTheDocument();
    expect(screen.getByText(/7 model calls/)).toBeInTheDocument();
  });

  it("switches to the run view once a run starts", async () => {
    render(<SkillsPage />);
    await userEvent.type(await screen.findByLabelText(/topic/i), "sqlite");
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => expect(startRunMock).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("renders a 409 as a real state, not a generic failure", async () => {
    startRunMock.mockRejectedValue(new Error("A run is already in progress."));
    render(<SkillsPage />);
    await userEvent.type(await screen.findByLabelText(/topic/i), "sqlite");
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already in progress/i);
  });

  it("lists run history newest-first and opens a past run", async () => {
    listRunsMock.mockResolvedValue([
      finishedRun,
      { ...finishedRun, id: 3, status: "failed", error_code: "rate_limited" },
    ]);
    render(<SkillsPage />);

    const entries = await screen.findAllByRole("button", { name: /research_brief/i });
    expect(entries).toHaveLength(2);
    await userEvent.click(entries[0]);
    await waitFor(() => expect(getRunMock).toHaveBeenCalledWith(4));
  });

  it("offers Review proposal on a succeeded run and fires the wiki bridge", async () => {
    listRunsMock.mockResolvedValue([finishedRun]);
    render(<SkillsPage />);

    await userEvent.click(
      (await screen.findAllByRole("button", { name: /research_brief/i }))[0],
    );
    await userEvent.click(await screen.findByRole("button", { name: /review proposal/i }));
    expect(requestWikiProposalsMock).toHaveBeenCalled();
  });

  it("surfaces a load failure without blanking the page", async () => {
    listSkillsMock.mockRejectedValue(new Error("offline"));
    render(<SkillsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
  });
});
