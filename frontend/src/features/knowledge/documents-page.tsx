import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Gauge, Library, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlaceholderLines, Unavailable } from "@/components/ui/unavailable";
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

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <dt className="font-mono text-eyebrow text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-heading text-xl tabular-nums">{value}</dd>
      <dd className="text-meta text-muted-foreground">{detail}</dd>
    </div>
  );
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

  const totalFiles = collections.reduce((sum, c) => sum + c.file_count, 0);
  const emptyCollections = collections.filter((c) => c.file_count === 0).length;
  const selectedBytes = files.reduce((sum, f) => sum + f.size_bytes, 0);

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
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2.5 text-display">
              <Library className="size-6 text-muted-foreground" aria-hidden />
              Documents
            </h1>
            <p className="max-w-prose text-body text-muted-foreground">
              Uploaded source collections — every answer resolves back to a file
              here.
            </p>
          </div>
          {sync && (
            <span className="rounded-full border border-border px-2.5 py-1 font-mono text-eyebrow text-muted-foreground uppercase">
              sync: {sync}
            </span>
          )}
        </header>

        {error && (
          <p className="text-body text-destructive" role="alert">
            {error}
          </p>
        )}

        {/* Summary before detail: the questions you arrive with, answered
            before a single row. Every figure here is derived from data the
            API already returns — there is no ingest-status field on a file,
            so this deliberately makes no claim about indexing. */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric
            label="Collections"
            value={collectionsLoading ? "—" : String(collections.length)}
            detail={
              emptyCollections > 0 ? `${emptyCollections} empty` : "all in use"
            }
          />
          <Metric
            label="Files"
            value={collectionsLoading ? "—" : String(totalFiles)}
            detail="across all collections"
          />
          <Metric
            label={selected ? `In ${selected.name}` : "Selected"}
            value={selected ? formatSize(selectedBytes) : "—"}
            detail={selected ? `${files.length} files` : "no collection picked"}
          />
        </dl>

        {/* The slot for ingest status. Deliberately not a live metric: a file
            record carries no indexing state today, so any figure here would
            be invented. Marking the slot means the milestone that adds the
            field fills it in rather than redesigning this header. */}
        <Unavailable
          title="Indexing status"
          milestone="v0.7.0"
          note="Which files are chunked and embedded, and which are still pending. Needs an ingest-state field on a document record."
        >
          <div className="flex items-center gap-3 p-4 pb-12">
            <Gauge className="size-4 text-muted-foreground" aria-hidden />
            <PlaceholderLines rows={2} />
          </div>
        </Unavailable>

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
                <p className="px-1 py-6 text-center text-body text-muted-foreground">
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
                            "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-[color,background-color,border-color,box-shadow] duration-200 ease-emphasis",
                            active
                              ? "border-primary bg-primary/5 shadow-raised"
                              : "border-border bg-card hover:border-primary/50 hover:bg-accent hover:shadow-raised",
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
                            <span className="block truncate text-body font-medium">
                              {c.name}
                            </span>
                            <span className="block text-meta text-muted-foreground">
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
                <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <FolderOpen
                    className="size-6 text-muted-foreground"
                    aria-hidden
                  />
                </span>
                <p className="text-heading">No collection selected</p>
                <p className="max-w-xs text-body text-muted-foreground">
                  Pick one on the left to browse its files, or create a new
                  collection to start uploading.
                </p>
              </Card>
            ) : (
              <Card className="flex h-full min-h-0 flex-col gap-4 p-5 shadow-raised">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-heading">{selected.name}</h2>
                  <span className="font-mono text-eyebrow text-muted-foreground uppercase">
                    {selected.file_count}{" "}
                    {selected.file_count === 1 ? "file" : "files"}
                  </span>
                </div>

                <label
                  htmlFor="kb-upload"
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-7 text-center text-body text-muted-foreground transition-[color,background-color,border-color] duration-200 ease-emphasis hover:border-primary hover:bg-accent/40",
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
                  <span className="text-meta text-muted-foreground/70">
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
                    <p className="py-6 text-center text-body text-muted-foreground">
                      No files yet — upload some to ground your answers.
                    </p>
                  ) : (
                    // A real table rather than a list of flex rows: these are
                    // records with shared columns, and a header row is what
                    // makes "type" and "size" legible without reading each
                    // cell's formatting for a clue.
                    <div className="overflow-hidden rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="ps-3 font-mono text-eyebrow uppercase">
                              File
                            </TableHead>
                            <TableHead className="w-20 font-mono text-eyebrow uppercase">
                              Type
                            </TableHead>
                            <TableHead className="w-24 pe-3 text-right font-mono text-eyebrow uppercase">
                              Size
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {files.map((f) => (
                            <TableRow key={f.id}>
                              <TableCell className="ps-3">
                                <span className="flex min-w-0 items-center gap-2.5">
                                  <FileText
                                    className="size-4 shrink-0 text-muted-foreground"
                                    aria-hidden
                                  />
                                  <a
                                    href={rawFileUrl(f.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="truncate font-medium underline-offset-2 hover:underline"
                                  >
                                    {f.filename}
                                  </a>
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-eyebrow text-muted-foreground">
                                  {fileExt(f.filename)}
                                </span>
                              </TableCell>
                              <TableCell className="pe-3 text-right font-mono text-meta tabular-nums text-muted-foreground">
                                {formatSize(f.size_bytes)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
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
