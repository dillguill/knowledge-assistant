import { useState } from "react";
import { useCollections } from "@/features/knowledge/use-knowledge";
import { cn } from "@/lib/utils";
import { useBackend } from "./chat-provider";
import { useSourceSelection } from "./source-selection";

/** Per-conversation source picker in the composer. Only meaningful when the
 * backend is online (demo mode has no collections). */
export function SourceSelector() {
  const status = useBackend();
  const { collectionIds, setCollectionIds } = useSourceSelection();
  const { collections } = useCollections();
  const [open, setOpen] = useState(false);

  if (status !== "online" || collections.length === 0) return null;

  const count = collectionIds.length;
  function toggle(id: number, checked: boolean) {
    setCollectionIds(
      checked ? [...collectionIds, id] : collectionIds.filter((x) => x !== id),
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {count ? `Sources: ${count}` : "Sources"}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Source collections"
          className="absolute bottom-full z-10 mb-1 max-h-64 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {collections.map((c) => (
            <label
              key={c.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent",
              )}
            >
              <input
                type="checkbox"
                checked={collectionIds.includes(c.id)}
                onChange={(e) => toggle(c.id, e.target.checked)}
              />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-muted-foreground">
                {c.file_count}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
