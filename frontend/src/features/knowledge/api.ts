import { API_URL } from "@/features/chat/chat-provider";
import { loadSettings } from "@/features/settings/settings-storage";

export type Collection = { id: number; name: string; file_count: number };
export type KbFile = {
  id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
};

const base = () => API_URL ?? "";

function ownerHeaders(): Record<string, string> {
  const token = loadSettings().ownerToken;
  return token ? { "X-Owner-Token": token } : {};
}

async function check(res: Response): Promise<Response> {
  if (res.status === 401)
    throw new Error("Owner token required — set it in Settings.");
  if (res.status === 413)
    throw new Error("That file is too large (20 MB max).");
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return res;
}

export async function listCollections(): Promise<Collection[]> {
  const res = await check(await fetch(`${base()}/api/knowledge/collections`));
  return (await res.json()).collections;
}

export async function createCollection(name: string): Promise<Collection> {
  const res = await check(
    await fetch(`${base()}/api/knowledge/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ name }),
    }),
  );
  return res.json();
}

export async function listFiles(collectionId: number): Promise<KbFile[]> {
  const res = await check(
    await fetch(`${base()}/api/knowledge/collections/${collectionId}/files`),
  );
  return (await res.json()).files;
}

export async function uploadFile(
  collectionId: number,
  file: File,
): Promise<KbFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await check(
    await fetch(`${base()}/api/knowledge/collections/${collectionId}/files`, {
      method: "POST",
      headers: ownerHeaders(),
      body: form,
    }),
  );
  return res.json();
}

export async function uploadAttachment(
  file: File,
): Promise<{ id: number; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await check(
    await fetch(`${base()}/api/attachments`, { method: "POST", body: form }),
  );
  return res.json();
}

export async function syncStatus(): Promise<string> {
  const res = await check(await fetch(`${base()}/api/knowledge/status`));
  return (await res.json()).sync;
}

export function rawFileUrl(id: number): string {
  return `${base()}/api/knowledge/files/${id}/raw`;
}

export type WebArchiveResult = {
  document: { id: number };
  footnote: string;
};

/** Archives a web search result as a document. No page body is sent — the
 * browser never holds it, so the backend recovers it from the search cache by
 * URL, and a 404 means that cache entry has expired. */
export async function archiveWebResult(body: {
  url: string;
  title: string;
}): Promise<WebArchiveResult> {
  const res = await fetch(`${base()}/api/knowledge/web-archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    throw new Error("That result is no longer cached — search again before saving.");
  }
  return (await check(res)).json();
}
