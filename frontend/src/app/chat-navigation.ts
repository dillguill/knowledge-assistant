type Listener = () => void;

let listener: Listener | null = null;

export function requestChatView(): void {
  listener?.();
}

export function onChatViewRequest(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
