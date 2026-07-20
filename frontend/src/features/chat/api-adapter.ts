import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import { loadSettings } from "../settings/settings-storage";

type Source = {
  id: number;
  label: string;
  filename: string;
  kind?: "document" | "wiki";
  slug?: string;
};

export type ChatTarget = { page_id: number; title: string; slug: string };

type SseEvent =
  | { type: "text-delta"; text: string }
  | { type: "sources"; sources: Source[] }
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

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!raw.startsWith("data: ")) continue;
        const data = raw.slice("data: ".length);
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data) as SseEvent;
        } catch {
          // skip malformed events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
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
      const sourceParts = () =>
        sources.map((s) => ({
          type: "source" as const,
          sourceType: "url" as const,
          id: String(s.id),
          url:
            s.kind === "wiki" && s.slug
              ? `/wiki/page/${s.slug}`
              : `${baseUrl}/api/knowledge/files/${s.id}/raw`,
          title: `[${s.label}] ${s.filename}`,
          kind: s.kind ?? "document",
          slug: s.slug,
        }));
      for await (const event of parseSse(response.body)) {
        if (event.type === "error") {
          throw new ChatError(
            event.code,
            errorCopy(event, getModel()),
            event.retry_after,
          );
        }
        if (event.type === "target") {
          onTarget?.(event.target);
        }
        if (event.type === "sources") sources = event.sources;
        if (event.type === "text-delta") {
          text += event.text;
          yield {
            content: [{ type: "text" as const, text }, ...sourceParts()],
            // Carried on the message so a `wiki-update` proposal card
            // (Task 16) can reuse this exact list as its citations, per the
            // "citations = the message's sources event payload" rule.
            metadata: { custom: { citationSources: sources } },
          };
        }
      }
    },
  };
}
