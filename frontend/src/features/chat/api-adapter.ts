import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";

type SseEvent =
  | { type: "text-delta"; text: string }
  | { type: "error"; code: string; message: string; retry_after?: number };

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

/** Streams chat completions from the Knowledge Assistant backend. */
export function createApiAdapter(
  baseUrl: string,
  getModel: () => string | null,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, context }) {
      const apiMessages = toApiMessages(messages);
      if (context?.system) {
        apiMessages.unshift({ role: "system", content: context.system });
      }
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: getModel(), messages: apiMessages }),
        signal: abortSignal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`The backend returned ${response.status} — try again shortly.`);
      }
      let text = "";
      for await (const event of parseSse(response.body)) {
        if (event.type === "error") {
          throw new ChatError(
            event.code,
            errorCopy(event, getModel()),
            event.retry_after,
          );
        }
        if (event.type === "text-delta") {
          text += event.text;
          yield { content: [{ type: "text" as const, text }] };
        }
      }
    },
  };
}
