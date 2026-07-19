import { useMemo, useState } from "react";
import { loadSettings } from "@/features/settings/settings-storage";
import { buildWikiLinkResolver, buildWikiTree } from "./tree";
import { useWikiPage, useWikiTree } from "./use-wiki";
import { FolderView } from "./folder-view";
import { WikiMarkdown } from "./wiki-markdown";

type WikiRoute =
  | { kind: "folder"; id: number | null }
  | { kind: "page"; slug: string };

function PageView({
  slug,
  resolve,
  onNavigateFolder,
  onNavigatePage,
}: {
  slug: string;
  resolve: ReturnType<typeof buildWikiLinkResolver>;
  onNavigateFolder: (id: number | null) => void;
  onNavigatePage: (slug: string) => void;
}) {
  const { page } = useWikiPage(slug);

  if (!page) {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
        <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <button
          onClick={() => onNavigateFolder(page.folder_id)}
          className="self-start text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Back
        </button>
        <div>
          <h1 className="text-xl font-semibold">{page.title}</h1>
          <p className="font-mono text-xs text-muted-foreground">
            updated {page.updated_at} · {page.last_author ?? "unknown"}
          </p>
        </div>
        <WikiMarkdown content={page.content} resolve={resolve} onNavigate={onNavigatePage} />
      </div>
    </div>
  );
}

/**
 * Route shell for the wiki section: folder navigation (root + nested
 * folders) and a page view. This batch is read-only navigation — editing,
 * history, and proposals land in later tasks.
 */
export function WikiPage() {
  const { tree: rawTree } = useWikiTree();
  const [route, setRoute] = useState<WikiRoute>({ kind: "folder", id: null });
  const isOwner = Boolean(loadSettings().ownerToken);

  const tree = useMemo(
    () => buildWikiTree(rawTree.folders, rawTree.pages),
    [rawTree],
  );
  const resolve = useMemo(() => buildWikiLinkResolver(rawTree.pages), [rawTree]);

  const onNavigateFolder = (id: number | null) => setRoute({ kind: "folder", id });
  const onNavigatePage = (slug: string) => setRoute({ kind: "page", slug });

  if (route.kind === "page") {
    return (
      <PageView
        slug={route.slug}
        resolve={resolve}
        onNavigateFolder={onNavigateFolder}
        onNavigatePage={onNavigatePage}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <FolderView
        tree={tree}
        folderId={route.id}
        isOwner={isOwner}
        onNavigateFolder={onNavigateFolder}
        onNavigatePage={onNavigatePage}
      />
    </div>
  );
}
