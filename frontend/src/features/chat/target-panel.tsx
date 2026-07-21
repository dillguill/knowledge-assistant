import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettings } from "@/features/settings/settings-provider";
import { updatePage } from "@/features/wiki/api";
import { PageEditor } from "@/features/wiki/page-editor";
import { WikiMarkdown, type WikiLinkResolver } from "@/features/wiki/wiki-markdown";
import { bumpTargetRefresh, useTargetPage, useTargetSelection } from "./target-selection";
import { X } from "lucide-react";

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
 *
 * Fetching is shared with `proposal-card.tsx` via `useTargetPage()` (both
 * need "the current content of the targeted page") rather than each keeping
 * its own copy of the same fetch-on-target-change effect.
 */
export function TargetPanel() {
  const { targetPageId, setTargetPageId } = useTargetSelection();
  const { page } = useTargetPage();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ownerToken } = useSettings();
  const isOwner = Boolean(ownerToken);
  const [mobileOpen, setMobileOpen] = useState(false);

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
      await updatePage(page.id, draft);
      bumpTargetRefresh();
      setMode("view");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save page.");
    } finally {
      setSaving(false);
    }
  }

  const panelContent = (
    <div className={cn(
      "flex flex-col gap-3 overflow-y-auto",
      "md:h-full md:w-80 md:shrink-0 md:border-s md:border-border md:bg-card md:p-4",
      mobileOpen
        ? "fixed inset-x-0 bottom-0 z-50 max-h-[70vh] rounded-t-xl border border-border bg-card p-4 shadow-xl"
        : "hidden",
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">
          Target{page ? `: ${page.title}` : ""}
        </span>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" className="md:hidden" onClick={() => setMobileOpen(false)}>
            <X className="size-4" />
          </Button>
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
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}

      {!page ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mode === "view" ? (
        <WikiMarkdown content={page.content} resolve={noResolve} />
      ) : (
        <div className="flex flex-col gap-3">
          <PageEditor value={draft} onChange={setDraft} autoFocus />
          <div className="flex gap-2">
            <Button onClick={() => void handleSave()} disabled={saving}>Save</Button>
            <Button variant="outline" onClick={handleCancel} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile toggle button */}
      <button
        type="button"
        aria-label="Toggle target panel"
        className="fixed bottom-4 right-4 z-50 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
        onClick={() => setMobileOpen((o) => !o)}
      >
        <X className={cn("size-5 transition-transform", mobileOpen && "rotate-45")} />
      </button>
      {panelContent}
    </>
  );
}
