import { useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { folderBreadcrumb, type WikiFolderNode, type WikiFolderTree } from "./tree";
import type { WikiPageSummary } from "./api";

const EXPANDED_KEY = "knowledge-assistant:wiki-tree-expanded";

function loadExpanded(): Set<number> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) return new Set(JSON.parse(raw) as number[]);
  } catch {
    // fall through to a fresh, all-collapsed tree
  }
  return new Set();
}

/** The folder (if any) that directly owns a root-level or nested page. */
function folderOwning(slug: string, tree: WikiFolderTree): WikiFolderNode | null {
  for (const node of tree.byId.values()) {
    if (node.pages.some((p) => p.slug === slug)) return node;
  }
  return null;
}

function PageRow({
  page,
  depth,
  active,
  onNavigatePage,
}: {
  page: WikiPageSummary;
  depth: number;
  active: boolean;
  onNavigatePage: (slug: string) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onNavigatePage(page.slug)}
        aria-current={active ? "page" : undefined}
        style={{ paddingInlineStart: `${depth * 14 + 26}px` }}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pe-1 text-left text-sm",
          active
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <FileText className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{page.title}</span>
      </button>
    </li>
  );
}

function FolderRow({
  node,
  depth,
  expanded,
  activeFolderId,
  activeSlug,
  onToggle,
  onNavigateFolder,
  onNavigatePage,
}: {
  node: WikiFolderNode;
  depth: number;
  expanded: Set<number>;
  activeFolderId: number | null;
  activeSlug: string | null;
  onToggle: (id: number) => void;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
}) {
  const isOpen = expanded.has(node.id);
  const isActive = activeFolderId === node.id;

  return (
    <li>
      <Collapsible open={isOpen} onOpenChange={() => onToggle(node.id)}>
        <div className="flex items-center gap-0.5 pe-1">
          <CollapsibleTrigger asChild>
            <button
              aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
              style={{ marginInlineStart: `${depth * 14}px` }}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", isOpen && "rotate-90")}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <button
            onClick={() => onNavigateFolder(node.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm",
              isActive
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <Folder className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        </div>
        <CollapsibleContent>
          <ul>
            {node.children.map((child) => (
              <FolderRow
                key={child.id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                activeFolderId={activeFolderId}
                activeSlug={activeSlug}
                onToggle={onToggle}
                onNavigateFolder={onNavigateFolder}
                onNavigatePage={onNavigatePage}
              />
            ))}
            {node.pages.map((p) => (
              <PageRow
                key={p.id}
                page={p}
                depth={depth + 1}
                active={activeSlug === p.slug}
                onNavigatePage={onNavigatePage}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * Docked hierarchy nav for the wiki — a lightweight tree panel (not a second
 * app-shell Sidebar instance) so global product nav and docs-tree nav stay
 * visually and behaviorally separate, matching how Docusaurus/GitBook/Mintlify
 * split the two. Expand/collapse state persists to localStorage; the active
 * page or folder's ancestor chain auto-expands so the current location is
 * always visible without manual drill-down.
 */
export function WikiTreePanel({
  tree,
  activeFolderId,
  activeSlug,
  onNavigateFolder,
  onNavigatePage,
}: {
  tree: WikiFolderTree;
  /** The folder currently being browsed, or `null` at the wiki root. */
  activeFolderId: number | null;
  /** The page currently being viewed, if any. */
  activeSlug: string | null;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(loadExpanded);

  useEffect(() => {
    const owner = activeFolderId !== null
      ? tree.byId.get(activeFolderId)
      : activeSlug !== null
        ? folderOwning(activeSlug, tree)
        : null;
    if (!owner) return;
    const chain = folderBreadcrumb(owner.id, tree.byId);
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const node of chain) {
        if (!next.has(node.id)) {
          next.add(node.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeFolderId, activeSlug, tree]);

  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
  }, [expanded]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isRoot = activeFolderId === null && activeSlug === null;

  return (
    <nav
      aria-label="Wiki contents"
      className="no-print flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border px-2 py-3"
    >
      <button
        onClick={() => onNavigateFolder(null)}
        aria-current={isRoot ? "page" : undefined}
        className={cn(
          "rounded-md px-2 py-1.5 text-left text-sm font-semibold",
          isRoot
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Wiki
      </button>
      <ul className="flex flex-col gap-0.5">
        {tree.roots.map((node) => (
          <FolderRow
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            activeFolderId={activeFolderId}
            activeSlug={activeSlug}
            onToggle={toggle}
            onNavigateFolder={onNavigateFolder}
            onNavigatePage={onNavigatePage}
          />
        ))}
        {tree.rootPages.map((p) => (
          <PageRow
            key={p.id}
            page={p}
            depth={0}
            active={activeSlug === p.slug}
            onNavigatePage={onNavigatePage}
          />
        ))}
      </ul>
    </nav>
  );
}
