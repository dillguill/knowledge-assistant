import { expect, test } from "vitest";
import { buildWikiLinkResolver, buildWikiTree, folderBreadcrumb } from "./tree";
import type { WikiFolder, WikiPageSummary } from "./api";

function folder(overrides: Partial<WikiFolder>): WikiFolder {
  return {
    id: 1,
    name: "Folder",
    parent_id: null,
    position: 0,
    created_at: "2026-01-01",
    ...overrides,
  };
}

function page(overrides: Partial<WikiPageSummary>): WikiPageSummary {
  return {
    id: 1,
    folder_id: null,
    title: "Page",
    slug: "page",
    position: 0,
    updated_at: "2026-01-01",
    last_author: "owner",
    ...overrides,
  };
}

test("nests folders under their parent and orders siblings by position then name", () => {
  const folders = [
    folder({ id: 1, name: "Zeta", parent_id: null, position: 1 }),
    folder({ id: 2, name: "Alpha", parent_id: null, position: 0 }),
    folder({ id: 3, name: "Child B", parent_id: 2, position: 1 }),
    folder({ id: 4, name: "Child A", parent_id: 2, position: 1 }),
  ];
  const { roots } = buildWikiTree(folders, []);
  expect(roots.map((f) => f.name)).toEqual(["Alpha", "Zeta"]);
  const alpha = roots[0];
  // Same position (1) -> falls back to name ordering.
  expect(alpha.children.map((f) => f.name)).toEqual(["Child A", "Child B"]);
});

test("attaches pages to their folder, and orders them by position then title", () => {
  const folders = [folder({ id: 1, name: "Guides", parent_id: null })];
  const pages = [
    page({ id: 1, folder_id: 1, title: "Zebra", position: 0 }),
    page({ id: 2, folder_id: 1, title: "Ant", position: 0 }),
  ];
  const { roots } = buildWikiTree(folders, pages);
  expect(roots[0].pages.map((p) => p.title)).toEqual(["Ant", "Zebra"]);
});

test("pages with no folder_id (or an unknown one) land in rootPages", () => {
  const pages = [
    page({ id: 1, folder_id: null, title: "Welcome" }),
    page({ id: 2, folder_id: 999, title: "Orphaned" }),
  ];
  const { rootPages } = buildWikiTree([], pages);
  expect(rootPages.map((p) => p.title)).toEqual(["Orphaned", "Welcome"]);
});

test("a cyclic parent chain is broken: the offending folder becomes root-level", () => {
  // 1 -> 2 -> 3 -> 1 (a cycle with no true root among these three)
  const folders = [
    folder({ id: 1, name: "A", parent_id: 3 }),
    folder({ id: 2, name: "B", parent_id: 1 }),
    folder({ id: 3, name: "C", parent_id: 2 }),
  ];
  const { roots, byId } = buildWikiTree(folders, []);
  // Exactly one of the three had to be demoted to root to break the cycle;
  // the builder must not hang and must not lose any folder.
  expect(byId.size).toBe(3);
  expect(roots).toHaveLength(1);
  const totalNested = roots[0].children.length +
    (roots[0].children[0]?.children.length ?? 0);
  expect(totalNested).toBe(2);
});

test("a folder that is its own parent is treated as root-level", () => {
  const folders = [folder({ id: 1, name: "Self", parent_id: 1 })];
  const { roots } = buildWikiTree(folders, []);
  expect(roots).toHaveLength(1);
  expect(roots[0].children).toHaveLength(0);
});

test("a folder pointing at an unknown parent id is treated as root-level", () => {
  const folders = [folder({ id: 1, name: "Orphan", parent_id: 42 })];
  const { roots } = buildWikiTree(folders, []);
  expect(roots.map((f) => f.name)).toEqual(["Orphan"]);
});

test("folderBreadcrumb walks from the wiki root down to the given folder", () => {
  const folders = [
    folder({ id: 1, name: "Guides", parent_id: null }),
    folder({ id: 2, name: "Setup", parent_id: 1 }),
  ];
  const { byId } = buildWikiTree(folders, []);
  expect(folderBreadcrumb(2, byId).map((f) => f.name)).toEqual(["Guides", "Setup"]);
});

test("buildWikiLinkResolver matches by slug and by title, else guesses a slug", () => {
  const resolve = buildWikiLinkResolver([
    page({ title: "Welcome", slug: "welcome" }),
  ]);
  expect(resolve("welcome")).toEqual({ slug: "welcome", exists: true });
  expect(resolve("Welcome")).toEqual({ slug: "welcome", exists: true });
  expect(resolve("Nowhere Yet")).toEqual({ slug: "nowhere-yet", exists: false });
});
