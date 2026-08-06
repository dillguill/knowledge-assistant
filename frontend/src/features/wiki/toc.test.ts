import { expect, test } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { extractHeadings } from "./toc";

/** Renders markdown all the way to HTML via the exact rehype-slug pipeline,
 * so tests can assert `extractHeadings` produces the same ids as real
 * rendering — not just plausible-looking ones. */
function renderedIds(content: string): string[] {
  const html = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeStringify)
    .processSync(content)
    .toString();
  return [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
}

test("extracts headings with depth and plain text", () => {
  const entries = extractHeadings("# Title\n\nSome text.\n\n## Section One\n\ncontent\n");
  expect(entries).toEqual([
    { id: "title", text: "Title", depth: 1 },
    { id: "section-one", text: "Section One", depth: 2 },
  ]);
});

test("ids match rehype-slug's real rendered ids for plain headings", () => {
  const content = "# Getting Started\n\n## Install\n\n### Configuration\n";
  const entries = extractHeadings(content);
  expect(entries.map((e) => e.id)).toEqual(renderedIds(content));
});

test("ids match rehype-slug for headings containing inline markup", () => {
  const content = "# Hello **World**\n\n## Use `npm install`\n\n## Hello World\n";
  const entries = extractHeadings(content);
  expect(entries.map((e) => e.id)).toEqual(renderedIds(content));
});

test("duplicate heading text gets rehype-slug's same disambiguating suffix", () => {
  const content = "# Setup\n\n## Setup\n\n## Setup\n";
  const entries = extractHeadings(content);
  expect(entries.map((e) => e.id)).toEqual(["setup", "setup-1", "setup-2"]);
  expect(entries.map((e) => e.id)).toEqual(renderedIds(content));
});

test("headings inside a fenced code block are not extracted", () => {
  const entries = extractHeadings("# Real heading\n\n```\n# Not a heading\n```\n");
  expect(entries).toEqual([{ id: "real-heading", text: "Real heading", depth: 1 }]);
});

test("returns an empty list for content with no headings", () => {
  expect(extractHeadings("Just a paragraph, no headings here.")).toEqual([]);
});
