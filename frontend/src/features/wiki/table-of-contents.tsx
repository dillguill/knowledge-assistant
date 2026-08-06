import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { extractHeadings } from "./toc";
import { useScrollSpy } from "./use-scroll-spy";

/**
 * Presentational "on this page" panel — a sibling column next to the page
 * content, not embedded in it. Reuses the exact ids `rehype-slug` assigns at
 * render time (see `toc.ts`), so a click always scrolls to the right
 * heading, and `useScrollSpy` highlights whichever heading the reader has
 * scrolled to.
 */
export function TableOfContents({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const entries = useMemo(() => extractHeadings(content), [content]);
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const activeId = useScrollSpy(ids);

  if (entries.length === 0) return null;

  const minDepth = Math.min(...entries.map((e) => e.depth));

  return (
    <nav aria-label="Table of contents" className={cn("overflow-y-auto", className)}>
      <p className="mb-2 px-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        On this page
      </p>
      <ul className="flex flex-col gap-0.5 text-sm">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(entry.id)?.scrollIntoView({ behavior: "smooth" });
              }}
              aria-current={activeId === entry.id ? "location" : undefined}
              style={{ paddingInlineStart: `${(entry.depth - minDepth) * 12 + 8}px` }}
              className={cn(
                "block truncate rounded-md py-1 pe-2 no-underline",
                activeId === entry.id
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
