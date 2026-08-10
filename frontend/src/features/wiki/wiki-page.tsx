import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/features/settings/settings-provider";
import { buildWikiLinkResolver, buildWikiTree, type WikiFolderNode, type WikiFolderTree } from "./tree";
import { useWikiTree } from "./use-wiki";
import { FolderView } from "./folder-view";
import { WikiPageView } from "./page-view";
import { ProposalsInbox, usePendingProposalCount } from "./proposals-inbox";
import { WikiIconButton } from "./wiki-actions";
import {
  DeleteConfirmDialog,
  MoveDialog,
  NewFolderDialog,
  NewPageDialog,
  RenameDialog,
  type PageOrFolderTarget,
} from "./wiki-dialogs";
import { WikiTreePanel } from "./wiki-tree-panel";
import { FolderOutline } from "./folder-outline";

type WikiRoute =
  | { kind: "folder"; id: number | null }
  | { kind: "page"; slug: string; edit?: boolean }
  | { kind: "proposals" };

type FolderDialog = null | "new-page" | "new-folder" | "rename" | "move" | "delete";
type RowDialog = "rename" | "move" | "delete";

// Persist the current wiki location so a page reload returns to the same
// folder/page/proposals view instead of the wiki root.
const WIKI_ROUTE_KEY = "knowledge-assistant:wiki-route";

function loadRoute(): WikiRoute {
  try {
    const raw = localStorage.getItem(WIKI_ROUTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WikiRoute;
      if (
        parsed?.kind === "folder" ||
        parsed?.kind === "page" ||
        parsed?.kind === "proposals"
      ) {
        return parsed;
      }
    }
  } catch {
    // fall through to the default root
  }
  return { kind: "folder", id: null };
}

/**
 * Owner-only controls for the folder currently being browsed: create a page
 * or subfolder here, and (when not at the wiki root) rename/move/delete this
 * folder — delete is only offered once the folder is empty.
 */
