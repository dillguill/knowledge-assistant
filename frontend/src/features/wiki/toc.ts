import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkWikiLink from "remark-wiki-link";
import { visit } from "unist-util-visit";
import { toString as mdastToString } from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import type { Heading } from "mdast";

export type TocEntry = {
  id: string;
  text: string;
  depth: number;
};

// Parses with the same remark plugins wiki-markdown.tsx renders with (GFM,
// math, wiki-links) so inline markup inside a heading — `**bold**`, `` `code` ``,
// `[[Wiki Links]]` — collapses to the same plain text `rehype-slug` sees via
// hast-util-to-string at render time. Only `.parse()` is needed (not a full
// `.process()`): these three plugins extend the markdown grammar itself
// rather than transforming the tree after parsing.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkWikiLink, { permalinks: [], pageResolver: (name: string) => [name] });

/**
 * Walks a page's raw markdown for its headings, assigning the same slug ids
 * `rehype-slug` assigns at render time — both process headings in document
 * order through the same `github-slugger` class, so a `<TableOfContents>`
 * entry's `href="#id"` always matches the rendered heading's actual `id`.
 */
export function extractHeadings(content: string): TocEntry[] {
  const tree = processor.parse(content);
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];
  visit(tree, "heading", (node: Heading) => {
    const text = mdastToString(node);
    entries.push({ id: slugger.slug(text), text, depth: node.depth });
  });
  return entries;
}
