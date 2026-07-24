import { useState } from "react";
import { DiffViewer } from "@/components/assistant-ui/diff-viewer";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Button } from "@/components/ui/button";
import { loadSettings } from "@/features/settings/settings-storage";
import { diffToHunks, hunksToPatch } from "@/features/wiki/diff";
import { approveProposal, createProposal, type WikiPage } from "@/features/wiki/api";
import { WikiMarkdown, type WikiLinkResolver } from "@/features/wiki/wiki-markdown";
import { bumpTargetRefresh, useTargetPage, useTargetSelection } from "./target-selection";
import {
  extractWikiCreatePage,
  extractWikiUpdate,
  stripActionFences,
  type WikiCreatePageData,
} from "./wiki-update";

type CardStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "submitted"; proposalNumber: number }
  | { kind: "approved"; proposalNumber: number }
  | { kind: "error"; message: string }
  | { kind: "dismissed" };

/** Compact placeholder shown while a `wiki-update` / `wiki-create-page` fence is
 * still streaming (no closing fence has arrived yet) — deliberately not the
 * diff/content UI below, so partial fence markdown/JSON never flashes on
 * screen. */
export function DraftingProposalPlaceholder({
  label = "drafting page update…",
}: {
  label?: string;
}) {
  return (
    <div className="my-2 flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="animate-pulse">●</span>
      {label}
    </div>
  );
}

/**
 * A completed `wiki-update` fence, rendered as a diff against the current
 * Target page plus explicit actions. Nothing persists from the fence alone —
 * only Propose or Approve now write anything.
 */
export function ProposalCard({
  content,
  targetPage,
  citations = [],
}: {
  content: string;
  targetPage: WikiPage | null;
  citations?: unknown[];
}) {
  const [status, setStatus] = useState<CardStatus>({ kind: "idle" });
  const isOwner = Boolean(loadSettings().ownerToken);

  if (status.kind === "dismissed") return null;

  const patch = targetPage
    ? hunksToPatch(diffToHunks(targetPage.content, content), targetPage.title, "proposed")
    : null;

  async function handlePropose() {
    if (!targetPage) return;
    setStatus({ kind: "busy" });
    try {
      const proposal = await createProposal({
        page_id: targetPage.id,
        title: targetPage.title,
        folder_id: targetPage.folder_id,
        content,
        citations,
      });
      setStatus({ kind: "submitted", proposalNumber: proposal.proposal_number });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not submit the proposal.";
      setStatus({
        kind: "error",
        message: /rate limit|queue is full/i.test(message)
          ? "Proposal queue is full — try again shortly."
          : message,
      });
    }
  }

  async function handleApproveNow() {
    if (!targetPage) return;
    setStatus({ kind: "busy" });
    try {
      const proposal = await createProposal({
        page_id: targetPage.id,
        title: targetPage.title,
        folder_id: targetPage.folder_id,
        content,
        citations,
      });
      await approveProposal(proposal.id);
      bumpTargetRefresh();
      setStatus({ kind: "approved", proposalNumber: proposal.proposal_number });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Could not approve the proposal.",
      });
    }
  }

  const busy = status.kind === "busy";

  return (
    <div className="my-2 flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          Proposed wiki update{targetPage ? `: ${targetPage.title}` : ""}
        </span>
        {status.kind === "submitted" && (
          <span className="text-xs text-muted-foreground">
            proposal #{status.proposalNumber} submitted
          </span>
        )}
        {status.kind === "approved" && (
          <span className="text-xs text-muted-foreground">
            proposal #{status.proposalNumber} approved
          </span>
        )}
      </div>

      {!targetPage && (
        <p className="text-sm text-muted-foreground">
          No target page selected — reopen the page as Target to propose this update.
        </p>
      )}

      {patch && <DiffViewer patch={patch} showIcon={false} />}

      {status.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}

      {status.kind !== "submitted" && status.kind !== "approved" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void handlePropose()} disabled={busy || !targetPage}>
            Propose
          </Button>
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleApproveNow()}
              disabled={busy || !targetPage}
            >
              Approve now
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStatus({ kind: "dismissed" })}
            disabled={busy}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

// The `wiki-update` fence is line-anchored, plain-text-only surrounding
// prose doesn't need chat's streaming-aware `MarkdownTextPrimitive` — a
// plain `WikiMarkdown` render (same prose styling, no wiki-link resolution
// needed here) is enough for the `before`/`after` slices around the fence.
const noResolve: WikiLinkResolver = () => ({ slug: "", exists: false });

type CreateStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "proposed"; proposalNumber: number }
  | { kind: "created"; title: string }
  | { kind: "error"; message: string }
  | { kind: "dismissed" };

/**
 * A completed `wiki-create-page` fence, rendered as a preview of a *new* page
 * plus explicit save actions. Unlike `ProposalCard` (which edits the pinned
 * Target), there's no existing page to diff against, so it shows the drafted
 * markdown. Nothing is written until the user acts: an owner can create it now
 * (create + approve in one step, then the new page opens in the side panel) or
 * submit it as a pending proposal; a visitor can only propose. This is the
 * single create path — the chat turn itself never writes the page — so the
 * assistant can't glitch into claiming a page exists when it doesn't.
 */
