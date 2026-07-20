import { Thread } from "@/components/assistant-ui/thread";
import { useBackend } from "./chat-provider";
import { TargetPanel } from "./target-panel";
import { useTargetSelection } from "./target-selection";

const BANNERS: Partial<Record<string, string>> = {
  demo: "Demo mode — replies are canned until a backend is configured. Nothing you type leaves this page.",
  waking:
    "The backend is waking from sleep (~30–60s). Messages will flow once it's online.",
  offline:
    "The backend isn't responding. Refresh to retry, or come back in a minute.",
};

export function ChatPage() {
  const status = useBackend();
  const banner = BANNERS[status];
  const { targetPageId } = useTargetSelection();
  return (
    <div className="flex h-full flex-col">
      {banner && (
        <p className="border-b border-border bg-accent px-4 py-1.5 text-center text-xs text-muted-foreground">
          {banner}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          <Thread />
        </div>
        {targetPageId !== null && <TargetPanel />}
      </div>
    </div>
  );
}
