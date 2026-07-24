import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Library, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  createCollection,
  rawFileUrl,
  syncStatus,
  uploadFile,
  type Collection,
} from "./api";
import { useCollections, useFiles } from "./use-knowledge";

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function fileExt(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()!.toUpperCase() : "FILE";
}

export function DocumentsPage() {
  const { collections, loading: collectionsLoading, refresh } = useCollections();
  const [selected, setSelected] = useState<Collection | null>(null);
  const { files, loading: filesLoading, refresh: refreshFiles } = useFiles(
    selected?.id ?? null,
  );
  const [sync, setSync] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    syncStatus().then(setSync).catch(() => setSync(""));
  }, [files]);

  // Keep the selected collection's file_count fresh as the list refetches.
  useEffect(() => {
    if (!selected) return;
    const latest = collections.find((c) => c.id === selected.id);
    if (latest && latest.file_count !== selected.file_count) setSelected(latest);
  }, [collections, selected]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    setCreating(true);
    try {
      await createCollection(name);
      setNewName("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create collection.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList?.length || !selected) return;
    setError(null);
    setUploading(true);
    try {
      for (const f of Array.from(fileList)) await uploadFile(selected.id, f);
      refreshFiles();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 px-6 py-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Library className="size-5 text-muted-foreground" aria-hidden />
              Documents
            </h1>
            <p className="text-sm text-muted-foreground">
              Uploaded source collections — every answer resolves back to a file
              here.
            </p>
          </div>
          {sync && (
            <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              sync: {sync}
            </span>
          )}
        </header>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[16rem_1fr]">
          {/* Collections column */}
          <aside className="flex min-h-0 flex-col gap-3">
            <div className="flex gap-2">
              <label htmlFor="new-collection" className="sr-only">
                New collection name
              </label>
              <Input
                id="new-collection"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                placeholder="New collection…"
              />
              <Button
                size="icon"
                onClick={() => void handleCreate()}
                disabled={creating || !newName.trim()}
                aria-label="New collection"
                title="New collection"
              >
                <Plus />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {collectionsLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : collections.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No collections yet. Create one to start uploading.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {collections.map((c) => {
                    const active = selected?.id === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => setSelected(c)}
                          aria-current={active ? "true" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                            active
                              ? "border-primary bg-primary/5"
                              : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                          )}
                        >
                          <FolderOpen
                            className={cn(
                              "size-4 shrink-0",
                              active ? "text-primary" : "text-muted-foreground",
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {c.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {c.file_count} {c.file_count === 1 ? "file" : "files"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Detail column */}
          <section className="min-h-0">
            {!selected ? (
              <Card className="h-full items-center justify-center gap-3 border-dashed p-8 text-center">
                <FolderOpen className="size-8 text-muted-foreground/50" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Select a collection to view and upload its files.
                </p>
              </Card>
            ) : (
              <Card className="flex h-full min-h-0 flex-col gap-4 p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">{selected.name}</h2>
                  <span className="text-xs text-muted-foreground">
                    {selected.file_count}{" "}
                    {selected.file_count === 1 ? "file" : "files"}
                  </span>
                </div>

                <label
                  htmlFor="kb-upload"
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-accent/40",
                    uploading && "pointer-events-none opacity-60",
                  )}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleUpload(e.dataTransfer.files);
                  }}
                >
                  <Upload className="size-5" aria-hidden />
                  <span>
                    {uploading
                      ? "Uploading…"
                      : "Drop files here or click to browse"}
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    PDF, HTML, text, markdown
                  </span>
                </label>
                <input
                  id="kb-upload"
                  aria-label="Upload file"
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".pdf,.html,.htm,.txt,.md"
                  className="sr-only"
                  onChange={(e) => void handleUpload(e.target.files)}
                />

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {filesLoading ? (
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                  ) : files.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No files yet — upload some to ground your answers.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {files.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center gap-3 px-3 py-2.5 text-sm"
                        >
                          <FileText
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <a
                            href={rawFileUrl(f.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate font-medium hover:underline"
                          >
                            {f.filename}
                          </a>
                          <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {fileExt(f.filename)}
                          </span>
                          <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
                            {formatSize(f.size_bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
