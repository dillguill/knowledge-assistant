/** Renders a `source` message part as a small link chip that resolves back to
 * the original file. Props are loose so it can take the enriched part directly
 * from the GroupedParts render switch (extra fields are ignored). */
export function CitationChip({
  url,
  title,
}: {
  url?: string;
  title?: string;
}) {
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
