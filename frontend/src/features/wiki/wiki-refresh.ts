/**
 * A single "wiki data changed" broadcast. Every `useWikiTree` / `useWikiPage` /
 * `useWikiProposals` / `useWikiVersions` is an independent fetch with its own
 * state (there's no shared client cache), so a write triggered in one component
 * used to leave every other copy stale until a full page reload — the folder
 * grid kept an old title after a rename, a freshly-created page didn't appear,
 * an approved proposal didn't update the open page, etc.
 *
 * Instead of introducing a data-fetching library, the wiki hooks subscribe to
 * this tiny emitter and any successful mutation (see `api.ts`) calls
 * `bumpWikiData()`, so all mounted wiki views refetch together. Same module-
 * level pub/sub pattern already used for target-panel refreshes.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Broadcast that wiki data changed — every subscribed hook refetches. */
export function bumpWikiData(): void {
  for (const listener of listeners) listener();
}

/** Subscribe a refetch callback; returns an unsubscribe function. */
export function onWikiDataChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
