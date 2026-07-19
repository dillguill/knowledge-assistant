import { expect, test } from "vitest";
import { diffToHunks, hunksToPatch } from "./diff";

test("diffToHunks flags added and removed lines and keeps context lines", () => {
  const oldContent = "line1\nline2\nline3\n";
  const newContent = "line1\nlineX\nline3\nline4\n";

  const hunks = diffToHunks(oldContent, newContent);

  expect(hunks).toHaveLength(1);
  const flagged = hunks[0]!.lines.map((l) => `${l.kind}:${l.content}`);
  expect(flagged).toEqual([
    "context:line1",
    "remove:line2",
    "add:lineX",
    "context:line3",
    "add:line4",
  ]);
});

test("diffToHunks returns no hunks for identical content", () => {
  expect(diffToHunks("same\n", "same\n")).toEqual([]);
});

test("diffToHunks reports old/new start and line counts per hunk", () => {
  const hunks = diffToHunks("a\nb\nc\n", "a\nx\nc\n");
  expect(hunks).toHaveLength(1);
  expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 });
});

test("hunksToPatch renders a unified diff a patch parser can read back", () => {
  const hunks = diffToHunks("a\nb\n", "a\nc\n");

  const patch = hunksToPatch(hunks, "previous", "current");

  expect(patch).toContain("--- previous");
  expect(patch).toContain("+++ current");
  expect(patch).toMatch(/^-b$/m);
  expect(patch).toMatch(/^\+c$/m);
});
