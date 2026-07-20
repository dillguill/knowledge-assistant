import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadSettings } from "@/features/settings/settings-storage";
import { getPage, updatePage, type WikiPage } from "@/features/wiki/api";
import { PageEditor } from "@/features/wiki/page-editor";
import { WikiMarkdown, type WikiLinkResolver } from "@/features/wiki/wiki-markdown";
import { useTargetSelection } from "./target-selection";

// The target panel doesn't resolve `[[wiki links]]` inside the target page
// (there's no click-through navigation out of the chat panel) — every link
// renders as plain missing-link styling rather than crashing.
const noResolve: WikiLinkResolver = () => ({ slug: "", exists: false });

/**
 * Shows the wiki page currently pinned as the chat's Target: a side panel on
 * md+ screens, a bottom sheet on narrower ones (a single responsively-styled
 * element rather than two separately-mounted instances, so there's one fetch
 * and one piece of state regardless of viewport). Owners can flip to an
 * inline editor (reusing the same `PageEditor` the wiki page view uses);
 * visitors only ever see the rendered page.
 */
export function TargetPanel() {
  const { targetPageId, setTargetPageId, refreshToken } = useTargetSelection();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = Boolean(loadSettings().ownerToken);

  useEffect(() => {
    if (targetPageId === null) {
      setPage(null);
      setMode("view");
      return;
    }
    let cancelled = false;
    getPage(targetPageId)
      .then((p) => {
        if (cancelled) return;
        setPage(p);
        setMode((m) => (m === "edit" ? m : "view"));
      })
      .catch(() => {
        if (!cancelled) setPage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetPageId, refreshToken]);

  if (targetPageId === null) return null;

  function handleEdit() {
    if (!page) return;
    setDraft(page.content);
    setError(null);
    setMode("edit");
  }

  function handleCancel() {
    setError(null);
    setMode("view");
  }

  async function handleSave() {
    if (!page) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePage(page.id, draft);
      setPage(updated);
      setMode("view");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save page.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      aria-label="Target page"
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[70vh] flex-col gap-3 overflow-y-auto border-t border-border bg-card p-4 md:static md:h-full md:max-h-none md:w-80 md:shrink-0 md:overflow-y-auto md:border-t-0 md:border-s"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">
          Target{page ? `: ${page.title}` : ""}
        </span>
        <div className="flex shrink-0 gap-1">
          {isOwner && mode === "view" && page && (
            <Button size="sm" variant="outline" onClick={handleEdit}>
              Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setTargetPageId(null)}>
            Clear
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!page ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mode === "view" ? (
        <WikiMarkdown content={page.content} resolve={noResolve} />
      ) : (
        <div className="flex flex-col gap-3">
          <PageEditor value={draft} onChange={setDraft} autoFocus />
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
  );
}
