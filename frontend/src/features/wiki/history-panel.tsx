import { useEffect, useState } from "react";
import { DiffViewer } from "@/components/assistant-ui/diff-viewer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getVersion, restoreVersion, type WikiVersion } from "./api";
import { useWikiVersions } from "./use-wiki";
import { diffToHunks, hunksToPatch } from "./diff";
import { WikiMarkdown, type WikiLinkResolver } from "./wiki-markdown";

const AUTHOR_LABEL: Record<"owner" | "assistant", string> = {
  owner: "owner",
  assistant: "assistant",
};

/**
 * Version history for a wiki page: newest-first list (trusts the backend's
 * `ORDER BY id DESC`), a unified diff of the selected version against the
 * page's current content, a read-only render of the selected version, and
 * (owner only) restoring it.
 */
export function HistoryPanel({
  pageId,
  currentContent,
  resolve,
  isOwner,
  onClose,
  onRestored,
}: {
  pageId: number;
  currentContent: string;
  resolve: WikiLinkResolver;
  isOwner: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { versions, refresh } = useWikiVersions(pageId);
  const [selected, setSelected] = useState<WikiVersion | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"diff" | "view">("diff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selected) {
      setSelectedContent(null);
      return;
    }
    let cancelled = false;
    setSelectedContent(null);
    getVersion(selected.id)
      .then((detail) => {
        if (!cancelled) setSelectedContent(detail.content);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load that version.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function handleRestore() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await restoreVersion(pageId, selected.id);
      refresh();
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore that version.");
    } finally {
      setBusy(false);
    }
  }

  const patch =
    selectedContent !== null
      ? hunksToPatch(diffToHunks(selectedContent, currentContent), "selected version", "current")
      : null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Version history</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {versions.map((v) => (
          <li key={v.id}>
            <button
              onClick={() => {
                setSelected(v);
                setViewMode("diff");
                setError(null);
              }}
              className={cn(
                "flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-accent",
                selected?.id === v.id && "bg-accent",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  {AUTHOR_LABEL[v.author]}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{v.created_at}</span>
              </span>
              {v.note && <span className="text-xs text-muted-foreground">{v.note}</span>}
            </button>
          </li>
        ))}
        {versions.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">No versions yet.</li>
        )}
      </ul>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {selected && selectedContent !== null && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={viewMode === "diff" ? "secondary" : "outline"}
              onClick={() => setViewMode("diff")}
            >
              Diff vs current
            </Button>
            <Button
              size="sm"
              variant={viewMode === "view" ? "secondary" : "outline"}
              onClick={() => setViewMode("view")}
            >
              View
            </Button>
            {isOwner && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => void handleRestore()}
                disabled={busy}
              >
                Restore this version
              </Button>
            )}
          </div>

          {viewMode === "diff" ? (
            patch && <DiffViewer patch={patch} showIcon={false} />
          ) : (
            <WikiMarkdown content={selectedContent} resolve={resolve} />
          )}
        </div>
      )}
    </div>
  );
}
