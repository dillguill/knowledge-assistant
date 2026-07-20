import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import type { ApiModel } from "./use-models";

function providerFromId(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : "other";
}

function modelLabel(id: string, name: string): string {
  const slash = id.indexOf("/");
  if (slash > 0) {
    return id.slice(slash + 1).replace(/:free$/, "");
  }
  return name;
}

type GroupedModels = Record<string, ApiModel[]>;

function groupByProvider(models: ApiModel[]): GroupedModels {
  const groups: GroupedModels = {};
  for (const m of models) {
    const p = providerFromId(m.id);
    (groups[p] ??= []).push(m);
  }
  return groups;
}

export function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: ApiModel[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedModel = value ? models.find((m) => m.id === value) : null;

  const groups = useMemo(() => groupByProvider(models), [models]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    const result: GroupedModels = {};
    for (const [provider, items] of Object.entries(groups)) {
      const filtered = items.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      );
      if (filtered.length > 0) result[provider] = filtered;
    }
    return result;
  }, [groups, search]);

  if (models.length === 0) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Model"
          className={cn(
            "h-8 max-w-44 truncate rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            selectedModel && "border-primary/30 text-primary",
          )}
          title={selectedModel?.name ?? "Default model"}
        >
          {selectedModel?.name ?? "Default model"}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
          className="bg-popover text-popover-foreground z-50 min-w-56 max-h-72 overflow-hidden rounded-xl border p-1 shadow-lg"
        >
          <div className="px-1 pb-1">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto max-h-56">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
                setSearch("");
              }}
              className={cn(
                "flex items-center rounded-lg px-2.5 py-1.5 text-xs outline-none hover:bg-accent",
                value === null && "bg-accent font-medium",
              )}
            >
              Default model
            </button>
            {Object.entries(filtered).map(([provider, items]) => (
              <div key={provider}>
                <div className="text-muted-foreground px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider">
                  {provider}
                </div>
                {items.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "flex w-full flex-col rounded-lg px-2.5 py-1.5 text-xs outline-none hover:bg-accent",
                      value === m.id && "bg-accent font-medium",
                    )}
                  >
                    <span className="truncate">
                      {modelLabel(m.id, m.name)}
                    </span>
                    {m.context_length && (
                      <span className="text-muted-foreground text-[10px]">
                        {(m.context_length / 1024 / 1024).toFixed(0)}M ctx
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
