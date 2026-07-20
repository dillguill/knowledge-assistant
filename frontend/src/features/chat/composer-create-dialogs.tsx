import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  onNewCollectionRequest,
  onNewWikiPageRequest,
} from "@/app/composer-actions";
import { createCollection } from "@/features/knowledge/api";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { buildWikiTree } from "@/features/wiki/tree";
import { NewPageDialog } from "@/features/wiki/wiki-dialogs";
import { useWikiTree } from "@/features/wiki/use-wiki";
import { useTargetSelection } from "./target-selection";

function NewCollectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
  }, [open]);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await createCollection(trimmed);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create collection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor="new-collection-name" className="sr-only">
            Name
          </label>
          <Input
            id="new-collection-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
            placeholder="Collection name"
            autoFocus
          />
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
          <Button
            onClick={() => void handleSubmit()}
            disabled={busy || !name.trim()}
          >
            Create collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hosts the create-page / create-collection dialogs triggered by the chat `/`
 * commands. Mounted once at the app root so the dialogs overlay whatever view
 * is active — the command performs its action as a modal without navigating
 * the user away from the conversation.
 */
export function ComposerCreateDialogs() {
  const { tree: rawTree, refresh: refreshTree } = useWikiTree();
  const { refresh: refreshCollections } = useCollections();
  const { setTargetPageId } = useTargetSelection();
  const [pageOpen, setPageOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);

  const tree = useMemo(
    () => buildWikiTree(rawTree.folders, rawTree.pages),
    [rawTree],
  );

  useEffect(() => onNewWikiPageRequest(() => setPageOpen(true)), []);
  useEffect(() => onNewCollectionRequest(() => setCollectionOpen(true)), []);

  return (
    <>
      <NewPageDialog
        open={pageOpen}
        onOpenChange={setPageOpen}
        tree={tree}
        defaultFolderId={null}
        onCreated={(page) => {
          setPageOpen(false);
          refreshTree();
          // Open the new page in the chat side panel (same as the edit flow).
          setTargetPageId(page.id);
        }}
      />
      <NewCollectionDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        onCreated={() => {
          setCollectionOpen(false);
          refreshCollections();
        }}
      />
    </>
  );
}
