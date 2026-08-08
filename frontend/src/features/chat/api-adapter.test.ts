import { createApiAdapter } from "./api-adapter";
import { createPageRef } from "./create-page-mode";

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
    wikiPageIds: [],
  }));
  await drain(run(adapter));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.collection_ids).toEqual([1, 2]);
  expect(body.attachment_ids).toBeUndefined();
  vi.unstubAllGlobals();
});

test("includes wiki page ids in the request body when selected", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter("https://api.test", () => null, () => ({
    collectionIds: [],
    attachmentIds: [],
    wikiPageIds: [7, 8],
  }));
  await drain(run(adapter));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.wiki_page_ids).toEqual([7, 8]);
  vi.unstubAllGlobals();
});

test("includes target_page_id in the request body when a target is set", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter(
    "https://api.test",
    () => null,
    () => ({ collectionIds: [], attachmentIds: [], wikiPageIds: [] }),
    () => 9,
  );
  await drain(run(adapter));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.target_page_id).toBe(9);
  vi.unstubAllGlobals();
});

test("a page picked as the target is never also sent inside wiki_page_ids", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter(
    "https://api.test",
    () => null,
    () => ({ collectionIds: [], attachmentIds: [], wikiPageIds: [5, 9] }),
    () => 9,
  );
  await drain(run(adapter));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.target_page_id).toBe(9);
  expect(body.wiki_page_ids).toEqual([5]);
  vi.unstubAllGlobals();
});

test("a target SSE event invokes the onTarget callback and isn't treated as text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          type: "target",
          target: { page_id: 4, title: "Setup", slug: "setup" },
        }),
        JSON.stringify({ type: "text-delta", text: "ok" }),
        "[DONE]",
      ]),
    ),
  );
  const onTarget = vi.fn();
  const adapter = createApiAdapter(
    "https://api.test",
    () => null,
    () => ({ collectionIds: [], attachmentIds: [], wikiPageIds: [] }),
    () => 4,
    onTarget,
  );
  let finalText = "";
  for await (const chunk of run(adapter)) {
    const part = chunk.content[0];
    if (part?.type === "text" && part.text) finalText = part.text;
  }
  expect(finalText).toBe("ok");
  expect(onTarget).toHaveBeenCalledWith({ page_id: 4, title: "Setup", slug: "setup" });
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
    wikiPageIds: [],
  }));
  type Chunk = { content: readonly { type: string; title?: string }[] };
  let last: Chunk | null = null;
  for await (const chunk of run(adapter)) last = chunk as unknown as Chunk;
  const sourceParts = last!.content.filter((p) => p.type === "source");
  expect(sourceParts).toHaveLength(1);
  expect(sourceParts[0].title).toBe("[S1] manual.pdf");
  vi.unstubAllGlobals();
});

test("a wiki-kind source becomes an internal /wiki/page/ url, and rides along on the message metadata for citation reuse", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          type: "sources",
          sources: [
            { id: 4, label: "S1", filename: "Setup", kind: "wiki", slug: "setup" },
          ],
        }),
        JSON.stringify({ type: "text-delta", text: "see [S1]" }),
        "[DONE]",
      ]),
    ),
  );
  const adapter = createApiAdapter("https://api.test", () => null, () => ({
    collectionIds: [],
    attachmentIds: [],
    wikiPageIds: [4],
  }));
  type Chunk = {
    content: readonly { type: string; url?: string; kind?: string }[];
    metadata?: { custom?: { citationSources?: unknown[] } };
  };
  let last: Chunk | null = null;
  for await (const chunk of run(adapter)) last = chunk as unknown as Chunk;
  const sourceParts = last!.content.filter((p) => p.type === "source");
  expect(sourceParts[0]?.url).toBe("/wiki/page/setup");
  expect(sourceParts[0]?.kind).toBe("wiki");
  expect(last!.metadata?.custom?.citationSources).toEqual([
    { id: 4, label: "S1", filename: "Setup", kind: "wiki", slug: "setup" },
  ]);
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

test("includes tools_enabled and owner_token when owner token is set", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify({ ownerToken: "sekrit" }),
  });
  const adapter = createApiAdapter("https://api.test", () => null);
  await drain(run(adapter));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.tools_enabled).toBe(true);
  expect(body.owner_token).toBe("sekrit");
  vi.unstubAllGlobals();
});

