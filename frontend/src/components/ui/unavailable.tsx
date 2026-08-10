import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Marks a panel as built-but-not-live: the real layout is rendered underneath
 * so the app reads as complete, with a diagonal hatch over it saying this one
 * is not available yet.
 *
 * The point is a shell future features plug into. A surface that simply omits
 * what is coming has to be redesigned when it lands; a surface that shows the
 * slot only has to have the slot filled.
 *
 * Honesty rules this component enforces:
 * - Nothing inside is reachable — `inert` removes it from the tab order and
 *   the a11y tree entirely, so a screen reader never offers a dead control.
 * - The status is text, not just texture: a visible badge, plus the `title`
 *   in an accessible label, so "unavailable" survives without the visuals.
 * - Content underneath must still be **plausible**, never fabricated data
 *   presented as real. Use shapes and placeholders, not invented numbers.
 */
export function Unavailable({
  title,
  note,
  milestone,
  className,
  children,
}: {
  /** What this panel will be, e.g. "Cost per run". */
  title: string;
  /** One line on what it will show once it is live. */
  note?: string;
  /** Where it lands, e.g. "v0.8.0". Omit if genuinely unscheduled. */
  milestone?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={`${title} — not available yet${milestone ? `, planned for ${milestone}` : ""}`}
      className={cn(
        "relative overflow-hidden rounded-lg border border-dashed border-border",
        className,
      )}
    >
      {/* `inert` removes the subtree from the tab order and the a11y tree in
          real browsers; `aria-hidden` states the same thing declaratively so
          the guarantee does not rest on `inert` support alone. The two agree
          rather than conflict — nothing here is focusable either way, and the
          group's own label carries the meaning. */}
      <div
        inert
        aria-hidden
        className="pointer-events-none select-none opacity-35"
      >
        {children}
      </div>

      {/* The hatch. Decorative only; the badge below carries the meaning. */}
      <span
        aria-hidden
        className="absolute inset-0 [background-image:repeating-linear-gradient(135deg,var(--color-border)_0,var(--color-border)_1px,transparent_1px,transparent_9px)] opacity-70"
      />

      <span className="absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-dashed border-border bg-card/85 px-3 py-2 backdrop-blur-[2px]">
        <span className="text-body font-medium">{title}</span>
        {milestone && (
          <span className="rounded border border-border px-1.5 font-mono text-eyebrow tracking-wide text-muted-foreground uppercase">
            {milestone}
          </span>
        )}
        {note && (
          <span className="w-full text-meta text-muted-foreground">{note}</span>
        )}
      </span>
    </div>
  );
}

/**
 * Neutral shapes for use inside `Unavailable`. Deliberately not numbers:
 * a placeholder must not put figures in front of someone that the product
 * never measured.
 */
export function PlaceholderBars({ rows = 5 }: { rows?: number }) {
  // Fixed, not random, so the panel does not reshuffle on every render.
  const heights = [62, 88, 44, 96, 71, 55, 80, 38];
  return (
    <div className="flex h-28 items-end gap-1.5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="flex-1 rounded-t bg-muted-foreground/35"
          style={{ height: `${heights[i % heights.length]}%` }}
        />
      ))}
    </div>
  );
}

export function PlaceholderLines({ rows = 3 }: { rows?: number }) {
  const widths = ["92%", "74%", "83%", "61%", "88%"];
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="h-2.5 rounded bg-muted-foreground/25"
          style={{ width: widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}
