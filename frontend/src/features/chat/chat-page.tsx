import { Thread } from "@/components/assistant-ui/thread";

export function ChatPage() {
  return (
    <div className="flex h-full flex-col">
      <p className="border-b border-border bg-accent px-4 py-1.5 text-center text-xs text-muted-foreground">
        Demo mode — replies are canned until the backend Space is deployed.
        Nothing you type leaves this page.
      </p>
      <div className="min-h-0 flex-1">
        <Thread />
      </div>
    </div>
  );
}
