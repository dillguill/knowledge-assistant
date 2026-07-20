import { useCallback, useMemo } from "react";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { useWikiTree } from "@/features/wiki/use-wiki";
import { useSourceSelection } from "./source-selection";

/**
 * Feeds the composer's `@` popover. Picking an item doesn't insert any text
 * (the popover runs in "action" mode) — it adds the Wiki Page / Collection as
 * a grounding source, shown as a removable pill above the composer. (Choosing
 * a page to *edit* is a separate `/edit-page` command, not an `@` mention.)
 */
export function useSourceMentions() {
  const { tree } = useWikiTree();
  const { collections } = useCollections();
  const { wikiPageIds, setWikiPageIds, collectionIds, setCollectionIds } =
    useSourceSelection();

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
    ],
    [tree.pages, collections],
  );

  // Dispatch on the id prefix (`wiki-`/`col-`) rather than a `type` field: the
  // id is always preserved on the item passed to the popover's action handler,
  // custom metadata is not guaranteed to be.
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
      }
    },
    [wikiPageIds, setWikiPageIds, collectionIds, setCollectionIds],
  );

  return { categories, onSelect };
}
