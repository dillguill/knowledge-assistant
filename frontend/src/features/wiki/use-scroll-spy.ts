import { useEffect, useState } from "react";

/**
 * Tracks which of a set of heading ids is currently "active" while the
 * reader scrolls, for highlighting the matching entry in a table of
 * contents. A heading counts as active once it crosses a thin detection
 * band near the top of the viewport (`rootMargin`'s -80% bottom inset) —
 * the standard scroll-spy IntersectionObserver trick, rather than picking
 * whichever heading happens to be anywhere on screen.
 *
 * `ids` is joined into the effect's dependency so callers don't need to
 * memoize the array itself — only its contents matter.
 */
export function useScrollSpy(ids: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) {
      setActiveId(null);
      return;
    }

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const active = ids.find((id) => visible.has(id));
        if (active) setActiveId(active);
      },
      { rootMargin: "0px 0px -80% 0px", threshold: 0 },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return activeId;
}
