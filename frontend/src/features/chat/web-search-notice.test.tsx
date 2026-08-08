import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSearchNotice } from "./web-search-notice";

const webSearch = {
  query: "sqlite-vec benchmarks",
  results: [{ url: "https://a.test/x", title: "Article A" }],
};

const OWNER = JSON.stringify({ ownerToken: "sekret" });

describe("WebSearchNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("shows the query that was searched and each result", () => {
    render(<WebSearchNotice webSearch={webSearch} notice={null} />);
    expect(screen.getByText(/sqlite-vec benchmarks/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Article A" })).toHaveAttribute(
      "href",
      "https://a.test/x",
    );
  });

  it("renders a degradation notice when search failed", () => {
    render(
      <WebSearchNotice webSearch={null} notice="The web search quota is exhausted." />,
    );
    expect(screen.getByText(/quota is exhausted/)).toBeInTheDocument();
  });

  it("renders nothing when there is neither a search nor a notice", () => {
    const { container } = render(<WebSearchNotice webSearch={null} notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no save action without an owner token", () => {
    render(<WebSearchNotice webSearch={webSearch} notice={null} />);
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("saves a result and shows the footnote to copy", async () => {
    localStorage.setItem("knowledge-assistant:settings", OWNER);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          document: { id: 7 },
          footnote:
            "[^1]: > Blurb.\n    [Article A](https://a.test/x) — archived 2026-08-07",
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WebSearchNotice webSearch={webSearch} notice={null} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(fetchMock).toHaveBeenCalled();
    // The body is never sent: the backend recovers it from the search cache.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toEqual({ url: "https://a.test/x", title: "Article A" });
    expect(await screen.findByText(/\[\^1\]:/)).toBeInTheDocument();
  });

  it("tells the user to search again when the cached body has expired", async () => {
    localStorage.setItem("knowledge-assistant:settings", OWNER);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "gone" }), { status: 404 }),
      ),
    );

    render(<WebSearchNotice webSearch={webSearch} notice={null} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/search again/i)).toBeInTheDocument();
  });

  it("keeps the save action usable after a failure", async () => {
    localStorage.setItem("knowledge-assistant:settings", OWNER);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    render(<WebSearchNotice webSearch={webSearch} notice={null} />);
    const button = screen.getByRole("button", { name: /save/i });
    await userEvent.click(button);

    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
});
