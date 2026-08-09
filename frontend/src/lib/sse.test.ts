import { describe, expect, it } from "vitest";
import { parseSse } from "./sse";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(body: ReadableStream<Uint8Array>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of parseSse<T>(body)) out.push(e);
  return out;
}

describe("parseSse", () => {
  it("yields one event per data frame", async () => {
    const events = await collect(stream(['data: {"a":1}\n\n', 'data: {"a":2}\n\n']));
    expect(events).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("reassembles an event split across chunks", async () => {
    expect(await collect(stream(['data: {"a"', ":1}\n\n"]))).toEqual([{ a: 1 }]);
  });

  it("handles several events arriving in one chunk", async () => {
    expect(await collect(stream(['data: {"a":1}\n\ndata: {"a":2}\n\n']))).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  it("stops at [DONE]", async () => {
    const events = await collect(
      stream(['data: {"a":1}\n\n', "data: [DONE]\n\n", 'data: {"a":2}\n\n']),
    );
    expect(events).toEqual([{ a: 1 }]);
  });

  it("skips malformed frames rather than throwing", async () => {
    expect(await collect(stream(["data: not json\n\n", 'data: {"a":1}\n\n']))).toEqual([
      { a: 1 },
    ]);
  });

  it("ignores non-data lines such as comments and retry hints", async () => {
    expect(
      await collect(stream([": keepalive\n\n", "retry: 100\n\n", 'data: {"a":1}\n\n'])),
    ).toEqual([{ a: 1 }]);
  });
});