test("omits tools_enabled and owner_token when owner token is not set", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const adapter = createApiAdapter("https://api.test", () => null);
  await drain(run(adapter));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.tools_enabled).toBeUndefined();
  expect(body.owner_token).toBeUndefined();
  vi.unstubAllGlobals();
});

test("armed create-page mode wraps the newest user message with a drafting directive and consumes the flag", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  createPageRef.current = true;
  const adapter = createApiAdapter("https://api.test", () => null);
  await drain(run(adapter));

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  const userMsg = body.messages[body.messages.length - 1];
  expect(userMsg.role).toBe("user");
  expect(userMsg.content).toContain("create a NEW wiki page");
  expect(userMsg.content).toContain("```wiki-create-page");
  // The original request is preserved at the end.
  expect(userMsg.content.endsWith("hi")).toBe(true);
  // One-shot: the flag is consumed so the next turn isn't a create.
  expect(createPageRef.current).toBe(false);
  vi.unstubAllGlobals();
});

test("without create-page mode the user message is sent unchanged", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([JSON.stringify({ type: "text-delta", text: "ok" }), "[DONE]"]),
  );
  vi.stubGlobal("fetch", fetchMock);
  createPageRef.current = false;
  const adapter = createApiAdapter("https://api.test", () => null);
  await drain(run(adapter));

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.messages[body.messages.length - 1].content).toBe("hi");
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

test("sends the web search mode and surfaces the search event", async () => {
  const { setWebSearchMode } = await import("./web-search-mode");
  setWebSearchMode("on");

  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([
      JSON.stringify({
        type: "search",
        query: "sqlite-vec",
        results: [{ url: "https://a.test", title: "A" }],
      }),
      JSON.stringify({
        type: "sources",
        sources: [
          {
            id: -1,
            label: "S1",
            filename: "A",
            kind: "web",
            url: "https://a.test",
          },
        ],
      }),
      JSON.stringify({ type: "text-delta", text: "hi" }),
      "[DONE]",
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);

  const adapter = createApiAdapter("https://api.test", () => "m");
  const chunks: {
    content: readonly Record<string, unknown>[];
    metadata: { custom: Record<string, unknown> };
  }[] = [];
  for await (const chunk of run(adapter) as AsyncIterable<never>) {
    chunks.push(chunk);
  }

  const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(sent.web_search).toBe("on");

  const last = chunks.at(-1)!;
  expect(last.metadata.custom.webSearch).toEqual({
    query: "sqlite-vec",
    results: [{ url: "https://a.test", title: "A" }],
  });
  const sourcePart = last.content.find((p) => p.type === "source")!;
  expect(sourcePart.url).toBe("https://a.test");
  expect(sourcePart.kind).toBe("web");

  setWebSearchMode("off");
});

test("omits web_search entirely when the mode is off", async () => {
  const { setWebSearchMode } = await import("./web-search-mode");
  setWebSearchMode("off");
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      sseResponse([JSON.stringify({ type: "text-delta", text: "hi" }), "[DONE]"]),
    );
  vi.stubGlobal("fetch", fetchMock);
  await drain(run(createApiAdapter("https://api.test", () => "m")));
  const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect("web_search" in sent).toBe(false);
});

test("a search error is a notice, not a thrown turn", async () => {
  const { setWebSearchMode } = await import("./web-search-mode");
  setWebSearchMode("on");
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([
      JSON.stringify({
        type: "error",
        code: "search_quota_exhausted",
        message: "x",
      }),
      JSON.stringify({ type: "text-delta", text: "answered anyway" }),
      "[DONE]",
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);

  const chunks: {
    content: readonly { type: string; text?: string }[];
    metadata: { custom: Record<string, unknown> };
  }[] = [];
  // The turn must complete: a failed search never aborts an answer.
  for await (const chunk of run(
    createApiAdapter("https://api.test", () => "m"),
  ) as AsyncIterable<never>) {
    chunks.push(chunk);
  }
  const last = chunks.at(-1)!;
  expect(last.content[0]!.text).toBe("answered anyway");
  expect(last.metadata.custom.searchNotice).toMatch(/quota/i);
  setWebSearchMode("off");
});

test("a non-search error still throws", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse([
      JSON.stringify({ type: "error", code: "rate_limited", message: "x" }),
      "[DONE]",
    ]),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    drain(run(createApiAdapter("https://api.test", () => "m"))),
  ).rejects.toThrow(/Rate limited/);
});
