import { beforeEach, expect, test, vi } from "vitest";
import { BackendAttachmentAdapter } from "./backend-attachment-adapter";
import * as knowledgeApi from "@/features/knowledge/api";

beforeEach(() => vi.restoreAllMocks());

test("add uploads immediately and carries the server id as a string", async () => {
  vi.spyOn(knowledgeApi, "uploadAttachment").mockResolvedValue({
    id: 42,
    filename: "sheet.txt",
  });
  const adapter = new BackendAttachmentAdapter();
  const file = new File(["spec"], "sheet.txt", { type: "text/plain" });
  const pending = await adapter.add({ file });
  expect(pending.type).toBe("document");
  expect(pending.name).toBe("sheet.txt");
  expect(pending.file).toBe(file);
  expect(pending.id).toBe("42");
  expect(pending.status).toEqual({
    type: "requires-action",
    reason: "composer-send",
  });
});

test("send is instant (no upload) and completes the attachment", async () => {
  const uploadSpy = vi
    .spyOn(knowledgeApi, "uploadAttachment")
    .mockResolvedValue({ id: 42, filename: "sheet.txt" });
  const adapter = new BackendAttachmentAdapter();
  const file = new File(["spec"], "sheet.txt", { type: "text/plain" });
  const pending = await adapter.add({ file });
  uploadSpy.mockClear();
  const complete = await adapter.send(pending);
  expect(uploadSpy).not.toHaveBeenCalled(); // no network on send
  expect(complete.id).toBe("42"); // id preserved across add -> send
  expect(complete.status).toEqual({ type: "complete" });
  expect(complete.content).toEqual([]);
});

test("a failed upload yields an error attachment instead of throwing", async () => {
  vi.spyOn(knowledgeApi, "uploadAttachment").mockRejectedValue(
    new Error("That file is too large (20 MB max)."),
  );
  const adapter = new BackendAttachmentAdapter();
  const file = new File(["x"], "big.pdf", { type: "application/pdf" });
  const pending = await adapter.add({ file });
  expect(pending.status.type).toBe("incomplete");
  expect(pending.status).toMatchObject({
    reason: "error",
    message: /too large/i,
  });
});
