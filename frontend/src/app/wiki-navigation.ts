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

export type WikiProposalsRequest = { token: number };
type ProposalsListener = (request: WikiProposalsRequest) => void;

let proposalsListener: ProposalsListener | null = null;
let proposalsCounter = 0;

/** Called when a finished skill run offers "Review proposal". Same pub/sub
 * pattern as `requestWikiPage` — the Skills page has no other way to reach the
 * wiki's proposals inbox without a router. */
export function requestWikiProposals(): void {
  proposalsCounter += 1;
  proposalsListener?.({ token: proposalsCounter });
}

/** Called once by `App.tsx`. Returns an unsubscribe function. */
export function onWikiProposalsRequest(fn: ProposalsListener): () => void {
  proposalsListener = fn;
  return () => {
    if (proposalsListener === fn) proposalsListener = null;
  };
}
