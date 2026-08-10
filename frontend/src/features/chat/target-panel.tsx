import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadSettings } from "@/features/settings/settings-storage";
import { updatePage } from "@/features/wiki/api";
import { PageEditor } from "@/features/wiki/page-editor";
import { WikiMarkdown, type WikiLinkResolver } from "@/features/wiki/wiki-markdown";
import { bumpTargetRefresh, useTargetPage, useTargetSelection } from "./target-selection";

// The target panel doesn't resolve `[[wiki links]]` inside the target page
// (there's no click-through navigation out of the chat panel) — every link
// renders as plain missing-link styling rather than crashing.
const noResolve: WikiLinkResolver = () => ({ slug: "", exists: false });

/**
 * Shows the wiki page currently pinned as the chat's Target, modelled on an
 * artifacts panel: on md+ it splits the content area beside the thread; below
 * md it takes the content area over entirely (the topbar stays reachable).
 * One responsively-styled element rather than two separately-mounted
 * instances, so there's one fetch and one piece of state regardless of
 * viewport. Owners can flip to an inline editor (reusing the same
 * `PageEditor` the wiki page view uses); visitors only ever see the rendered
 * page.
 *
 * Closing the panel does not unpin the page — `panelOpen` is separate state,
 * and the composer's "Editing:" pill reopens it. An earlier version was
 * `hidden md:flex` with every class md-prefixed, so below md a pinned target
 * rendered nothing at all; the mobile branch here is that bug's fix.
 *
 * Fetching is shared with `proposal-card.tsx` via `useTargetPage()` (both
 * need "the current content of the targeted page") rather than each keeping
 * its own copy of the same fetch-on-target-change effect.
 */
export function TargetPanel() {
  const { targetPageId, setPanelOpen } = useTargetSelection();
  const { page } = useTargetPage();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = Boolean(loadSettings().ownerToken);

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

  return (
    <aside
      aria-label="Target page"
      // Below md: takes over the content area (the parent row is `relative`).
      // md+: a flexible split beside the thread rather than a fixed w-80, so
      // the page being edited gets real room on a wide screen.
      className="absolute inset-0 z-20 flex flex-col gap-3 overflow-y-auto bg-card p-4 md:static md:h-full md:w-[45%] md:max-w-[40rem] md:min-w-[22rem] md:shrink-0 md:border-s md:border-border"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-semibold">
          Target{page ? `: ${page.title}` : ""}
        </h2>
        {/* h-11 below md keeps these at a 44px touch target; they are the
            first controls a phone user reaches now that the panel renders. */}
        <div className="flex shrink-0 items-center gap-1">
          {isOwner && mode === "view" && page && (
            <Button
              size="sm"
              variant="outline"
              className="h-11 md:h-8"
              onClick={handleEdit}
            >
              Edit
            </Button>
          )}
          {/* Only closing lives here. Unpinning is the composer pill's X —
              one place for "stop targeting this page", so the header does
              not offer two near-identical dismissals. */}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close target panel"
            className="size-11 md:size-8"
            onClick={() => setPanelOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!page ? (
        // Announced rather than a silent swap from "Loading…" to content.
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Loading…
        </p>
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
    </aside>
  );
}