function FolderToolbar({
  folderId,
  node,
  tree,
  onChanged,
  onCreatedPage,
  onDeletedFolder,
}: {
  folderId: number | null;
  node: WikiFolderNode | null;
  tree: WikiFolderTree;
  onChanged: () => void;
  onCreatedPage: (slug: string) => void;
  onDeletedFolder: (parentId: number | null) => void;
}) {
  const [dialog, setDialog] = useState<FolderDialog>(null);
  const isEmpty = node ? node.children.length === 0 && node.pages.length === 0 : false;

  return (
    <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2">
      <WikiIconButton action="new-page" onClick={() => setDialog("new-page")} />
      <WikiIconButton action="new-folder" onClick={() => setDialog("new-folder")} />
      {node && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          <span className="text-xs text-muted-foreground">This folder:</span>
          <WikiIconButton action="rename" label="Rename folder" onClick={() => setDialog("rename")} />
          <WikiIconButton action="move" label="Move folder" onClick={() => setDialog("move")} />
          {isEmpty && (
            <WikiIconButton
              action="delete"
              label="Delete folder"
              className="text-destructive hover:text-destructive"
              onClick={() => setDialog("delete")}
            />
          )}
        </>
      )}

      {dialog === "new-page" && (
        <NewPageDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          tree={tree}
          defaultFolderId={folderId}
          onCreated={(page) => {
            setDialog(null);
            onChanged();
            onCreatedPage(page.slug);
          }}
        />
      )}
      {dialog === "new-folder" && (
        <NewFolderDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          tree={tree}
          defaultParentId={folderId}
          onCreated={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog === "rename" && node && (
        <RenameDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          target={{ kind: "folder", folder: node }}
          onRenamed={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog === "move" && node && (
        <MoveDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          target={{ kind: "folder", folder: node }}
          tree={tree}
          onMoved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog === "delete" && node && (
        <DeleteConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          target={{ kind: "folder", folder: node }}
          onDeleted={() => {
            setDialog(null);
            onChanged();
            onDeletedFolder(node.parent_id);
          }}
        />
      )}
    </div>
  );
}

/**
 * Route shell for the wiki section: folder navigation (root + nested
 * folders) and a page view (view/edit toggle, CRUD dialogs).
 *
 * `openSlug` lets a caller outside the wiki (a chat citation chip, via the
 * `wiki-navigation` bridge — there's no client-side router to carry a real
 * deep link) jump straight to a specific page; `onOpened` is called once the
 * jump has been applied so the caller can clear its pending request.
 */
export function WikiPage({
  openSlug,
  onOpened,
  homeToken,
  openProposalsToken,
}: {
  openSlug?: string | null;
  onOpened?: () => void;
  /** Increments when the Wiki nav item is re-clicked — resets to the root. */
  homeToken?: number;
  /** Increments when a finished skill run asks to review its proposal. */
  openProposalsToken?: number;
} = {}) {
  const { tree: rawTree, loading: treeLoading, error: treeError, refresh: refreshTree } = useWikiTree();
  const [route, setRoute] = useState<WikiRoute>(loadRoute);
  const { ownerToken } = useSettings();
  const isOwner = Boolean(ownerToken);
  // Visible to visitors too (read-only pending count) — fetched independently
  // of `ProposalsInbox` itself so the badge shows without opening the inbox.
  // `null` while loading, so the badge doesn't flash a stale/zero count.
  const pendingCount = usePendingProposalCount();

  // Per-row actions from the folder grid share one set of dialogs, lifted here
  // so a click on any page/folder row can open them.
  const [rowTarget, setRowTarget] = useState<PageOrFolderTarget | null>(null);
  const [rowDialog, setRowDialog] = useState<RowDialog | null>(null);
  const handleItemAction = (target: PageOrFolderTarget, action: RowDialog) => {
    setRowTarget(target);
    setRowDialog(action);
  };
  const closeRow = () => {
    setRowDialog(null);
    setRowTarget(null);
  };

  const tree = useMemo(() => buildWikiTree(rawTree.folders, rawTree.pages), [rawTree]);
  const resolve = useMemo(() => buildWikiLinkResolver(rawTree.pages), [rawTree]);

  const onNavigateFolder = (id: number | null) => setRoute({ kind: "folder", id });
  const onNavigatePage = (slug: string) => setRoute({ kind: "page", slug });

  useEffect(() => {
    if (!openSlug) return;
    setRoute({ kind: "page", slug: openSlug });
    onOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSlug]);

  // Remember the current location across reloads.
  useEffect(() => {
    localStorage.setItem(WIKI_ROUTE_KEY, JSON.stringify(route));
  }, [route]);

  // Reset to the wiki root when the Wiki nav item is re-clicked. Skip the
  // initial mount so a restored deep location (or a citation deep-link) isn't
  // immediately overwritten.
  const firstHome = useRef(true);
  useEffect(() => {
    if (firstHome.current) {
      firstHome.current = false;
      return;
    }
    setRoute({ kind: "folder", id: null });
  }, [homeToken]);

  // Same skip-the-mount rule as homeToken: a restored location must not be
  // overwritten just because the app started.
  const firstProposals = useRef(true);
  useEffect(() => {
    if (firstProposals.current) {
      firstProposals.current = false;
      return;
    }
    setRoute({ kind: "proposals" });
  }, [openProposalsToken]);

  const treePanel = !treeLoading && !treeError && (
    <WikiTreePanel
      tree={tree}
      activeFolderId={route.kind === "folder" ? route.id : null}
      activeSlug={route.kind === "page" ? route.slug : null}
      onNavigateFolder={onNavigateFolder}
      onNavigatePage={onNavigatePage}
    />
  );

  if (route.kind === "page") {
    return (
      <div className="flex h-full min-h-0">
        {treePanel}
        <div role="region" aria-label="Wiki content" className="min-w-0 flex-1">
          <WikiPageView
            slug={route.slug}
            tree={tree}
            resolve={resolve}
            startInEdit={route.edit}
            onNavigateFolder={onNavigateFolder}
            onNavigatePage={onNavigatePage}
          />
        </div>
      </div>
    );
  }

  if (route.kind === "proposals") {
    return (
      <div className="flex h-full min-h-0">
        {treePanel}
        <div
          role="region"
          aria-label="Wiki content"
          className="h-full min-w-0 flex-1 overflow-y-auto px-6 py-6"
        >
          <div className="mx-auto mb-4 flex max-w-3xl">
            <Button size="sm" variant="ghost" onClick={() => onNavigateFolder(null)}>
              ← Back to wiki
            </Button>
          </div>
          <ProposalsInbox onApproved={onNavigatePage} />
        </div>
      </div>
    );
  }

  const node = route.id !== null ? (tree.byId.get(route.id) ?? null) : null;

  return (
    <div className="flex h-full min-h-0">
      {treePanel}
      <div
        role="region"
        aria-label="Wiki content"
        className="h-full min-w-0 flex-1 overflow-y-auto px-6 py-6"
      >
        {treeLoading ? (
          <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading wiki…</p>
        ) : treeError ? (
          <p role="alert" className="mx-auto max-w-3xl text-sm text-destructive">
            {treeError}
          </p>
        ) : (
          <div className="mx-auto flex max-w-5xl gap-8">
            <div role="region" aria-label="Folder browser" className="min-w-0 max-w-3xl flex-1">
              <div className="mb-4 flex items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">AI edit suggestions</span>
                <div className="relative">
                  <WikiIconButton
                    action="proposals"
                    onClick={() => setRoute({ kind: "proposals" })}
                  />
                  {pendingCount !== null && pendingCount > 0 && (
                    <span className="pointer-events-none absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {pendingCount}
                    </span>
                  )}
                </div>
              </div>
              {isOwner && (
                <FolderToolbar
                  folderId={route.id}
                  node={node}
                  tree={tree}
                  onChanged={refreshTree}
                  onCreatedPage={(slug) => setRoute({ kind: "page", slug, edit: true })}
                  onDeletedFolder={(parentId) => onNavigateFolder(parentId)}
                />
              )}
              <FolderView
                tree={tree}
                folderId={route.id}
                isOwner={isOwner}
                onNavigateFolder={onNavigateFolder}
                onNavigatePage={onNavigatePage}
                onItemAction={handleItemAction}
              />
            </div>
            <FolderOutline
              tree={tree}
              folderId={route.id}
              onNavigateFolder={onNavigateFolder}
              onNavigatePage={onNavigatePage}
              className="no-print hidden w-48 shrink-0 xl:block"
            />
          </div>
        )}

        {rowTarget && rowDialog === "rename" && (
          <RenameDialog
            open
            onOpenChange={(open) => !open && closeRow()}
            target={rowTarget}
            onRenamed={() => {
              closeRow();
              refreshTree();
            }}
          />
        )}
        {rowTarget && rowDialog === "move" && (
          <MoveDialog
            open
            onOpenChange={(open) => !open && closeRow()}
            target={rowTarget}
            tree={tree}
            onMoved={() => {
              closeRow();
              refreshTree();
            }}
          />
        )}
        {rowTarget && rowDialog === "delete" && (
          <DeleteConfirmDialog
            open
            onOpenChange={(open) => !open && closeRow()}
            target={rowTarget}
            onDeleted={() => {
              closeRow();
              refreshTree();
            }}
          />
        )}
      </div>
    </div>
  );
}
