import { API_URL } from "@/features/chat/chat-provider";
import { loadSettings } from "@/features/settings/settings-storage";
import { bumpWikiData } from "./wiki-refresh";

export type WikiFolder = {
  id: number;
  name: string;
  parent_id: number | null;
  position: number;
  created_at: string;
};

export type WikiPageSummary = {
  id: number;
  folder_id: number | null;
  title: string;
  slug: string;
  position: number;
  updated_at: string;
  last_author: "owner" | "assistant" | null;
};

export type WikiLastVersion = {
  author: "owner" | "assistant";
  created_at: string;
  note: string;
};

export type WikiPage = WikiPageSummary & {
  content: string;
  last_version: WikiLastVersion | null;
};

export type WikiTree = { folders: WikiFolder[]; pages: WikiPageSummary[] };

export type WikiHistoryEntry = {
  sha: string;
  author: "owner" | "assistant";
  note: string;
  created_at: string;
};

export type WikiCommitDetail = {
  sha: string;
  content: string;
};

export type WikiProposal = {
  id: number;
  page_id: number | null;
  /** Per-page sequence number (new-page proposals share one bucket). */
  proposal_number: number;
  title: string;
  folder_id: number | null;
  base_version_id: number | null;
  content: string;
  rationale: string;
  citations: unknown[];
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
  current_content?: string | null;
};

export type WikiSearchResult = {
  id: number;
  title: string;
  slug: string;
  snippet: string;
};

const base = () => API_URL ?? "";

function ownerHeaders(): Record<string, string> {
  const token = loadSettings().ownerToken;
  return token ? { "X-Owner-Token": token } : {};
}

async function errorMessage(res: Response): Promise<string | null> {
  try {
    const data = (await res.clone().json()) as { detail?: unknown };
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (
      detail &&
      typeof detail === "object" &&
      "message" in detail &&
      typeof (detail as { message?: unknown }).message === "string"
    ) {
      return (detail as { message: string }).message;
    }
  } catch {
    // Non-JSON or empty body — fall through to a generic message.
  }
  return null;
}

