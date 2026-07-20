import { expect, test } from "vitest";
import { extractWikiUpdate, stripActionFences } from "./wiki-update";

test("plain text with no fence at all", () => {
  const result = extractWikiUpdate("Just a normal reply, no fence here.");
  expect(result).toEqual({
    before: "Just a normal reply, no fence here.",
    block: null,
    after: "",
  });
});

test("an opening fence with no closing fence yet is pending (still streaming)", () => {
  const text = "Sure, here's the update:\n```wiki-update\n# Draft title\nmore partial conten";
  const result = extractWikiUpdate(text);
  expect(result.before).toBe("Sure, here's the update:\n");
  expect(result.block).toEqual({ status: "pending" });
  expect(result.after).toBe("");
});

test("a complete fence extracts the content and preserves surrounding text", () => {
  const text = "Explanation first.\n```wiki-update\n# New content\nBody text.\n```\nAll done!";
  const result = extractWikiUpdate(text);
  expect(result.before).toBe("Explanation first.\n");
  expect(result.block).toEqual({
    status: "complete",
    content: "# New content\nBody text.",
  });
  expect(result.after).toBe("All done!");
});

test("a nested fenced code block inside the page content survives (greedy to the LAST closing fence)", () => {
  const text = [
    "```wiki-update",
    "# Title",
    "",
    "```python",
    'print("hi")',
    "```",
    "```",
  ].join("\n");
  const result = extractWikiUpdate(text);
  expect(result.block).toEqual({
    status: "complete",
    content: ['# Title', "", "```python", 'print("hi")', "```"].join("\n"),
  });
  expect(result.after).toBe("");
});

test("the closing fence line must be exactly ``` (trailing prose on the same line doesn't count as a close)", () => {
  const text = "```wiki-update\n# Draft\n``` not really closed here\n```";
  const result = extractWikiUpdate(text);
  // The only line that is exactly ``` is the last one.
  expect(result.block).toEqual({
    status: "complete",
    content: "# Draft\n``` not really closed here",
  });
});

test("a wiki-update mention mid-line (not its own fence line) is not treated as an opening fence", () => {
  const result = extractWikiUpdate("I could use a ```wiki-update fence if you want.");
  expect(result.block).toBeNull();
  expect(result.before).toBe("I could use a ```wiki-update fence if you want.");
});

test("stripActionFences removes a complete wiki-create-page fence, keeps prose", () => {
  const text = [
    "I created that page for you.",
    "```wiki-create-page",
    '{"title": "Homelab", "content": "# Homelab"}',
    "```",
  ].join("\n");
  expect(stripActionFences(text)).toBe("I created that page for you.");
});

test("stripActionFences removes a still-streaming (unclosed) create fence", () => {
  const text = ["Working on it.", "```wiki-create-page", '{"title": "Home'].join(
    "\n",
  );
  expect(stripActionFences(text)).toBe("Working on it.");
});

test("stripActionFences removes a collection-create fence", () => {
  const text = ["Done.", "```collection-create", '{"name": "Manuals"}', "```"].join(
    "\n",
  );
  expect(stripActionFences(text)).toBe("Done.");
});

test("stripActionFences leaves ordinary text (and wiki-update) untouched", () => {
  const text = ["No action fences here.", "```wiki-update", "# x", "```"].join("\n");
  expect(stripActionFences(text)).toBe(text.trim());
});
