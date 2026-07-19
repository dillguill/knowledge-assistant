import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadSettings } from "@/features/settings/settings-storage";
import { updatePage } from "./api";
import { useWikiPage } from "./use-wiki";
import { WikiMarkdown, type WikiLinkResolver } from "./wiki-markdown";
import { folderBreadcrumb, type WikiFolderTree } from "./tree";
import { PageEditor } from "./page-editor";
import { DeleteConfirmDialog, MoveDialog, RenameDialog } from "./wiki-dialogs";

type PageDialog = null | "rename" | "move" | "delete";

const AUTHOR_LABEL: Record<"owner" | "assistant", string> = {
  owner: "edited by owner",
  assistant: "edited by assistant",
};

const DISCARD_PROMPT = "Discard unsaved changes?";

/**
 * View/edit for a single wiki page. Visitors (no owner token) only ever see
 * the rendered content, breadcrumb, and last-updated line — no write
 * affordances at all. Owners get Edit/Rename/Move/Delete.
 */
export function WikiPageView({
  slug,
  tree,
  resolve,
  startInEdit = false,
  onNavigateFolder,
  onNavigatePage,
}: {
  slug: string;
  tree: WikiFolderTree;
  resolve: WikiLinkResolver;
  startInEdit?: boolean;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
}) {
  const { page, refresh } = useWikiPage(slug);
  const isOwner = Boolean(loadSettings().ownerToken);

  const [mode, setMode] = useState<"view" | "edit">(startInEdit ? "edit" : "view");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PageDialog>(null);
  // Tracks which slug `draft` was last seeded for, so a background refresh
  // (e.g. after Save) never clobbers in-progress typing.
  const [loadedForSlug, setLoadedForSlug] = useState<string | null>(null);

  // Reset local UI state when navigating to a different page.
  useEffect(() => {
    setMode(startInEdit ? "edit" : "view");
    setNote("");
    setError(null);
    setDialog(null);
    setLoadedForSlug(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Seed the draft the first time this page's content loads for the current
  // slug (covers both "open an existing page" and "just-created page whose
  // content arrives after mount" when `startInEdit` is set).
  useEffect(() => {
    if (page && loadedForSlug !== slug) {
      setDraft(page.content);
      setLoadedForSlug(slug);
    }
  }, [page, slug, loadedForSlug]);

  const dirty = mode === "edit" && page !== null && draft !== page.content;

  function guardedNavigateFolder(id: number | null) {
    if (dirty && !window.confirm(DISCARD_PROMPT)) return;
    onNavigateFolder(id);
  }

  function guardedNavigatePage(target: string) {
    if (dirty && !window.confirm(DISCARD_PROMPT)) return;
    onNavigatePage(target);
  }

  function handleEdit() {
    if (!page) return;
    setDraft(page.content);
    setError(null);
    setMode("edit");
  }

  function handleCancel() {
    if (page) setDraft(page.content);
    setNote("");
    setError(null);
    setMode("view");
  }

  async function handleSave() {
    if (!page) return;
    setSaving(true);
    setError(null);
    try {
      await updatePage(page.id, draft, note);
      setNote("");
      setMode("view");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save page.");
    } finally {
      setSaving(false);
    }
  }

  if (!page) {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
        <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const breadcrumb = page.folder_id !== null ? folderBreadcrumb(page.folder_id, tree.byId) : [];
  const authorKey = page.last_version?.author ?? page.last_author ?? null;

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          <button
            onClick={() => guardedNavigateFolder(null)}
            className="hover:text-foreground hover:underline"
          >
            Wiki
          </button>
          {breadcrumb.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <button
                onClick={() => guardedNavigateFolder(f.id)}
                className="hover:text-foreground hover:underline"
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{page.title}</h1>
            <p className="font-mono text-xs text-muted-foreground">
              updated {page.updated_at}
              {authorKey && <> · {AUTHOR_LABEL[authorKey]}</>}
            </p>
          </div>
          {isOwner && mode === "view" && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleEdit}>
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("rename")}>
                Rename
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("move")}>
                Move
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDialog("delete")}>
                Delete
              </Button>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {mode === "view" ? (
          <WikiMarkdown content={page.content} resolve={resolve} onNavigate={guardedNavigatePage} />
        ) : (
          <div className="flex flex-col gap-3">
            <PageEditor value={draft} onChange={setDraft} autoFocus />
            <label htmlFor="save-note" className="sr-only">
              Note (optional)
            </label>
            <Input
              id="save-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed? (optional note)"
            />
            <div className="flex gap-2">
              <Button onClick={() => void handleSave()} disabled={saving}>
                Save
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {dialog === "rename" && (
        <RenameDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          target={{ kind: "page", page }}
          onRenamed={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          target={{ kind: "page", page }}
          tree={tree}
          onMoved={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog === "delete" && (
        <DeleteConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          target={{ kind: "page", page }}
          onDeleted={() => {
            setDialog(null);
            onNavigateFolder(page.folder_id);
          }}
        />
      )}
    </div>
  );
}
