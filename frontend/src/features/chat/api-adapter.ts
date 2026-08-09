import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import { parseSse } from "@/lib/sse";
import { loadSettings } from "../settings/settings-storage";
import { consumeCreatePageMode } from "./create-page-mode";
import { requestEditTarget } from "./target-selection";
import { webSearchRef } from "./web-search-mode";

// Self-contained page-drafting instruction injected when the "New page" pill is
// active. It carries the full `wiki-create-page` fence format itself rather than
// relying on the backend's owner-only SYSTEM_PROMPT, so a visitor (no owner
// token, so no SYSTEM_PROMPT) can still draft a page to propose. The draft is
// rendered as a reviewable card, never written server-side by the chat turn —
// hence the explicit "do not claim you saved it".
const CREATE_PAGE_DIRECTIVE = [
  "The user wants to create a NEW wiki page. Draft the page and output exactly",
  "one fenced block in this format (the fenced lines must contain valid JSON):",
  "```wiki-create-page",
  '{"title": "<concise page title>", "content": "<full page in markdown>", "folder_id": null}',
  "```",
  "The draft is shown to the user as a card they review and save themselves — do",
  "NOT claim the page has been created or saved. Base the page on this request:",
].join("\n");

type Source = {
  id: number;
  label: string;
  filename: string;
  kind?: "document" | "wiki" | "web";
  slug?: string;
  url?: string;
};

export type WebSearchInfo = {
  query: string;
  results: { url: string; title: string }[];
};

export type ChatTarget = { page_id: number; title: string; slug: string };

type SseEvent =
  | { type: "text-delta"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "search"; query: string; results: { url: string; title: string }[] }
  | { type: "target"; target: ChatTarget }
  | { type: "error"; code: string; message: string; retry_after?: number }
  | { type: "action"; action: string; result?: Record<string, unknown>; error?: string };

export class ChatError extends Error {
  code: string;
  retryAfter?: number;
  constructor(code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function errorCopy(
  event: Extract<SseEvent, { type: "error" }>,
  model: string | null,
): string {
  switch (event.code) {
    case "rate_limited":
      return event.retry_after
        ? `Rate limited — try again in ~${event.retry_after}s.`
        : "Rate limited — wait a moment, then regenerate.";
    case "model_gone":
      return `${model ?? "The selected model"} is no longer available — pick another model and regenerate.`;
    case "search_unavailable":
      return "Web search is not available — answering without web results.";
    case "search_rate_limited":
      return "Web search is rate limited — wait a moment, then retry.";
    case "search_quota_exhausted":
      return "The web search quota is exhausted — answering without web results.";
    case "search_failed":
      return "The web search failed — answering without web results.";
    default:
      return "The model provider had a problem. Regenerate to retry.";
  }
}

function toApiMessages(messages: readonly ThreadMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n"),
  }));
}

export type SourceConfig = {
  collectionIds: number[];
  attachmentIds: number[];
  wikiPageIds: number[];
};

const NO_SOURCES: () => SourceConfig = () => ({
  collectionIds: [],
  attachmentIds: [],
  wikiPageIds: [],
});

/** Streams chat completions from the Knowledge Assistant backend. */
export function createApiAdapter(
  baseUrl: string,
  getModel: () => string | null,
  getSourceConfig: () => SourceConfig = NO_SOURCES,
  getTargetPageId: () => number | null = () => null,
  onTarget?: (target: ChatTarget) => void,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, context }) {
      const apiMessages = toApiMessages(messages);
      if (context?.system) {
        apiMessages.unshift({ role: "system", content: context.system });
      }
      // If the "New page" pill is armed, turn this turn's newest user message
      // into a page-drafting instruction (consumes the mode so it's one-shot).
      if (consumeCreatePageMode()) {
        for (let i = apiMessages.length - 1; i >= 0; i--) {
          if (apiMessages[i]!.role === "user") {
            apiMessages[i] = {
              ...apiMessages[i]!,
              content: `${CREATE_PAGE_DIRECTIVE}\n\n${apiMessages[i]!.content}`,
            };
            break;
          }
        }
      }
      const source = getSourceConfig();
      const targetPageId = getTargetPageId();
      const attachmentIds = [
        ...messages
          .flatMap((m) => m.attachments ?? [])
          .map((a) => Number(a.id))
          .filter(Number.isFinite),
        ...source.attachmentIds,
      ];
      // A page picked as the Target must never also ride along as a plain
      // wiki source — the backend already pins its full content via
      // target_page_id, so including it in wiki_page_ids too would just
      // duplicate it in the source-context block.
      const wikiPageIds = source.wikiPageIds.filter((id) => id !== targetPageId);
      const body: Record<string, unknown> = {
        model: getModel(),
        messages: apiMessages,
      };
      if (source.collectionIds.length) body.collection_ids = source.collectionIds;
      if (attachmentIds.length) body.attachment_ids = attachmentIds;
      if (wikiPageIds.length) body.wiki_page_ids = wikiPageIds;
      if (targetPageId !== null) body.target_page_id = targetPageId;
      if (webSearchRef.current !== "off") body.web_search = webSearchRef.current;
      const ownerToken = loadSettings().ownerToken;
      if (ownerToken) {
        body.tools_enabled = true;
        body.owner_token = ownerToken;
      }
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`The backend returned ${response.status} — try again shortly.`);
      }
      let text = "";
      let sources: Source[] = [];
      let webSearch: WebSearchInfo | null = null;
      let searchNotice: string | null = null;
      const sourceParts = () =>
        sources.map((s) => ({
          type: "source" as const,
          sourceType: "url" as const,
          id: String(s.id),
          url:
            s.kind === "web" && s.url
              ? s.url
              : s.kind === "wiki" && s.slug
              ? `/wiki/page/${s.slug}`
              : `${baseUrl}/api/knowledge/files/${s.id}/raw`,
          title: `[${s.label}] ${s.filename}`,
          kind: s.kind ?? "document",
          slug: s.slug,
        }));
      for await (const event of parseSse<SseEvent>(response.body)) {
        if (event.type === "error") {
          // A search error is non-terminal: the backend keeps streaming an
          // answer without web results, so throwing here would abort a turn
          // that still succeeds.
          if (event.code.startsWith("search_")) {
            searchNotice = errorCopy(event, getModel());
            continue;
          }
          throw new ChatError(
            event.code,
            errorCopy(event, getModel()),
            event.retry_after,
          );
        }
        if (event.type === "search") {
          webSearch = { query: event.query, results: event.results };
        }
        if (event.type === "target") {
          onTarget?.(event.target);
        }
        if (event.type === "sources") sources = event.sources;
        if (
          event.type === "action" &&
          event.action === "wiki-create-page" &&
          typeof event.result?.id === "number"
        ) {
          // Pin the new page as the edit target: opens the chat side panel
          // (md+) showing it, rather than navigating away to the wiki view.
          requestEditTarget(event.result.id);
        }
        if (event.type === "text-delta") {
          text += event.text;
          yield {
            content: [{ type: "text" as const, text }, ...sourceParts()],
            // Carried on the message so a `wiki-update` proposal card
            // (Task 16) can reuse this exact list as its citations, per the
            // "citations = the message's sources event payload" rule.
            metadata: {
              custom: { citationSources: sources, webSearch, searchNotice },
            },
          };
        }
      }
    },
  };
}
