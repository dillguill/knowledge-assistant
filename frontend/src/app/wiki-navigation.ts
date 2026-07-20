/**
 * Cross-feature bridge so a chat citation chip (deep inside the assistant-ui
 * message tree) can jump to a specific wiki page. There is no client-side
 * router in this app (`App.tsx` just holds a `useState<View>`, and
 * `WikiPage` holds its own independent folder/page route state) — piping a
 * "go to wiki page X" request all the way from chat to both of those would
 * mean prop-drilling through every intermediate component. A tiny
 * module-level pub/sub (the same pattern already used for `modelRef`/
 * `sourceRef` in `chat-provider.tsx`/`source-selection.tsx`) is the minimal
 * fix: `App.tsx` subscribes once and reacts by switching the active view and
 * telling `WikiPage` which slug to open.
 */

export type WikiNavigationRequest = { slug: string; token: number };
type Listener = (request: WikiNavigationRequest) => void;

let listener: Listener | null = null;
let counter = 0;

/** Called by a wiki citation chip when clicked. */
export function requestWikiPage(slug: string): void {
  counter += 1;
  listener?.({ slug, token: counter });
}

/** Called once by `App.tsx` to receive navigation requests. Returns an
 * unsubscribe function. */
export function onWikiNavigationRequest(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
