import { cn } from "@/lib/utils";
import { folderBreadcrumb, type WikiFolderTree } from "./tree";

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function FolderView({
  tree,
  folderId,
  isOwner,
  onNavigateFolder,
  onNavigatePage,
}: {
  tree: WikiFolderTree;
  /** `null` = the wiki root. */
  folderId: number | null;
  isOwner: boolean;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
}) {
  const node = folderId !== null ? tree.byId.get(folderId) : null;

  if (folderId !== null && !node) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-destructive">Unknown folder.</p>
      </div>
    );
  }

  const subfolders = node ? node.children : tree.roots;
  const pages = node ? node.pages : tree.rootPages;
  const breadcrumb = folderId !== null ? folderBreadcrumb(folderId, tree.byId) : [];
  const isEmpty = subfolders.length === 0 && pages.length === 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {folderId !== null && (
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          <button onClick={() => onNavigateFolder(null)} className="hover:text-foreground hover:underline">
            Wiki
          </button>
          {breadcrumb.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <button
                onClick={() => onNavigateFolder(f.id)}
                className="hover:text-foreground hover:underline"
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {subfolders.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {subfolders.map((f) => (
            <button
              key={f.id}
              onClick={() => onNavigateFolder(f.id)}
              className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary"
            >
              <div className="text-sm font-semibold">{f.name}</div>
              <div className="text-xs text-muted-foreground">
                {countLabel(f.children.length, "folder", "folders")} ·{" "}
                {countLabel(f.pages.length, "page", "pages")}
              </div>
            </button>
          ))}
        </div>
      )}

      {pages.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {pages.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onNavigatePage(p.slug)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent",
                )}
              >
                <span className="truncate font-medium">{p.title}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  updated {p.updated_at} · {p.last_author ?? "unknown"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? "Nothing here yet. Pages and folders you add will show up here."
            : "Nothing here yet."}
        </p>
      )}
    </div>
  );
}
