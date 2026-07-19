import type { WikiFolder, WikiPageSummary } from "./api";
import type { WikiLinkResolution, WikiLinkResolver } from "./wiki-markdown";

export type WikiFolderNode = WikiFolder & {
  children: WikiFolderNode[];
  pages: WikiPageSummary[];
};

/** Distinct from `WikiTree` in `./api` (the flat `{folders, pages}` response
 * this is built from) — this is the nested, render-ready shape. */
export type WikiFolderTree = {
  roots: WikiFolderNode[];
  rootPages: WikiPageSummary[];
  byId: Map<number, WikiFolderNode>;
};

function byPositionThenName<T extends { position: number }>(
  nameOf: (item: T) => string,
) {
  return (a: T, b: T) => a.position - b.position || nameOf(a).localeCompare(nameOf(b));
}

/**
 * Nests the flat `folders`/`pages` lists from `GET /api/wiki/tree` into a
 * tree, ordered by `position` then name/title within each level.
 *
 * Cycle-safe: nesting is a DFS from real roots (`parent_id === null`) and
 * orphans (an unknown `parent_id`) that tracks visited folder ids as it
 * goes; a child id already seen is a back-edge into a cycle and is simply
 * not attached again (breaking the loop without dropping the folder). Any
 * folder still unvisited once every reachable subtree has been walked can
 * only be part of a "pure" cycle with no real root anywhere in its chain
 * (e.g. `move_folder` sending a folder to live under its own descendant) —
 * the first such folder (by input order) is forced to root-level, which
 * also visits and correctly nests the rest of that cycle underneath it.
 */
export function buildWikiTree(
  folders: WikiFolder[],
  pages: WikiPageSummary[],
): WikiFolderTree {
  const byId = new Map<number, WikiFolderNode>(
    folders.map((f) => [f.id, { ...f, children: [], pages: [] }]),
  );

  const childrenOf = new Map<number, WikiFolder[]>();
  for (const f of folders) {
    if (f.parent_id === null) continue;
    const siblings = childrenOf.get(f.parent_id);
    if (siblings) siblings.push(f);
    else childrenOf.set(f.parent_id, [f]);
  }

  const roots: WikiFolderNode[] = [];
  const visited = new Set<number>();

  function attachChildren(parentId: number) {
    const parentNode = byId.get(parentId)!;
    for (const child of childrenOf.get(parentId) ?? []) {
      if (visited.has(child.id)) continue; // cycle back-edge — drop the link, not the folder
      visited.add(child.id);
      parentNode.children.push(byId.get(child.id)!);
      attachChildren(child.id);
    }
  }

  function promoteToRoot(f: WikiFolder) {
    visited.add(f.id);
    roots.push(byId.get(f.id)!);
    attachChildren(f.id);
  }

  for (const f of folders) {
    if (f.parent_id === null && !visited.has(f.id)) promoteToRoot(f);
  }
  for (const f of folders) {
    if (f.parent_id !== null && !byId.has(f.parent_id) && !visited.has(f.id)) {
      promoteToRoot(f);
    }
  }
  // Whatever's left is a pure cycle disconnected from any real root.
  for (const f of folders) {
    if (!visited.has(f.id)) promoteToRoot(f);
  }

  const rootPages: WikiPageSummary[] = [];
  for (const p of pages) {
    const folder = p.folder_id !== null ? byId.get(p.folder_id) : undefined;
    if (folder) {
      folder.pages.push(p);
    } else {
      rootPages.push(p);
    }
  }

  const sortFolders = byPositionThenName<WikiFolderNode>((f) => f.name);
  const sortPages = byPositionThenName<WikiPageSummary>((p) => p.title);
  const sortLevel = (nodes: WikiFolderNode[]) => {
    nodes.sort(sortFolders);
    for (const node of nodes) {
      node.pages.sort(sortPages);
      sortLevel(node.children);
    }
  };
  sortLevel(roots);
  rootPages.sort(sortPages);

  return { roots, rootPages, byId };
}

/**
 * The chain of ancestor folders from the wiki root down to (and including)
 * `folderId`, for rendering a breadcrumb. Guards against cycles the same
 * way `buildWikiTree` does, so a corrupted parent chain terminates instead
 * of looping.
 */
export function folderBreadcrumb(
  folderId: number,
  byId: Map<number, WikiFolderNode>,
): WikiFolderNode[] {
  const chain: WikiFolderNode[] = [];
  const visited = new Set<number>();
  let current: number | null = folderId;
  while (current !== null && !visited.has(current)) {
    const node = byId.get(current);
    if (!node) break;
    visited.add(current);
    chain.unshift(node);
    current = node.parent_id;
  }
  return chain;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Builds the `resolve` function `WikiMarkdown` needs to turn `[[Wiki Links]]`
 * into navigable links: matches a link target against page slugs first
 * (exact), then titles (case-insensitive), and falls back to a slugified
 * guess with `exists: false` so a missing-page span still has a sensible
 * href if the page gets created later.
 */
export function buildWikiLinkResolver(pages: WikiPageSummary[]): WikiLinkResolver {
  const byTitle = new Map<string, string>();
  const bySlug = new Set<string>();
  for (const p of pages) {
    byTitle.set(p.title.trim().toLowerCase(), p.slug);
    bySlug.add(p.slug);
  }
  return (target: string): WikiLinkResolution => {
    const trimmed = target.trim();
    if (bySlug.has(trimmed)) return { slug: trimmed, exists: true };
    const slug = byTitle.get(trimmed.toLowerCase());
    if (slug) return { slug, exists: true };
    return { slug: slugify(trimmed), exists: false };
  };
}
