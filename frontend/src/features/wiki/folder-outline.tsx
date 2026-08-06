import { FileText, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WikiFolderNode, WikiFolderTree } from "./tree";
import type { WikiPageSummary } from "./api";

/**
 * Recursive, always-expanded outline of everything under a folder — a
 * sibling "In this folder" column next to the folder-browse content pane,
 * mirroring how `TableOfContents` sits beside a page's own content. Distinct
 * from `WikiTreePanel` (the docked, collapsible whole-wiki nav): this one is
 * scoped to the current folder's full descendant subtree, at a glance,
 * without needing to click into each subfolder.
 */
export function FolderOutline({
  tree,
  folderId,
  onNavigateFolder,
  onNavigatePage,
  className,
}: {
  tree: WikiFolderTree;
  /** The folder currently being browsed, or `null` for the wiki root. */
  folderId: number | null;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
  className?: string;
}) {
  const node = folderId !== null ? (tree.byId.get(folderId) ?? null) : null;
  const subfolders = node ? node.children : tree.roots;
  const pages = node ? node.pages : tree.rootPages;

  if (subfolders.length === 0 && pages.length === 0) return null;

  return (
    <nav aria-label="Folder contents" className={cn("overflow-y-auto", className)}>
      <p className="mb-2 px-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        In this folder
      </p>
      <OutlineList
        subfolders={subfolders}
        pages={pages}
        depth={0}
        onNavigateFolder={onNavigateFolder}
        onNavigatePage={onNavigatePage}
      />
    </nav>
  );
}

function OutlineList({
  subfolders,
  pages,
  depth,
  onNavigateFolder,
  onNavigatePage,
}: {
  subfolders: WikiFolderNode[];
  pages: WikiPageSummary[];
  depth: number;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {subfolders.map((f) => (
        <li key={`folder-${f.id}`}>
          <button
            onClick={() => onNavigateFolder(f.id)}
            style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
            className="flex w-full items-center gap-1.5 truncate rounded-md py-1 pe-2 text-left text-muted-foreground hover:text-foreground"
          >
            <Folder className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{f.name}</span>
          </button>
          {(f.children.length > 0 || f.pages.length > 0) && (
            <OutlineList
              subfolders={f.children}
              pages={f.pages}
              depth={depth + 1}
              onNavigateFolder={onNavigateFolder}
              onNavigatePage={onNavigatePage}
            />
          )}
        </li>
      ))}
      {pages.map((p) => (
        <li key={`page-${p.id}`}>
          <button
            onClick={() => onNavigatePage(p.slug)}
            style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
            className="flex w-full items-center gap-1.5 truncate rounded-md py-1 pe-2 text-left text-muted-foreground hover:text-foreground"
          >
            <FileText className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{p.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
