import { useCallback, useMemo } from "react";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { useWikiTree } from "@/features/wiki/use-wiki";
import { useSourceSelection } from "./source-selection";
import { useTargetSelection } from "./target-selection";

/**
 * Feeds the composer's `@` popover. Picking an item doesn't insert any text
 * (the popover runs in "action" mode) — it updates the session's source /
 * target selection, which surfaces as removable pills above the composer:
 *
 * - Wiki Pages / Collections → added as grounding sources.
 * - Edit Page → pinned as the single edit target (opens the TargetPanel side
 *   panel and drives wiki-update proposals).
 */
export function useSourceMentions() {
  const { tree } = useWikiTree();
  const { collections } = useCollections();
  const { wikiPageIds, setWikiPageIds, collectionIds, setCollectionIds } =
    useSourceSelection();
  const { setTargetPageId } = useTargetSelection();

  const categories = useMemo(
    () => [
      {
        id: "wiki-pages" as const,
        label: "Wiki Pages",
        items: tree.pages.map((p) => ({
          id: `wiki-${p.id}`,
          type: "wiki-page" as const,
          label: p.title,
          description: p.slug,
        })),
      },
      {
        id: "collections" as const,
        label: "Collections",
        items: collections.map((c) => ({
          id: `col-${c.id}`,
          type: "collection" as const,
          label: c.name,
        })),
      },
      {
        id: "edit-pages" as const,
        label: "Edit Page",
        items: tree.pages.map((p) => ({
          id: `edit-${p.id}`,
          type: "edit-page" as const,
          label: p.title,
          description: p.slug,
        })),
      },
    ],
    [tree.pages, collections],
  );

  // Dispatch on the id prefix (`wiki-`/`col-`/`edit-`) rather than a `type`
  // field: the id is always preserved on the item passed to the popover's
  // action handler, custom metadata is not guaranteed to be.
  const onSelect = useCallback(
    (item: { id: string }) => {
      if (item.id.startsWith("wiki-")) {
        const pageId = Number(item.id.slice("wiki-".length));
        if (pageId && !wikiPageIds.includes(pageId)) {
          setWikiPageIds([...wikiPageIds, pageId]);
        }
      } else if (item.id.startsWith("col-")) {
        const collectionId = Number(item.id.slice("col-".length));
        if (collectionId && !collectionIds.includes(collectionId)) {
          setCollectionIds([...collectionIds, collectionId]);
        }
      } else if (item.id.startsWith("edit-")) {
        const pageId = Number(item.id.slice("edit-".length));
        if (pageId) setTargetPageId(pageId);
      }
    },
    [
      wikiPageIds,
      setWikiPageIds,
      collectionIds,
      setCollectionIds,
      setTargetPageId,
    ],
  );

  return { categories, onSelect };
}
