import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/features/settings/settings-provider";
import { relativeTime } from "@/lib/time";
import { updatePage } from "./api";
import { useWikiHistory, useWikiPage } from "./use-wiki";
import { WikiMarkdown, type WikiLinkResolver } from "./wiki-markdown";
import { folderBreadcrumb, type WikiFolderTree } from "./tree";
import { PageEditor } from "./page-editor";
import { WikiIconButton } from "./wiki-actions";
import { DeleteConfirmDialog, MoveDialog, RenameDialog } from "./wiki-dialogs";
import { HistoryPanel } from "./history-panel";
import { exportPageAsMarkdown, exportPageAsPdf } from "./export";

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
  const { history, refresh: refreshHistory } = useWikiHistory(page?.id ?? null);
  const { ownerToken } = useSettings();
  const isOwner = Boolean(ownerToken);

  const [mode, setMode] = useState<"view" | "edit">(startInEdit ? "edit" : "view");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PageDialog>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Tracks which slug `draft` was last seeded for, so a background refresh
  // (e.g. after Save) never clobbers in-progress typing.
  const [loadedForSlug, setLoadedForSlug] = useState<string | null>(null);

  // Reset local UI state when navigating to a different page.
  useEffect(() => {
    setMode(startInEdit ? "edit" : "view");
    setNote("");
    setError(null);
    setDialog(null);
    setShowHistory(false);
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
      refreshHistory();
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
  // Prefer the git-backed history's most recent entry (the substrate this
  // milestone is moving to) over the older wiki_versions-derived fields,
  // which stay only as a fallback while wiki_versions still dual-writes.
  const latest = history[0] ?? null;
  const authorKey = latest?.author ?? page.last_version?.author ?? page.last_author ?? null;
  const lastUpdatedAt = latest?.created_at ?? page.updated_at;

  return (
    <div className="wiki-print-area h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <nav
          aria-label="Breadcrumb"
          className="no-print flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
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
            <p className="text-xs text-muted-foreground" title={lastUpdatedAt}>
              updated {relativeTime(lastUpdatedAt)}
              {authorKey && <> · {AUTHOR_LABEL[authorKey]}</>}
            </p>
          </div>
          {mode === "view" && (
            <div className="no-print flex shrink-0 flex-wrap items-center gap-2">
              {isOwner && (
                <WikiIconButton action="edit" onClick={handleEdit} />
              )}
              <WikiIconButton
                action="history"
                variant={showHistory ? "secondary" : "outline"}
                aria-pressed={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              />
              <WikiIconButton
                action="export-md"
                onClick={() => exportPageAsMarkdown(page.slug, page.content)}
              />
              <WikiIconButton action="export-pdf" onClick={() => exportPageAsPdf()} />
              {isOwner && (
                <>
                  <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                  <WikiIconButton action="rename" onClick={() => setDialog("rename")} />
                  <WikiIconButton action="move" onClick={() => setDialog("move")} />
                  <WikiIconButton
                    action="delete"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDialog("delete")}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="no-print text-sm text-destructive">
            {error}
          </p>
        )}

        {mode === "view" && showHistory && (
          <div className="no-print">
            <HistoryPanel
              pageId={page.id}
              currentContent={page.content}
              resolve={resolve}
              isOwner={isOwner}
              onClose={() => setShowHistory(false)}
              onRestored={() => {
                refresh();
                refreshHistory();
              }}
            />
          </div>
        )}

        {mode === "view" ? (
          <WikiMarkdown content={page.content} resolve={resolve} onNavigate={guardedNavigatePage} />
        ) : (
          <div className="no-print flex flex-col gap-3">
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
