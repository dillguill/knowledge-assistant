import { useState } from "react";
import { DiffViewer } from "@/components/assistant-ui/diff-viewer";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/features/settings/settings-provider";
import { approveProposal, rejectProposal, type WikiProposal } from "./api";
import { diffToHunks, hunksToPatch } from "./diff";
import { useWikiProposals } from "./use-wiki";

const NEW_PAGE_LABEL = "(new page)";

/**
 * Minimal proposals inbox: the pending list, a diff per selected proposal,
 * and approve/reject — deliberately nothing more (no filters, no bulk
 * actions, no history tab, per the controller's scope cut). Owners see the
 * full working inbox; a visitor (no owner token) only ever sees the pending
 * count, read-only.
 */
export function ProposalsInbox({
  onApproved,
}: {
  /** Called with the approved page's slug so the caller can offer a link. */
  onApproved?: (slug: string) => void;
}) {
  const { proposals, refresh } = useWikiProposals("pending");
  const { ownerToken } = useSettings();
  const isOwner = Boolean(ownerToken);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-muted-foreground">
          {proposals.length} pending {proposals.length === 1 ? "proposal" : "proposals"}
        </p>
      </div>
    );
  }

  const selected = proposals.find((p) => p.id === selectedId) ?? null;

  async function handleApprove(proposal: WikiProposal) {
    setBusy(true);
    setError(null);
    try {
      const page = await approveProposal(proposal.id);
      setSelectedId(null);
      refresh();
      onApproved?.(page.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve that proposal.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(proposal: WikiProposal) {
    setBusy(true);
    setError(null);
    try {
      await rejectProposal(proposal.id);
      setSelectedId(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reject that proposal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Proposals</h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending proposals.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {proposals.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setSelectedId(p.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent"
              >
                <span className="truncate font-medium">{p.title}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {p.page_id === null ? NEW_PAGE_LABEL : "update"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{selected.title}</span>
          </div>
          {selected.rationale && (
            <p className="text-xs text-muted-foreground">{selected.rationale}</p>
          )}
          <DiffViewer
            patch={hunksToPatch(
              diffToHunks(selected.current_content ?? "", selected.content),
              selected.page_id === null ? NEW_PAGE_LABEL : "current",
              "proposed",
            )}
            showIcon={false}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void handleApprove(selected)} disabled={busy}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleReject(selected)}
              disabled={busy}
            >
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pending-proposal count, for a small badge on the inbox's entry point.
 * Public (no owner check) — visitors get the same read-only count. */
export function usePendingProposalCount(): number {
  const { proposals } = useWikiProposals("pending");
  return proposals.length;
}
