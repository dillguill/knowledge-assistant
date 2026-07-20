/**
 * Extracts a ```` ```wiki-update ```` fence from an assistant message's raw
 * text, mirroring `backend/app/services/drafter.py`'s `_FENCE_PATTERN`
 * exactly so the frontend never disagrees with the backend about what
 * counts as a valid block:
 *
 * - Line-anchored: the opening line must be exactly ```` ```wiki-update ````
 *   (only trailing spaces/tabs allowed) and the closing line exactly
 *   ```` ``` ```` (same). A `wiki-update` fence embedded mid-line (e.g.
 *   inside prose) does not count.
 * - Greedy to the LAST closing fence, not the first — a drafted page can
 *   itself contain fenced code blocks (e.g. a ```python sample```), and
 *   same-length fences can't nest, so there's no reliable way to tell a
 *   "real" close from a nested one by counting backticks. Assuming the
 *   model's own closing fence is the last bare ``` line lets nested blocks
 *   survive intact instead of truncating at the first nested closer.
 * - Streaming-safe: a block is only ever "complete" once a closing fence
 *   has actually arrived. While only the opening fence is present, it's
 *   "pending" — the caller should show a placeholder, not raw fence text.
 */

export type WikiUpdateBlock =
  | { status: "pending" }
  | { status: "complete"; content: string };

export type WikiUpdateExtraction = {
  /** Text before the fence (rendered normally). */
  before: string;
  /** `null` when no `wiki-update` fence has started yet. */
  block: WikiUpdateBlock | null;
  /** Text after a complete fence's closing line (rendered normally). Always
   * `""` when `block` is `null` or `"pending"`. */
  after: string;
};

const FULL_FENCE_RE = /^```wiki-update[ \t]*\n([\s\S]*)\n^```[ \t]*$/m;
const OPEN_FENCE_RE = /^```wiki-update[ \t]*$/m;

export function extractWikiUpdate(text: string): WikiUpdateExtraction {
  const full = FULL_FENCE_RE.exec(text);
  if (full) {
    const before = text.slice(0, full.index);
    const after = text.slice(full.index + full[0].length).replace(/^\n/, "");
    return {
      before,
      block: { status: "complete", content: full[1] ?? "" },
      after,
    };
  }

  const open = OPEN_FENCE_RE.exec(text);
  if (open) {
    return { before: text.slice(0, open.index), block: { status: "pending" }, after: "" };
  }

  return { before: text, block: null, after: "" };
}
