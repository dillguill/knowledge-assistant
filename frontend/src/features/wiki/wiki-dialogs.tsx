import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createFolder,
  createPage,
  deleteFolder,
  deletePage,
  patchFolder,
  patchPage,
  type WikiFolder,
  type WikiPage,
  type WikiPageSummary,
} from "./api";
import type { WikiFolderNode, WikiFolderTree } from "./tree";

/** A page or a folder — the CRUD dialogs below act on either. */
export type PageOrFolderTarget =
  | { kind: "page"; page: WikiPage | WikiPageSummary }
  | { kind: "folder"; folder: WikiFolder | WikiFolderNode };

function targetLabel(target: PageOrFolderTarget): string {
  return target.kind === "page" ? target.page.title : target.folder.name;
}

function targetNoun(target: PageOrFolderTarget): "page" | "folder" {
  return target.kind;
}

/** Flattens the folder tree into `<select>` options (indented by depth), with
 * a "Wiki (root)" option for `folder_id: null`. When `excludeSubtreeRootId`
 * is set, that folder and everything under it is left out — used by the move
 * dialog so a folder can't be moved into itself or one of its own children. */
function flattenFolders(
  tree: WikiFolderTree,
  excludeSubtreeRootId?: number | null,
): { id: number | null; label: string }[] {
  const options: { id: number | null; label: string }[] = [{ id: null, label: "Wiki (root)" }];
  function walk(nodes: WikiFolderNode[], depth: number) {
    for (const n of nodes) {
      if (n.id === excludeSubtreeRootId) continue;
      options.push({ id: n.id, label: `${"— ".repeat(depth)}${n.name}` });
      walk(n.children, depth + 1);
    }
  }
  walk(tree.roots, 0);
  return options;
}

function FolderSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: number | null;
  onChange: (id: number | null) => void;
  options: { id: number | null; label: string }[];
}) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {options.map((o) => (
        <option key={o.id ?? "root"} value={o.id ?? ""}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NewPageDialog({
  open,
  onOpenChange,
  tree,
  defaultFolderId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: WikiFolderTree;
  defaultFolderId: number | null;
  onCreated: (page: WikiPage) => void;
}) {
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<number | null>(defaultFolderId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => flattenFolders(tree), [tree]);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setFolderId(defaultFolderId);
    setError(null);
  }, [open, defaultFolderId]);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const page = await createPage(trimmed, folderId);
      onCreated(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create page.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor="new-page-title" className="sr-only">
            Title
          </label>
          <Input
            id="new-page-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            autoFocus
          />
          <label htmlFor="new-page-folder" className="sr-only">
            Folder
          </label>
          <FolderSelect id="new-page-folder" value={folderId} onChange={setFolderId} options={options} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy || !title.trim()}>
            Create page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewFolderDialog({
  open,
  onOpenChange,
  tree,
  defaultParentId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: WikiFolderTree;
  defaultParentId: number | null;
  onCreated: (folder: WikiFolder) => void;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | null>(defaultParentId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => flattenFolders(tree), [tree]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setParentId(defaultParentId);
    setError(null);
  }, [open, defaultParentId]);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const folder = await createFolder(trimmed, parentId);
      onCreated(folder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create folder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor="new-folder-name" className="sr-only">
            Name
          </label>
          <Input
            id="new-folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            autoFocus
          />
          <label htmlFor="new-folder-parent" className="sr-only">
            Parent folder
          </label>
          <FolderSelect id="new-folder-parent" value={parentId} onChange={setParentId} options={options} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy || !name.trim()}>
            Create folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({
  open,
  onOpenChange,
  target,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PageOrFolderTarget;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(targetLabel(target));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(targetLabel(target));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      if (target.kind === "page") await patchPage(target.page.id, { title: trimmed });
      else await patchFolder(target.folder.id, { name: trimmed });
      onRenamed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename.");
    } finally {
      setBusy(false);
    }
  }

  const noun = targetNoun(target);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {noun}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor="rename-name" className="sr-only">
            Name
          </label>
          <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy || !name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({
  open,
  onOpenChange,
  target,
  tree,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PageOrFolderTarget;
  tree: WikiFolderTree;
  onMoved: () => void;
}) {
  const currentFolderId = target.kind === "page" ? target.page.folder_id : target.folder.parent_id;
  const [folderId, setFolderId] = useState<number | null>(currentFolderId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(
    () => flattenFolders(tree, target.kind === "folder" ? target.folder.id : null),
    [tree, target],
  );

  useEffect(() => {
    if (!open) return;
    setFolderId(currentFolderId);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      if (target.kind === "page") await patchPage(target.page.id, { folder_id: folderId });
      else await patchFolder(target.folder.id, { parent_id: folderId });
      onMoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move.");
    } finally {
      setBusy(false);
    }
  }

  const noun = targetNoun(target);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {noun}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor="move-folder" className="sr-only">
            Destination folder
          </label>
          <FolderSelect id="move-folder" value={folderId} onChange={setFolderId} options={options} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            Move {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  target,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PageOrFolderTarget;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = targetNoun(target);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      if (target.kind === "page") await deletePage(target.page.id);
      else await deleteFolder(target.folder.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {noun}</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{targetLabel(target)}&rdquo;? This can&rsquo;t be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
            Delete {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
