import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import { uploadAttachment } from "@/features/knowledge/api";

/** Uploads in-chat attachments to the backend so the reply can be grounded in
 * them. The upload happens in `add` (when the file is attached), matching
 * assistant-ui's own CloudFileAttachmentAdapter — so `send` is instant and the
 * user message appends immediately instead of waiting on a network round-trip
 * (which would briefly render the thread as empty). The attachment id is the
 * backend document id (as a string), which the chat adapter reads back into the
 * request's `attachment_ids`. */
export class BackendAttachmentAdapter implements AttachmentAdapter {
  accept = ".pdf,.txt,.md,.html,text/*,application/pdf";

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    const base = {
      type: "document" as const,
      name: file.name,
      contentType: file.type,
      file,
    };
    try {
      const { id } = await uploadAttachment(file);
      return {
        id: String(id),
        ...base,
        status: { type: "requires-action", reason: "composer-send" },
      };
    } catch (e) {
      return {
        id: crypto.randomUUID(),
        ...base,
        status: {
          type: "incomplete",
          reason: "error",
          message: e instanceof Error ? e.message : "Upload failed.",
        },
      };
    }
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    return { ...attachment, status: { type: "complete" }, content: [] };
  }

  async remove(): Promise<void> {}
}
