import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadSettings } from "@/features/settings/settings-storage";
import { buildWikiLinkResolver, buildWikiTree, type WikiFolderNode, type WikiFolderTree } from "./tree";
import { useWikiTree } from "./use-wiki";
import { FolderView } from "./folder-view";
import { WikiPageView } from "./page-view";
import {
  DeleteConfirmDialog,
  MoveDialog,
  NewFolderDialog,
  NewPageDialog,
  RenameDialog,
} from "./wiki-dialogs";

type WikiRoute =
  | { kind: "folder"; id: number | null }
  | { kind: "page"; slug: string; edit?: boolean };

type FolderDialog = null | "new-page" | "new-folder" | "rename" | "move" | "delete";

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
    <div className="mx-auto mb-4 flex max-w-3xl flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setDialog("new-page")}>
        New page
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDialog("new-folder")}>
        New folder
      </Button>
      {node && (
        <>
          <Button size="sm" variant="outline" onClick={() => setDialog("rename")}>
            Rename folder
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("move")}>
            Move folder
          </Button>
          {isEmpty && (
            <Button size="sm" variant="destructive" onClick={() => setDialog("delete")}>
              Delete folder
            </Button>
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
  const { tree: rawTree, refresh: refreshTree } = useWikiTree();
  const [route, setRoute] = useState<WikiRoute>({ kind: "folder", id: null });
  const isOwner = Boolean(loadSettings().ownerToken);

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

  const node = route.id !== null ? (tree.byId.get(route.id) ?? null) : null;

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
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
      />
    </div>
  );
}
