import { useMemo, useState } from "react";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { buildWikiTree, type WikiFolderNode } from "@/features/wiki/tree";
import { useWikiTree } from "@/features/wiki/use-wiki";
import type { WikiPageSummary } from "@/features/wiki/api";
import { cn } from "@/lib/utils";
import { useBackend } from "./chat-provider";
import { useSourceSelection } from "./source-selection";
import { useTargetSelection } from "./target-selection";

/** Every page id nested under a folder (its own pages plus every descendant
 * subfolder's pages) — what checking the folder's box selects/deselects. */
function collectPageIds(folder: WikiFolderNode): number[] {
  return [...folder.pages.map((p) => p.id), ...folder.children.flatMap(collectPageIds)];
}

function WikiPageRow({
  page,
  checked,
  onToggle,
  isTarget,
  onSetTarget,
}: {
  page: WikiPageSummary;
  checked: boolean;
  onToggle: (id: number, checked: boolean) => void;
  isTarget: boolean;
  onSetTarget: (id: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded px-2 py-1.5 pl-4 text-xs hover:bg-accent">
      <label className="flex flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={checked && !isTarget}
          disabled={isTarget}
          onChange={(e) => onToggle(page.id, e.target.checked)}
        />
        <span className="truncate">{page.title}</span>
      </label>
      <button
        type="button"
        onClick={() => onSetTarget(isTarget ? null : page.id)}
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
          isTarget
            ? "bg-primary text-primary-foreground"
            : "border border-border text-muted-foreground hover:border-primary",
        )}
      >
        {isTarget ? "Target ✓" : "Set target"}
      </button>
    </div>
  );
}

function WikiFolderGroup({
  folder,
  wikiPageIds,
  onTogglePage,
  onToggleFolder,
  targetPageId,
  onSetTarget,
}: {
  folder: WikiFolderNode;
  wikiPageIds: number[];
  onTogglePage: (id: number, checked: boolean) => void;
  onToggleFolder: (ids: number[], checked: boolean) => void;
  targetPageId: number | null;
  onSetTarget: (id: number | null) => void;
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
            isTarget={targetPageId === p.id}
            onSetTarget={onSetTarget}
          />
        ))}
        {folder.children.map((child) => (
          <WikiFolderGroup
            key={child.id}
            folder={child}
            wikiPageIds={wikiPageIds}
            onTogglePage={onTogglePage}
            onToggleFolder={onToggleFolder}
            targetPageId={targetPageId}
            onSetTarget={onSetTarget}
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
  const { targetPageId, setTargetPageId } = useTargetSelection();
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

  // Setting a page as Target also drops it out of the plain source
  // checkboxes so the UI never shows it double-selected (the request body
  // itself is also guarded against this in api-adapter, independently).
  function handleSetTarget(id: number | null) {
    setTargetPageId(id);
    if (id !== null && wikiPageIds.includes(id)) {
      setWikiPageIds(wikiPageIds.filter((x) => x !== id));
    }
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
                  isTarget={targetPageId === p.id}
                  onSetTarget={handleSetTarget}
                />
              ))}
              {wikiTree.roots.map((f) => (
                <WikiFolderGroup
                  key={f.id}
                  folder={f}
                  wikiPageIds={wikiPageIds}
                  onTogglePage={toggleWikiPage}
                  onToggleFolder={toggleWikiFolder}
                  targetPageId={targetPageId}
                  onSetTarget={handleSetTarget}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
