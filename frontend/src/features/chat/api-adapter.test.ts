import { createApiAdapter } from "./api-adapter";

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function run(
  adapter: ReturnType<typeof createApiAdapter>,
  context: object = {},
) {
  return adapter.run({
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    abortSignal: new AbortController().signal,
    context,
  } as never) as AsyncIterable<{
    content: readonly { type: string; text?: string }[];
  }>;
}

async function drain(iter: AsyncIterable<unknown>) {
  for await (const _ of iter) {
    // drain
  }
}

test("accumulates text deltas from the SSE stream", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([
      JSON.stringify({ type: "text-delta", text: "Hel" }),
      JSON.stringify({ type: "text-delta", text: "lo!" }),
      "[DONE]",
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter("https://api.test", () => "some/model:free");

  let finalText = "";
  for await (const chunk of run(adapter)) {
    const part = chunk.content[0];
    if (part?.type === "text" && part.text) finalText = part.text;
  }
  expect(finalText).toBe("Hello!");
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test/api/chat",
    expect.objectContaining({ method: "POST" }),
  );
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.model).toBe("some/model:free");
  expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  vi.unstubAllGlobals();
});

test("prepends context.system as a system message", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter("https://api.test", () => "m1");
  await drain(run(adapter, { system: "Cite sources." }));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.messages[0]).toEqual({
    role: "system",
    content: "Cite sources.",
  });
  expect(body.messages[1].role).toBe("user");
  vi.unstubAllGlobals();
});

test("sends no system message when context.system is absent", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter("https://api.test", () => "m1");
  await drain(run(adapter, {}));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.messages[0].role).toBe("user");
  vi.unstubAllGlobals();
});

test("rate_limited with retry_after produces countdown copy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          type: "error",
          code: "rate_limited",
          message: "upstream words",
          retry_after: 52,
        }),
      ]),
    ),
  );
  const adapter = createApiAdapter("https://api.test", () => "m1");
  await expect(drain(run(adapter))).rejects.toMatchObject({
    name: "ChatError",
    code: "rate_limited",
    retryAfter: 52,
    message: "Rate limited — try again in ~52s.",
  });
  vi.unstubAllGlobals();
});

test("model_gone names the selected model and points at the selector", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          type: "error",
          code: "model_gone",
          message: "upstream words",
        }),
      ]),
    ),
  );
  const adapter = createApiAdapter("https://api.test", () => "old/model:free");
  await expect(drain(run(adapter))).rejects.toMatchObject({
    code: "model_gone",
    message:
      "old/model:free is no longer available — pick another model and regenerate.",
  });
  vi.unstubAllGlobals();
});

test("unknown error codes get generic retry copy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          type: "error",
          code: "upstream_error",
          message: "upstream words",
        }),
      ]),
    ),
  );
  const adapter = createApiAdapter("https://api.test", () => null);
  await expect(drain(run(adapter))).rejects.toMatchObject({
    code: "upstream_error",
    message: "The model provider had a problem. Regenerate to retry.",
  });
  vi.unstubAllGlobals();
});

test("includes collection ids in the request body when selected", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter("https://api.test", () => null, () => ({
    collectionIds: [1, 2],
    attachmentIds: [],
  }));
  await drain(run(adapter));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.collection_ids).toEqual([1, 2]);
  expect(body.attachment_ids).toBeUndefined();
  vi.unstubAllGlobals();
});

test("sources event becomes source content parts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          type: "sources",
          sources: [{ id: 3, label: "S1", filename: "manual.pdf" }],
        }),
        JSON.stringify({ type: "text-delta", text: "22 Nm [S1]" }),
        "[DONE]",
      ]),
    ),
  );
  const adapter = createApiAdapter("https://api.test", () => null, () => ({
    collectionIds: [1],
    attachmentIds: [],
  }));
  type Chunk = { content: readonly { type: string; title?: string }[] };
  let last: Chunk | null = null;
  for await (const chunk of run(adapter)) last = chunk as unknown as Chunk;
  const sourceParts = last!.content.filter((p) => p.type === "source");
  expect(sourceParts).toHaveLength(1);
  expect(sourceParts[0].title).toBe("[S1] manual.pdf");
  vi.unstubAllGlobals();
});

test("collects attachment ids from message attachments into the body", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter("https://api.test", () => null);
  const iter = adapter.run({
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hi" }],
        attachments: [{ id: "12" }, { id: "not-a-number" }],
      },
    ],
    abortSignal: new AbortController().signal,
    context: {},
  } as never) as AsyncIterable<unknown>;
  await drain(iter);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.attachment_ids).toEqual([12]);
  vi.unstubAllGlobals();
});

test("throws a readable error on an error event", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          type: "error",
          code: "rate_limited",
          message: "Free-tier rate limit hit — wait a moment and retry.",
        }),
        "[DONE]",
      ]),
    ),
  );
  const adapter = createApiAdapter("https://api.test", () => null);
  await expect(async () => {
    for await (const _ of run(adapter)) {
      // drain
    }
  }).rejects.toThrow(/rate limit/i);
  vi.unstubAllGlobals();
});
