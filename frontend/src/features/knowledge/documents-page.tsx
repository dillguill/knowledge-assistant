import { useEffect, useRef, useState } from "react";
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

export function DocumentsPage() {
  const { collections, refresh } = useCollections();
  const [selected, setSelected] = useState<Collection | null>(null);
  const { files, refresh: refreshFiles } = useFiles(selected?.id ?? null);
  const [sync, setSync] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    syncStatus().then(setSync).catch(() => setSync(""));
  }, [files]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await createCollection(name);
      setNewName("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create collection.");
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList?.length || !selected) return;
    setError(null);
    try {
      for (const f of Array.from(fileList)) await uploadFile(selected.id, f);
      refreshFiles();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Uploaded source collections. Originals are never discarded — every
          answer resolves back to a file here.
          {sync && <span className="ml-2 font-mono text-xs">sync: {sync}</span>}
        </p>

        <div className="flex gap-2">
          <label htmlFor="new-collection" className="sr-only">
            New collection name
          </label>
          <input
            id="new-collection"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            placeholder="New collection name"
            className="w-full max-w-sm rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <button
            onClick={() => void handleCreate()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            New collection
          </button>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {collections.length === 0 ? (
            <p key="empty" className="col-span-full text-sm text-muted-foreground">No collections yet.</p>
          ) : collections.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={cn(
                "rounded-lg border border-border bg-card p-4 text-left hover:border-primary",
                selected?.id === c.id && "border-primary",
              )}
            >
              <div className="text-sm font-semibold">{c.name}</div>
              <div className="text-xs text-muted-foreground">
                {c.file_count} files
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <section className="rounded-lg border border-border bg-card p-4">
            <label
              htmlFor="kb-upload"
              className="block cursor-pointer rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground hover:border-primary"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleUpload(e.dataTransfer.files);
              }}
            >
              Drop files here or click to browse — PDF, HTML, text, markdown
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
            <ul className="mt-3 divide-y divide-border">
              {files.length === 0 ? (
                <li className="py-2 text-sm text-muted-foreground">No files yet.</li>
              ) : files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="rounded bg-accent px-1.5 font-mono text-[10px] uppercase">
                    {f.filename.split(".").pop()}
                  </span>
                  <a
                    href={rawFileUrl(f.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate hover:underline"
                  >
                    {f.filename}
                  </a>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {formatSize(f.size_bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
