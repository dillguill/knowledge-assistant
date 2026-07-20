import { useMemo, useState } from "react";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { buildWikiTree, type WikiFolderNode } from "@/features/wiki/tree";
import { useWikiTree } from "@/features/wiki/use-wiki";
import type { WikiPageSummary } from "@/features/wiki/api";
import { cn } from "@/lib/utils";
import { useBackend } from "./chat-provider";
import { useSourceSelection } from "./source-selection";

/** Every page id nested under a folder (its own pages plus every descendant
 * subfolder's pages) — what checking the folder's box selects/deselects. */
function collectPageIds(folder: WikiFolderNode): number[] {
  return [...folder.pages.map((p) => p.id), ...folder.children.flatMap(collectPageIds)];
}

function WikiPageRow({
  page,
  checked,
  onToggle,
}: {
  page: WikiPageSummary;
  checked: boolean;
  onToggle: (id: number, checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 pl-4 text-xs hover:bg-accent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(page.id, e.target.checked)}
      />
      <span className="truncate">{page.title}</span>
    </label>
  );
}

function WikiFolderGroup({
  folder,
  wikiPageIds,
  onTogglePage,
  onToggleFolder,
}: {
  folder: WikiFolderNode;
  wikiPageIds: number[];
  onTogglePage: (id: number, checked: boolean) => void;
  onToggleFolder: (ids: number[], checked: boolean) => void;
}) {
  const pageIds = useMemo(() => collectPageIds(folder), [folder]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => wikiPageIds.includes(id));

  return (
    <div>
      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-medium hover:bg-accent">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={pageIds.length === 0}
          onChange={(e) => onToggleFolder(pageIds, e.target.checked)}
        />
        <span className="truncate">{folder.name}</span>
      </label>
      <div className="pl-2">
        {folder.pages.map((p) => (
          <WikiPageRow
            key={p.id}
            page={p}
            checked={wikiPageIds.includes(p.id)}
            onToggle={onTogglePage}
          />
        ))}
        {folder.children.map((child) => (
          <WikiFolderGroup
            key={child.id}
            folder={child}
            wikiPageIds={wikiPageIds}
            onTogglePage={onTogglePage}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </div>
    </div>
  );
}

/** Per-conversation source picker in the composer. Collections only render
 * when the backend is online (demo mode has no collections); the Wiki group
 * renders whenever there's wiki content, independent of backend status,
 * since wiki data comes from its own endpoints. */
export function SourceSelector() {
  const status = useBackend();
  const { collectionIds, setCollectionIds, wikiPageIds, setWikiPageIds } =
    useSourceSelection();
  const { collections } = useCollections();
  const { tree: rawTree } = useWikiTree();
  const [open, setOpen] = useState(false);

  const wikiTree = useMemo(() => buildWikiTree(rawTree.folders, rawTree.pages), [rawTree]);
  const hasCollections = status === "online" && collections.length > 0;
  const hasWiki = wikiTree.roots.length > 0 || wikiTree.rootPages.length > 0;
  if (!hasCollections && !hasWiki) return null;

  const count = collectionIds.length + wikiPageIds.length;

  function toggleCollection(id: number, checked: boolean) {
    setCollectionIds(
      checked ? [...collectionIds, id] : collectionIds.filter((x) => x !== id),
    );
  }

  function toggleWikiPage(id: number, checked: boolean) {
    setWikiPageIds(
      checked ? [...wikiPageIds, id] : wikiPageIds.filter((x) => x !== id),
    );
  }

  function toggleWikiFolder(ids: number[], checked: boolean) {
    setWikiPageIds(
      checked
        ? [...new Set([...wikiPageIds, ...ids])]
        : wikiPageIds.filter((x) => !ids.includes(x)),
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {count ? `Sources: ${count}` : "Sources"}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Source collections"
          className="absolute bottom-full z-10 mb-1 max-h-80 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {hasCollections && (
            <div>
              {hasWiki && (
                <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Documents
                </div>
              )}
              {collections.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={collectionIds.includes(c.id)}
                    onChange={(e) => toggleCollection(c.id, e.target.checked)}
                  />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-muted-foreground">
                    {c.file_count}
                  </span>
                </label>
              ))}
            </div>
          )}
          {hasWiki && (
            <div>
              <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                Wiki
              </div>
              {wikiTree.rootPages.map((p) => (
                <WikiPageRow
                  key={p.id}
                  page={p}
                  checked={wikiPageIds.includes(p.id)}
                  onToggle={toggleWikiPage}
                />
              ))}
              {wikiTree.roots.map((f) => (
                <WikiFolderGroup
                  key={f.id}
                  folder={f}
                  wikiPageIds={wikiPageIds}
                  onTogglePage={toggleWikiPage}
                  onToggleFolder={toggleWikiFolder}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
