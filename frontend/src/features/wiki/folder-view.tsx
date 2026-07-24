import { FileText, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/time";
import { folderBreadcrumb, type WikiFolderNode, type WikiFolderTree } from "./tree";
import { WikiItemMenu } from "./wiki-actions";
import type { PageOrFolderTarget } from "./wiki-dialogs";

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isFolderEmpty(f: WikiFolderNode): boolean {
  return f.children.length === 0 && f.pages.length === 0;
}

export function FolderView({
  tree,
  folderId,
  isOwner,
  onNavigateFolder,
  onNavigatePage,
  onItemAction,
}: {
  tree: WikiFolderTree;
  /** `null` = the wiki root. */
  folderId: number | null;
  isOwner: boolean;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
  /** Owner-only per-row actions; the caller owns the CRUD dialogs. */
  onItemAction?: (target: PageOrFolderTarget, action: "rename" | "move" | "delete") => void;
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
  const showMenus = isOwner && Boolean(onItemAction);

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
            <div
              key={f.id}
              className="group relative rounded-lg border border-border bg-card hover:border-primary"
            >
              <button
                onClick={() => onNavigateFolder(f.id)}
                className="flex w-full items-start gap-2.5 p-4 text-left"
              >
                <FolderOpen
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate pe-6 text-sm font-semibold">
                    {f.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {countLabel(f.children.length, "folder", "folders")} ·{" "}
                    {countLabel(f.pages.length, "page", "pages")}
                  </span>
                </span>
              </button>
              {showMenus && (
                <div className="absolute end-2 top-2">
                  <WikiItemMenu
                    target={{ kind: "folder", folder: f }}
                    canDelete={isFolderEmpty(f)}
                    onAction={onItemAction!}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pages.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {pages.map((p) => (
            <li key={p.id} className="flex items-center gap-1">
              <button
                onClick={() => onNavigatePage(p.slug)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent",
                )}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{p.title}</span>
                <span
                  className="ml-auto shrink-0 text-xs text-muted-foreground"
                  title={p.updated_at}
                >
                  updated {relativeTime(p.updated_at)} · {p.last_author ?? "unknown"}
                </span>
              </button>
              {showMenus && (
                <div className="pe-2">
                  <WikiItemMenu
                    target={{ kind: "page", page: p }}
                    onAction={onItemAction!}
                  />
                </div>
              )}
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
