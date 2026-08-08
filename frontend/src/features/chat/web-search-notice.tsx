import { useState } from "react";
import { Button } from "@/components/ui/button";
import { archiveWebResult } from "../knowledge/api";
import { loadSettings } from "../settings/settings-storage";
import type { WebSearchInfo } from "./api-adapter";

/** Shows what was searched, links each result, and lets the owner archive a
 * result as a document. Archiving persists the page so the citation stays
 * checkable; the returned footnote is for pasting into a wiki page.
 *
 * Links point at the live page, not the archived copy — following a citation
 * should reach the real source. */
export function WebSearchNotice({
  webSearch,
  notice,
}: {
  webSearch: WebSearchInfo | null;
  notice: string | null;
}) {
  const [footnote, setFootnote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const ownerToken = loadSettings().ownerToken;

  if (!webSearch && !notice) return null;

  const save = async (result: { url: string; title: string }) => {
    setSaving(result.url);
    setError(null);
    try {
      // No body is sent: the full page markdown lives server-side in the
      // search cache, and the backend recovers it by URL.
      const saved = await archiveWebResult({
        url: result.url,
        title: result.title,
      });
      setFootnote(saved.footnote);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Archiving failed.");
    } finally {
      // Always cleared, so a failed save stays retryable.
      setSaving(null);
    }
  };

  return (
    <div className="border-border bg-muted/40 my-2 rounded border p-2 text-xs">
      {notice && <p className="text-muted-foreground">{notice}</p>}
      {webSearch && (
        <>
          <p className="text-muted-foreground">
            Searched the web for “{webSearch.query}”
          </p>
          <ul className="mt-1 space-y-1">
            {webSearch.results.map((result) => (
              <li key={result.url} className="flex items-center gap-2">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground truncate underline-offset-2 hover:underline"
                >
                  {result.title}
                </a>
                {ownerToken && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px]"
                    disabled={saving === result.url}
                    onClick={() => save(result)}
                  >
                    {saving === result.url ? "Saving…" : "Save"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="text-destructive mt-1">{error}</p>}
      {footnote && (
        <pre className="bg-background mt-2 overflow-x-auto rounded p-2 text-[10px]">
          {footnote}
        </pre>
      )}
    </div>
  );
}