async function check(res: Response): Promise<Response> {
  if (res.status === 401)
    throw new Error("Owner token required — set it in Settings.");
  if (res.ok) return res;
  const message = await errorMessage(res);
  if (res.status === 409)
    throw new Error(message ?? "Conflict — that action can't be completed right now.");
  if (res.status === 429)
    throw new Error(message ?? "Rate limited — wait a moment and retry.");
  throw new Error(message ?? `Request failed (${res.status}).`);
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

/** Broadcast a wiki-data change (so every mounted wiki hook refetches) and pass
 * the mutation's result straight through. Wrapped around each successful write
 * so no caller can forget to refresh sibling views. */
function bumped<T>(value: T): T {
  bumpWikiData();
  return value;
}

// ---- Tree ----

export async function getTree(): Promise<WikiTree> {
  const res = await check(await fetch(`${base()}/api/wiki/tree`));
  return res.json();
}

// ---- Folders ----

export async function createFolder(
  name: string,
  parentId: number | null,
): Promise<WikiFolder> {
  const res = await check(
    await fetch(
      `${base()}/api/wiki/folders`,
      jsonInit("POST", { name, parent_id: parentId }),
    ),
  );
  return bumped(await res.json());
}

export async function patchFolder(
  folderId: number,
  patch: { name?: string; parent_id?: number | null },
): Promise<WikiFolder> {
  const res = await check(
    await fetch(`${base()}/api/wiki/folders/${folderId}`, jsonInit("PATCH", patch)),
  );
  return bumped(await res.json());
}

export async function deleteFolder(folderId: number): Promise<void> {
  await check(
    await fetch(`${base()}/api/wiki/folders/${folderId}`, {
      method: "DELETE",
      headers: ownerHeaders(),
    }),
  );
  bumpWikiData();
}

// ---- Pages ----

export async function createPage(
  title: string,
  folderId: number | null,
  content = "",
): Promise<WikiPage> {
  const res = await check(
    await fetch(
      `${base()}/api/wiki/pages`,
      jsonInit("POST", { title, folder_id: folderId, content }),
    ),
  );
  return bumped(await res.json());
}

export async function getPage(pageId: number): Promise<WikiPage> {
  const res = await check(await fetch(`${base()}/api/wiki/pages/${pageId}`));
  return res.json();
}

export async function getPageBySlug(slug: string): Promise<WikiPage> {
  const res = await check(
    await fetch(`${base()}/api/wiki/pages/by-slug/${encodeURIComponent(slug)}`),
  );
  return res.json();
}

export async function updatePage(
  pageId: number,
  content: string,
  note = "",
): Promise<WikiPage> {
  const res = await check(
    await fetch(
      `${base()}/api/wiki/pages/${pageId}`,
      jsonInit("PUT", { content, note }),
    ),
  );
  return bumped(await res.json());
}

export async function patchPage(
  pageId: number,
  patch: { title?: string; folder_id?: number | null },
): Promise<WikiPage> {
  const res = await check(
    await fetch(`${base()}/api/wiki/pages/${pageId}`, jsonInit("PATCH", patch)),
  );
  return bumped(await res.json());
}

export async function deletePage(pageId: number): Promise<void> {
  await check(
    await fetch(`${base()}/api/wiki/pages/${pageId}`, {
      method: "DELETE",
      headers: ownerHeaders(),
    }),
  );
  bumpWikiData();
}

// ---- History ----

export async function getPageHistory(pageId: number): Promise<WikiHistoryEntry[]> {
  const res = await check(
    await fetch(`${base()}/api/wiki/pages/${pageId}/history`),
  );
  return (await res.json()).history;
}

export async function getCommit(
  pageId: number,
  sha: string,
): Promise<WikiCommitDetail> {
  const res = await check(
    await fetch(`${base()}/api/wiki/pages/${pageId}/commits/${encodeURIComponent(sha)}`),
  );
  return res.json();
}

export async function restoreCommit(
  pageId: number,
  sha: string,
): Promise<WikiPage> {
  const res = await check(
    await fetch(
      `${base()}/api/wiki/pages/${pageId}/restore/${encodeURIComponent(sha)}`,
      { method: "POST", headers: ownerHeaders() },
    ),
  );
  return bumped(await res.json());
}

// ---- Search ----

export async function searchPages(query: string): Promise<WikiSearchResult[]> {
  const res = await check(
    await fetch(`${base()}/api/wiki/search?q=${encodeURIComponent(query)}`),
  );
  return (await res.json()).results;
}

// ---- Draft + proposals ----

export type DraftRequest = {
  instruction: string;
  page_id?: number | null;
  collection_ids?: number[];
  attachment_ids?: number[];
  model?: string | null;
};

export async function draftPage(body: DraftRequest): Promise<WikiProposal> {
  const res = await check(
    await fetch(`${base()}/api/wiki/draft`, jsonInit("POST", body)),
  );
  return bumped(await res.json());
}

export type ProposalCreate = {
  page_id?: number | null;
  title: string;
  folder_id: number | null;
  content: string;
  rationale?: string;
  citations?: unknown[] | null;
};

export async function createProposal(body: ProposalCreate): Promise<WikiProposal> {
  const res = await check(
    await fetch(`${base()}/api/wiki/proposals`, jsonInit("POST", body)),
  );
  return bumped(await res.json());
}

export async function listProposals(status?: string): Promise<WikiProposal[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await check(await fetch(`${base()}/api/wiki/proposals${qs}`));
  return (await res.json()).proposals;
}

export async function approveProposal(proposalId: number): Promise<WikiPage> {
  const res = await check(
    await fetch(`${base()}/api/wiki/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: ownerHeaders(),
    }),
  );
  return bumped(await res.json());
}

export async function rejectProposal(proposalId: number): Promise<WikiProposal> {
  const res = await check(
    await fetch(`${base()}/api/wiki/proposals/${proposalId}/reject`, {
      method: "POST",
      headers: ownerHeaders(),
    }),
  );
  return bumped(await res.json());
}
