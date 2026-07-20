/**
 * Cross-feature bridges so a chat slash-command (deep inside the composer) can
 * trigger a native create flow that lives in another view. Same module-level
 * pub/sub pattern as `wiki-navigation.ts` — there's no client-side router to
 * carry the intent, and prop-drilling it through every intermediate component
 * would be far heavier. `App.tsx` subscribes once, switches the active view,
 * and raises a one-shot flag the target page consumes.
 */
type Listener = () => void;

let newPageListener: Listener | null = null;
let newCollectionListener: Listener | null = null;

/** Called by the `/` "Create wiki page" command. */
export function requestNewWikiPage(): void {
  newPageListener?.();
}

export function onNewWikiPageRequest(fn: Listener): () => void {
  newPageListener = fn;
  return () => {
    if (newPageListener === fn) newPageListener = null;
  };
}

/** Called by the `/` "Create collection" command. */
export function requestNewCollection(): void {
  newCollectionListener?.();
}

export function onNewCollectionRequest(fn: Listener): () => void {
  newCollectionListener = fn;
  return () => {
    if (newCollectionListener === fn) newCollectionListener = null;
  };
}
