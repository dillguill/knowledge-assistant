import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSearchSelect } from "./web-search-select";
import { loadWebSearchMode, setWebSearchMode, webSearchRef } from "./web-search-mode";

const models = [
  {
    id: "tool/model:free",
    name: "Tool",
    context_length: null,
    supported_parameters: ["tools"],
  },
  {
    id: "plain/model:free",
    name: "Plain",
    context_length: null,
    supported_parameters: [],
  },
];

vi.mock("./use-models", () => ({
  useModels: () => models,
}));

vi.mock("./chat-provider", () => ({
  API_URL: "https://api.test",
  useBackend: () => "online",
  useModelSelection: () => ({ model: "tool/model:free", setModel: () => {} }),
}));

describe("WebSearchSelect", () => {
  beforeEach(() => {
    localStorage.clear();
    webSearchRef.current = "off";
  });

  it("offers auto when the selected model supports tools", async () => {
    render(<WebSearchSelect selectedModel="tool/model:free" ownerToken="sekret" />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /auto/i })).toBeInTheDocument();
  });

  it("hides auto when the selected model lacks tool support", async () => {
    render(<WebSearchSelect selectedModel="plain/model:free" ownerToken="sekret" />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("option", { name: /auto/i })).not.toBeInTheDocument();
  });

  it("falls back to off, not on, when the model loses tool support", () => {
    setWebSearchMode("auto");
    const { rerender } = render(
      <WebSearchSelect selectedModel="tool/model:free" ownerToken="sekret" />,
    );
    rerender(<WebSearchSelect selectedModel="plain/model:free" ownerToken="sekret" />);
    // Never "on": that would spend search quota the user never asked for.
    expect(loadWebSearchMode()).toBe("off");
    expect(webSearchRef.current).toBe("off");
  });

  it("leaves an explicit on mode alone when tool support is missing", () => {
    setWebSearchMode("on");
    render(<WebSearchSelect selectedModel="plain/model:free" ownerToken="sekret" />);
    expect(loadWebSearchMode()).toBe("on");
  });

  it("renders nothing without an owner token", () => {
    const { container } = render(
      <WebSearchSelect selectedModel="tool/model:free" ownerToken="" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("syncs the module ref on mount so the adapter sees the stored mode", () => {
    setWebSearchMode("on");
    webSearchRef.current = "off";
    render(<WebSearchSelect selectedModel="tool/model:free" ownerToken="sekret" />);
    expect(webSearchRef.current).toBe("on");
  });
});
