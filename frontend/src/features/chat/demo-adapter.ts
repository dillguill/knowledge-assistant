import type { ChatModelAdapter } from "@assistant-ui/react";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Demo-mode stand-in for the real backend. Streams a canned reply so the
 * stock chat is usable on GitHub Pages before the FastAPI Space exists.
 * Swapped for an SSE ChatModelAdapter pointed at the Space in v0.1.0.
 */
export const demoAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const last = messages.at(-1);
    const firstPart = last?.content[0];
    const userText =
      firstPart && firstPart.type === "text" ? firstPart.text : "";
    const reply =
      `**Demo mode** — the backend isn't deployed yet, so this is a canned reply, not a model. ` +
      `You said: “${userText}”.\n\n` +
      `When the FastAPI Space ships (v0.1.0), this exact chat streams real models via OpenRouter.`;
    let text = "";
    for (const word of reply.split(/(?<=\s)/)) {
      if (abortSignal.aborted) return;
      text += word;
      yield { content: [{ type: "text" as const, text }] };
      await sleep(15);
    }
  },
};
