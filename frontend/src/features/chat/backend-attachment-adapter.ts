import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import { uploadAttachment } from "@/features/knowledge/api";

/** Uploads in-chat attachments to the backend so the reply can be grounded in
 * them. The completed attachment's id is the backend document id (as a string),
 * which the chat adapter reads back into the request's attachment_ids. */
export class BackendAttachmentAdapter implements AttachmentAdapter {
  accept = ".pdf,.txt,.md,.html,text/*,application/pdf";

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      id: crypto.randomUUID(),
      type: "document",
      name: file.name,
      contentType: file.type,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const { id } = await uploadAttachment(attachment.file);
    return {
      id: String(id),
      type: attachment.type,
      name: attachment.name,
      contentType: attachment.contentType,
      status: { type: "complete" },
      content: [],
    };
  }

  async remove(): Promise<void> {}
}
