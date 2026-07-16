import { demoAdapter } from "./demo-adapter";

test("streams a demo reply that names demo mode and echoes the prompt", async () => {
  const chunks: string[] = [];
  const result = demoAdapter.run({
    messages: [
      { role: "user", content: [{ type: "text", text: "hello world" }] },
    ],
    abortSignal: new AbortController().signal,
  } as never);
  for await (const chunk of result as AsyncIterable<{
    content: readonly { type: string; text?: string }[];
  }>) {
    const part = chunk.content[0];
    if (part?.type === "text" && part.text) chunks.push(part.text);
  }
  const finalText = chunks.at(-1) ?? "";
  expect(finalText).toMatch(/demo mode/i);
  expect(finalText).toContain("hello world");
});

test("stops streaming when aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = demoAdapter.run({
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    abortSignal: controller.signal,
  } as never);
  let count = 0;
  for await (const _ of result as AsyncIterable<unknown>) {
    count += 1;
  }
  expect(count).toBeLessThanOrEqual(1);
});
