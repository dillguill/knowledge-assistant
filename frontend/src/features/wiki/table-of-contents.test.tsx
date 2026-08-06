import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TableOfContents } from "./table-of-contents";

type ObserveEntry = { target: Element; isIntersecting: boolean };

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: (entries: ObserveEntry[]) => void;

  constructor(callback: (entries: ObserveEntry[]) => void) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => vi.unstubAllGlobals());

const content = "# Getting Started\n\n## Install\n\n## Configure\n";

test("renders nothing when the content has no headings", () => {
  const { container } = render(<TableOfContents content="Just a paragraph." />);
  expect(container).toBeEmptyDOMElement();
});

test("lists every heading in document order with anchors matching rehype-slug ids", () => {
  render(<TableOfContents content={content} />);
  const nav = screen.getByRole("navigation", { name: "Table of contents" });
  const links = nav.querySelectorAll("a");
  expect([...links].map((a) => a.textContent)).toEqual([
    "Getting Started",
    "Install",
    "Configure",
  ]);
  expect(links[0]).toHaveAttribute("href", "#getting-started");
  expect(links[1]).toHaveAttribute("href", "#install");
});

test("clicking an entry smooth-scrolls to its heading instead of jumping", async () => {
  document.body.innerHTML += '<h2 id="install">Install</h2>';
  const user = userEvent.setup();
  render(<TableOfContents content={content} />);
  const scrollIntoView = vi.spyOn(
    document.getElementById("install")!,
    "scrollIntoView",
  );

  await user.click(screen.getByRole("link", { name: "Install" }));

  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
});

test("highlights the entry useScrollSpy reports as active", () => {
  document.body.innerHTML +=
    '<h1 id="getting-started"></h1><h2 id="install"></h2><h2 id="configure"></h2>';
  render(<TableOfContents content={content} />);
  const observer = MockIntersectionObserver.instances[0];

  act(() => {
    observer.callback([{ target: document.getElementById("install")!, isIntersecting: true }]);
  });

  expect(screen.getByRole("link", { name: "Install" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  expect(screen.getByRole("link", { name: "Configure" })).not.toHaveAttribute(
    "aria-current",
  );
});