export function CreatePageCard({
  data,
  citations = [],
}: {
  data: WikiCreatePageData;
  citations?: unknown[];
}) {
  const [status, setStatus] = useState<CreateStatus>({ kind: "idle" });
  const { setTargetPageId } = useTargetSelection();
  const isOwner = Boolean(loadSettings().ownerToken);

  if (status.kind === "dismissed") return null;

  async function submit(approve: boolean) {
    setStatus({ kind: "busy" });
    try {
      const proposal = await createProposal({
        page_id: null,
        title: data.title,
        folder_id: data.folderId,
        content: data.content,
        citations,
      });
      if (approve) {
        const page = await approveProposal(proposal.id);
        // Pin the brand-new page as the edit target: opens the chat side panel
        // showing it (same as the create-dialog flow).
        setTargetPageId(page.id);
        setStatus({ kind: "created", title: page.title });
      } else {
        setStatus({ kind: "proposed", proposalNumber: proposal.proposal_number });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save the page.";
      setStatus({
        kind: "error",
        message: /rate limit|queue is full/i.test(message)
          ? "Proposal queue is full — try again shortly."
          : message,
      });
    }
  }

  const busy = status.kind === "busy";
  const done = status.kind === "proposed" || status.kind === "created";

  return (
    <div className="my-2 flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          New page draft{data.title ? `: ${data.title}` : ""}
        </span>
        {status.kind === "proposed" && (
          <span className="text-xs text-muted-foreground">
            proposal #{status.proposalNumber} submitted
          </span>
        )}
        {status.kind === "created" && (
          <span className="text-xs text-muted-foreground">page created</span>
        )}
      </div>

      {!done && (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-3">
          <WikiMarkdown content={data.content || "_(empty draft)_"} resolve={noResolve} />
        </div>
      )}

      {status.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}

      {!done && (
        <div className="flex flex-wrap gap-2">
          {isOwner ? (
            <>
              <Button
                size="sm"
                onClick={() => void submit(true)}
                disabled={busy || !data.title}
              >
                Create page
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void submit(false)}
                disabled={busy || !data.title}
              >
                Propose instead
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => void submit(false)}
              disabled={busy || !data.title}
            >
              Propose page
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStatus({ kind: "dismissed" })}
            disabled={busy}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Renders an assistant text part, replacing a completed ```` ```wiki-update
 * ```` fence with a `<ProposalCard>` (edit the pinned Target) or a
 * ```` ```wiki-create-page ```` fence with a `<CreatePageCard>` (a new-page
 * draft) — each with a compact placeholder while still streaming. Ordinary
 * messages with no fence at all render exactly as before via `<MarkdownText />`,
 * which pulls the full part text from assistant-ui's own context rather than
 * the `text` prop — so this only changes rendering for messages that actually
 * contain a fence.
 */
export function WikiUpdateAwareText({
  text,
  citations = [],
}: {
  text: string;
  citations?: unknown[];
}) {
  // Drop `collection-create` tool JSON so it never shows as raw text (that
  // action is executed + confirmed out of band). `wiki-create-page` is left in
  // and drafted into a card below.
  const cleaned = stripActionFences(text);
  const hadActionFence = cleaned !== text.trim();
  const update = extractWikiUpdate(cleaned);
  const create = extractWikiCreatePage(cleaned);
  // Called unconditionally (rules of hooks) — cheap no-op fetch when there's
  // no fence to react to, since most messages never hit this path anyway.
  const { page: targetPage } = useTargetPage();

  // An edit to the pinned Target page.
  if (update.block) {
    return (
      <>
        {update.before.trim() && <WikiMarkdown content={update.before} resolve={noResolve} />}
        {update.block.status === "pending" ? (
          <DraftingProposalPlaceholder />
        ) : (
          <ProposalCard content={update.block.content} targetPage={targetPage} citations={citations} />
        )}
        {update.block.status === "complete" && update.after.trim() && (
          <WikiMarkdown content={update.after} resolve={noResolve} />
        )}
      </>
    );
  }

  // A brand-new page draft.
  if (create.block) {
    return (
      <>
        {create.before.trim() && <WikiMarkdown content={create.before} resolve={noResolve} />}
        {create.block.status === "pending" ? (
          <DraftingProposalPlaceholder label="drafting new page…" />
        ) : create.block.data ? (
          <CreatePageCard data={create.block.data} citations={citations} />
        ) : null}
        {create.block.status === "complete" && create.after.trim() && (
          <WikiMarkdown content={create.after} resolve={noResolve} />
        )}
      </>
    );
  }

  // No fence. If we stripped a collection-create fence, render the cleaned
  // prose ourselves, since `MarkdownText` pulls the raw (unstripped) part text
  // from context.
  if (hadActionFence) {
    return cleaned ? <WikiMarkdown content={cleaned} resolve={noResolve} /> : null;
  }
  return <MarkdownText />;
}
