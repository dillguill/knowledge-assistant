import { expect, test } from "vitest";
import {
  extractWikiCreatePage,
  extractWikiUpdate,
  stripActionFences,
} from "./wiki-update";

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

test("stripActionFences no longer strips wiki-create-page (it's drafted into a card)", () => {
  const text = [
    "Here's a draft.",
    "```wiki-create-page",
    '{"title": "Homelab", "content": "# Homelab"}',
    "```",
  ].join("\n");
  // The create fence survives so `extractWikiCreatePage` can render the card.
  expect(stripActionFences(text)).toContain("```wiki-create-page");
});

test("extractWikiCreatePage parses a complete fence into title/content/folderId", () => {
  const text = [
    "Sure, here's a draft:",
    "```wiki-create-page",
    '{"title": "Homelab", "content": "# Homelab\\n\\nRun services at home.", "folder_id": 4}',
    "```",
    "Save it when ready.",
  ].join("\n");
  const result = extractWikiCreatePage(text);
  expect(result.before).toBe("Sure, here's a draft:\n");
  expect(result.block).toEqual({
    status: "complete",
    data: {
      title: "Homelab",
      content: "# Homelab\n\nRun services at home.",
      folderId: 4,
    },
  });
  expect(result.after).toBe("Save it when ready.");
});

test("extractWikiCreatePage defaults a missing folder_id to null", () => {
  const text = '```wiki-create-page\n{"title": "T", "content": "c"}\n```';
  const result = extractWikiCreatePage(text);
  expect(result.block).toEqual({
    status: "complete",
    data: { title: "T", content: "c", folderId: null },
  });
});

test("extractWikiCreatePage reports pending while the fence is still streaming", () => {
  const text = 'Working on it.\n```wiki-create-page\n{"title": "Home';
  const result = extractWikiCreatePage(text);
  expect(result.before).toBe("Working on it.\n");
  expect(result.block).toEqual({ status: "pending" });
});

test("extractWikiCreatePage yields data:null for a closed fence with invalid JSON", () => {
  const text = "```wiki-create-page\nnot json at all\n```";
  const result = extractWikiCreatePage(text);
  expect(result.block).toEqual({ status: "complete", data: null });
});

test("extractWikiCreatePage returns no block for plain prose", () => {
  const result = extractWikiCreatePage("Just a normal reply.");
  expect(result.block).toBeNull();
  expect(result.before).toBe("Just a normal reply.");
});
