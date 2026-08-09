/**
 * Server-sent-event frame parser, shared by the chat stream and the skill-run
 * stream — one parser, so the two can never drift.
 *
 * Both endpoints are POST/header-authed rather than `EventSource`-friendly,
 * which is why this reads a `fetch` body stream directly.
 */
export async function* parseSse<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
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
          yield JSON.parse(data) as T;
        } catch {
          // skip malformed events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
