import { useMemo } from "react";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { useWikiTree } from "@/features/wiki/use-wiki";
import { useSourceSelection } from "./source-selection";

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

  const onInserted = useMemo(
    () =>
      (item: { id: string; type: string }) => {
        if (item.type === "wiki-page") {
          const pageId = Number(item.id.replace("wiki-", ""));
          if (pageId && !wikiPageIds.includes(pageId)) {
            setWikiPageIds([...wikiPageIds, pageId]);
          }
        } else if (item.type === "collection") {
          const collectionId = Number(item.id.replace("col-", ""));
          if (collectionId && !collectionIds.includes(collectionId)) {
            setCollectionIds([...collectionIds, collectionId]);
          }
        }
      },
    [wikiPageIds, setWikiPageIds, collectionIds, setCollectionIds],
  );

  return { categories, onInserted };
}
