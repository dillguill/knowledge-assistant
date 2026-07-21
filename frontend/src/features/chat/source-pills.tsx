import { useMemo } from "react";
import { FileText, FolderOpen, PencilLine, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { useWikiTree } from "@/features/wiki/use-wiki";
import { useCreatePageMode } from "./create-page-mode";
import { useSourceSelection } from "./source-selection";
import { useTargetSelection } from "./target-selection";

type Pill = {
  key: string;
  label: string;
  icon: typeof FileText;
  variant: "source" | "target";
  onRemove: () => void;
};

/**
 * Removable chips for the composer's active source / target selection — the
 * visible, controllable stand-in for `@` mentions (the composer textarea can't
 * render inline chips). Nothing is sent that isn't shown here.
 */
export function SourcePills() {
  const { tree } = useWikiTree();
  const { collections } = useCollections();
  const { wikiPageIds, setWikiPageIds, collectionIds, setCollectionIds } =
    useSourceSelection();
  const { targetPageId, setTargetPageId } = useTargetSelection();
  const { active: createPageActive, setActive: setCreatePageActive } =
    useCreatePageMode();

  const pageTitle = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of tree.pages) m.set(p.id, p.title);
    return m;
  }, [tree.pages]);

  const collectionName = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of collections) m.set(c.id, c.name);
    return m;
  }, [collections]);

  const pills = useMemo<Pill[]>(() => {
    const out: Pill[] = [];
    if (createPageActive) {
      out.push({
        key: "create-page",
        label: "Create page",
        icon: Sparkles,
        variant: "target",
        onRemove: () => setCreatePageActive(false),
      });
    }
    if (targetPageId !== null) {
      out.push({
        key: `target-${targetPageId}`,
        label: `Editing: ${pageTitle.get(targetPageId) ?? `page ${targetPageId}`}`,
        icon: PencilLine,
        variant: "target",
        onRemove: () => setTargetPageId(null),
      });
    }
    for (const id of wikiPageIds) {
      out.push({
        key: `wiki-${id}`,
        label: pageTitle.get(id) ?? `page ${id}`,
        icon: FileText,
        variant: "source",
        onRemove: () => setWikiPageIds(wikiPageIds.filter((x) => x !== id)),
      });
    }
    for (const id of collectionIds) {
      out.push({
        key: `col-${id}`,
        label: collectionName.get(id) ?? `collection ${id}`,
        icon: FolderOpen,
        variant: "source",
        onRemove: () => setCollectionIds(collectionIds.filter((x) => x !== id)),
      });
    }
    return out;
  }, [
    createPageActive,
    setCreatePageActive,
    targetPageId,
    setTargetPageId,
    wikiPageIds,
    setWikiPageIds,
    collectionIds,
    setCollectionIds,
    pageTitle,
    collectionName,
  ]);

  if (pills.length === 0) return null;

  const clearAll = () => {
    if (createPageActive) setCreatePageActive(false);
    if (wikiPageIds.length) setWikiPageIds([]);
    if (collectionIds.length) setCollectionIds([]);
    if (targetPageId !== null) setTargetPageId(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1">
      {pills.map((pill) => {
        const Icon = pill.icon;
        return (
          <span
            key={pill.key}
            className={cn(
              "inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              pill.variant === "target"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-muted text-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{pill.label}</span>
            <button
              type="button"
              aria-label={`Remove ${pill.label}`}
              onClick={pill.onRemove}
              className="hover:bg-foreground/10 -me-1 shrink-0 rounded-full p-0.5"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      {pills.length > 1 && (
        <button
          type="button"
          onClick={clearAll}
          className="text-muted-foreground hover:text-foreground px-1.5 text-xs underline-offset-2 hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
