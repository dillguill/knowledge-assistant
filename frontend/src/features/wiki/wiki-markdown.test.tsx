import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WikiMarkdown } from "./wiki-markdown";

function resolve(target: string) {
  if (target === "Welcome") return { slug: "welcome", exists: true };
  return { slug: target.toLowerCase().replace(/\s+/g, "-"), exists: false };
}

test("a wiki link to an existing page renders as a navigable link", () => {
  render(<WikiMarkdown content="See [[Welcome]] for more." resolve={resolve} />);
  const link = screen.getByRole("link", { name: "Welcome" });
  expect(link).toHaveAttribute("href", "/wiki/page/welcome");
});

test("a wiki link with an alias displays the alias but resolves the target", () => {
  render(
    <WikiMarkdown content="See [[Welcome|the homepage]]." resolve={resolve} />,
  );
  const link = screen.getByRole("link", { name: "the homepage" });
  expect(link).toHaveAttribute("href", "/wiki/page/welcome");
});

test("a wiki link to a missing page renders as a muted, non-navigable span", () => {
  render(<WikiMarkdown content="See [[Nowhere]]." resolve={resolve} />);
  expect(screen.queryByRole("link", { name: "Nowhere" })).not.toBeInTheDocument();
  const span = screen.getByText("Nowhere");
  expect(span).toHaveClass("wiki-link-missing");
  expect(span).toHaveAttribute("title", "No page with this name yet");
});

test("inline math renders katex output", () => {
  render(<WikiMarkdown content="Energy: $x^2$" resolve={resolve} />);
  expect(document.querySelector(".katex")).toBeInTheDocument();
});

test("raw HTML in the source does not render as an element", () => {
  render(
    <WikiMarkdown content={"before <script>window.__x = 1</script> after"} resolve={resolve} />,
  );
  expect(document.querySelector("script")).not.toBeInTheDocument();
  expect((window as unknown as { __x?: number }).__x).toBeUndefined();
});

test("a fenced code block with another language keeps normal code styling", () => {
  render(
    <WikiMarkdown content={"```js\nconst x = 1;\n```"} resolve={resolve} />,
  );
  const code = document.querySelector("code.language-js");
  expect(code).toBeInTheDocument();
  expect(code?.textContent).toContain("const x = 1;");
});

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg data-testid='mermaid-svg'></svg>" }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

test("a mermaid fence mounts the lazy MermaidBlock and renders its svg", async () => {
  render(
    <WikiMarkdown content={"```mermaid\ngraph TD; A-->B;\n```"} resolve={resolve} />,
  );
  await waitFor(() => {
    expect(document.querySelector('[data-testid="mermaid-svg"]')).toBeInTheDocument();
  });
});
