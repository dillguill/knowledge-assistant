import { requestWikiPage } from "@/app/wiki-navigation";

/** Renders a `source` message part as a small link chip. Props are loose so
 * it can take the enriched part directly from the GroupedParts render
 * switch (extra fields are ignored).
 *
 * Documents (`kind: "document"`, or no `kind` at all — pre-wiki sources)
 * open the raw file in a new tab, as before. Wiki sources (`kind: "wiki"`)
 * have no raw-file URL; they route in-app to the page instead of leaving
 * the chat (there's no client-side router here, so "in-app" means routing
 * the click through the small `wiki-navigation` bridge rather than a real
 * `<a>` navigation). */
export function CitationChip({
  url,
  title,
  kind,
  slug,
}: {
  url?: string;
  title?: string;
  kind?: "document" | "wiki";
  slug?: string;
}) {
  if (kind === "wiki" && slug) {
    return (
      <a
        href={`/wiki/page/${slug}`}
        onClick={(e) => {
          e.preventDefault();
          requestWikiPage(slug);
        }}
        className="mr-1 mb-1 inline-flex items-center rounded border border-border bg-accent px-1.5 py-0.5 font-mono text-[10px] text-foreground no-underline hover:border-primary"
      >
        {title ?? slug}
      </a>
    );
  }

  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mr-1 mb-1 inline-flex items-center rounded border border-border bg-accent px-1.5 py-0.5 font-mono text-[10px] text-foreground no-underline hover:border-primary"
    >
      {title ?? url}
    </a>
  );
}
