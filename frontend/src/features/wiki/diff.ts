import { structuredPatch } from "diff";

export type DiffLineKind = "add" | "remove" | "context";

export type DiffLine = {
  kind: DiffLineKind;
  content: string;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

/**
 * Turns two full-text strings into unified-diff hunks (`diff`'s
 * `structuredPatch` under the hood), with each line flagged added / removed
 * / unchanged context.
 */
export function diffToHunks(oldContent: string, newContent: string): DiffHunk[] {
  const { hunks } = structuredPatch("previous", "current", oldContent, newContent, "", "", {
    context: 3,
  });
  return hunks.map((hunk): DiffHunk => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines.map((line): DiffLine => {
      const kind: DiffLineKind =
        line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "context";
      return { kind, content: line.slice(1) };
    }),
  }));
}

const LINE_PREFIX: Record<DiffLineKind, string> = { add: "+", remove: "-", context: " " };

/** Renders hunks back into a minimal unified-diff patch string, the format
 * `<DiffViewer patch>` (`parse-diff` under the hood) expects. */
export function hunksToPatch(
  hunks: DiffHunk[],
  oldName = "previous",
  newName = "current",
): string {
  const body = hunks
    .map((hunk) => {
      const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
      const lines = hunk.lines.map((l) => `${LINE_PREFIX[l.kind]}${l.content}`);
      return [header, ...lines].join("\n");
    })
    .join("\n");
  return `--- ${oldName}\n+++ ${newName}\n${body}\n`;
}
