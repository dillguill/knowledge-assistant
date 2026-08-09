import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillForm } from "./skill-form";
import type { SkillSummary } from "./api";

const listCollectionsMock = vi.fn();

vi.mock("@/features/knowledge/api", () => ({
  listCollections: () => listCollectionsMock(),
}));

const skill: SkillSummary = {
  name: "research_brief",
  label: "Research brief",
  description: "Plans, gathers, drafts, verifies.",
  estimated_calls: 7,
  scheduler: "pipeline",
  input_schema: {
    type: "object",
    required: ["topic"],
    properties: {
      topic: { type: "string", title: "Topic", minLength: 3 },
      collection_ids: { type: "array", items: { type: "integer" } },
      web_search: { type: "boolean", default: false },
    },
  },
};

beforeEach(() => {
  listCollectionsMock.mockReset().mockResolvedValue([
    { id: 1, name: "Garage", file_count: 2 },
    { id: 2, name: "Recipes", file_count: 0 },
  ]);
});

describe("SkillForm", () => {
  it("renders a labeled text input for a string field", () => {
    render(<SkillForm skill={skill} onSubmit={vi.fn()} submitting={false} />);
    expect(screen.getByLabelText(/topic/i)).toBeInTheDocument();
  });

  it("renders a checkbox for a boolean field", () => {
    render(<SkillForm skill={skill} onSubmit={vi.fn()} submitting={false} />);
    expect(screen.getByRole("checkbox", { name: /web search/i })).toBeInTheDocument();
  });

  it("renders the collection picker for a collection_ids field", async () => {
    render(<SkillForm skill={skill} onSubmit={vi.fn()} submitting={false} />);
    expect(await screen.findByRole("checkbox", { name: /garage/i })).toBeInTheDocument();
  });

  it("shows what a run costs before the user commits to it", () => {
    // The daily allowance is the scarce resource; hiding the price is unkind.
    render(<SkillForm skill={skill} onSubmit={vi.fn()} submitting={false} />);
    expect(screen.getByText(/7 model calls/i)).toBeInTheDocument();
  });

  it("submits typed values, with selected ids as an array of numbers", async () => {
    const onSubmit = vi.fn();
    render(<SkillForm skill={skill} onSubmit={onSubmit} submitting={false} />);

    await userEvent.type(screen.getByLabelText(/topic/i), "sqlite performance");
    await userEvent.click(await screen.findByRole("checkbox", { name: /garage/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /web search/i }));
    await userEvent.click(screen.getByRole("button", { name: /run/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      topic: "sqlite performance",
      collection_ids: [1],
      web_search: true,
    });
  });

  it("blocks submit on a missing required field", async () => {
    const onSubmit = vi.fn();
    render(<SkillForm skill={skill} onSubmit={onSubmit} submitting={false} />);

    await userEvent.click(screen.getByRole("button", { name: /run/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("disables the submit button while a run is starting", () => {
    render(<SkillForm skill={skill} onSubmit={vi.fn()} submitting />);
    expect(screen.getByRole("button", { name: /starting/i })).toBeDisabled();
  });

  it("omits an id list that has nothing selected", async () => {
    const onSubmit = vi.fn();
    render(<SkillForm skill={skill} onSubmit={onSubmit} submitting={false} />);

    await userEvent.type(screen.getByLabelText(/topic/i), "sqlite");
    await userEvent.click(screen.getByRole("button", { name: /run/i }));

    expect(onSubmit).toHaveBeenCalledWith({ topic: "sqlite", web_search: false });
  });

  it("survives a collection fetch failure rather than blocking the form", async () => {
    listCollectionsMock.mockRejectedValue(new Error("offline"));
    render(<SkillForm skill={skill} onSubmit={vi.fn()} submitting={false} />);
    expect(screen.getByLabelText(/topic/i)).toBeInTheDocument();
  });
});
