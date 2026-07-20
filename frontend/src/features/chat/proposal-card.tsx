import { useState } from "react";
import { DiffViewer } from "@/components/assistant-ui/diff-viewer";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Button } from "@/components/ui/button";
import { loadSettings } from "@/features/settings/settings-storage";
import { diffToHunks, hunksToPatch } from "@/features/wiki/diff";
import { approveProposal, createProposal, type WikiPage } from "@/features/wiki/api";
import { WikiMarkdown, type WikiLinkResolver } from "@/features/wiki/wiki-markdown";
import { bumpTargetRefresh, useTargetPage } from "./target-selection";
import { extractWikiUpdate, stripActionFences } from "./wiki-update";

type CardStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "submitted"; proposalId: number }
  | { kind: "approved"; proposalId: number }
  | { kind: "error"; message: string }
  | { kind: "dismissed" };

/** Compact placeholder shown while a `wiki-update` fence is still streaming
 * (no closing fence has arrived yet) — deliberately not the diff/content UI
 * below, so partial fence markdown never flashes on screen. */
export function DraftingProposalPlaceholder() {
  return (
    <div className="my-2 flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="animate-pulse">●</span>
      drafting page update…
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
      setStatus({ kind: "submitted", proposalId: proposal.id });
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
      setStatus({ kind: "approved", proposalId: proposal.id });
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
            proposal #{status.proposalId} submitted
          </span>
        )}
        {status.kind === "approved" && (
          <span className="text-xs text-muted-foreground">
            proposal #{status.proposalId} approved
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

/**
 * Renders an assistant text part, replacing a completed ```` ```wiki-update
 * ```` fence with a `<ProposalCard>` (and a still-streaming one with the
 * compact placeholder). Ordinary messages with no fence at all render
 * exactly as before via `<MarkdownText />`, which pulls the full part text
 * from assistant-ui's own context rather than the `text` prop — so this
 * only changes rendering for messages that actually contain the fence.
 */
export function WikiUpdateAwareText({
  text,
  citations = [],
}: {
  text: string;
  citations?: unknown[];
}) {
  // Drop `wiki-create-page` / `collection-create` tool JSON so it never shows
  // as raw text (those actions are executed + confirmed out of band).
  const cleaned = stripActionFences(text);
  const hadActionFence = cleaned !== text.trim();
  const { before, block, after } = extractWikiUpdate(cleaned);
  // Called unconditionally (rules of hooks) — cheap no-op fetch when there's
  // no fence to react to, since most messages never hit this path anyway.
  const { page: targetPage } = useTargetPage();

  if (!block) {
    // Stripped an action fence: render the cleaned prose ourselves, since
    // `MarkdownText` pulls the raw (unstripped) part text from context.
    if (hadActionFence) {
      return cleaned ? (
        <WikiMarkdown content={cleaned} resolve={noResolve} />
      ) : null;
    }
    return <MarkdownText />;
  }

  return (
    <>
      {before.trim() && <WikiMarkdown content={before} resolve={noResolve} />}
      {block.status === "pending" ? (
        <DraftingProposalPlaceholder />
      ) : (
        <ProposalCard content={block.content} targetPage={targetPage} citations={citations} />
      )}
      {block.status === "complete" && after.trim() && (
        <WikiMarkdown content={after} resolve={noResolve} />
      )}
    </>
  );
}
