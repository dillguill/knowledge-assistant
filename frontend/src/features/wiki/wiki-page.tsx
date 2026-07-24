import { useEffect, useMemo, useState } from "react";
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

type WikiRoute =
  | { kind: "folder"; id: number | null }
  | { kind: "page"; slug: string; edit?: boolean }
  | { kind: "proposals" };

type FolderDialog = null | "new-page" | "new-folder" | "rename" | "move" | "delete";
type RowDialog = "rename" | "move" | "delete";

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
}: {
  openSlug?: string | null;
  onOpened?: () => void;
} = {}) {
  const { tree: rawTree, loading: treeLoading, error: treeError, refresh: refreshTree } = useWikiTree();
  const [route, setRoute] = useState<WikiRoute>({ kind: "folder", id: null });
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

  if (route.kind === "page") {
    return (
      <WikiPageView
        slug={route.slug}
        tree={tree}
        resolve={resolve}
        startInEdit={route.edit}
        onNavigateFolder={onNavigateFolder}
        onNavigatePage={onNavigatePage}
      />
    );
  }

  if (route.kind === "proposals") {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
        <div className="mx-auto mb-4 flex max-w-3xl">
          <Button size="sm" variant="ghost" onClick={() => onNavigateFolder(null)}>
            ← Back to wiki
          </Button>
        </div>
        <ProposalsInbox onApproved={onNavigatePage} />
      </div>
    );
  }

  const node = route.id !== null ? (tree.byId.get(route.id) ?? null) : null;

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      {treeLoading ? (
        <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading wiki…</p>
      ) : treeError ? (
        <p role="alert" className="mx-auto max-w-3xl text-sm text-destructive">
          {treeError}
        </p>
      ) : (
        <>
          <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end gap-2">
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
        </>
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
  );
}
