import { beforeEach, expect, test, vi } from "vitest";
import { BackendAttachmentAdapter } from "./backend-attachment-adapter";
import * as knowledgeApi from "@/features/knowledge/api";

beforeEach(() => vi.restoreAllMocks());

test("add returns a pending document attachment carrying the file", async () => {
  const adapter = new BackendAttachmentAdapter();
  const file = new File(["spec"], "sheet.txt", { type: "text/plain" });
  const pending = await adapter.add({ file });
  expect(pending.type).toBe("document");
  expect(pending.name).toBe("sheet.txt");
  expect(pending.file).toBe(file);
  expect(pending.status).toEqual({
    type: "requires-action",
    reason: "composer-send",
  });
});

test("send uploads the file and returns the server id as a string", async () => {
  vi.spyOn(knowledgeApi, "uploadAttachment").mockResolvedValue({
    id: 42,
    filename: "sheet.txt",
  });
  const adapter = new BackendAttachmentAdapter();
  const file = new File(["spec"], "sheet.txt", { type: "text/plain" });
  const pending = await adapter.add({ file });
  const complete = await adapter.send(pending);
  expect(complete.id).toBe("42");
  expect(complete.status).toEqual({ type: "complete" });
  expect(complete.content).toEqual([]);
});
