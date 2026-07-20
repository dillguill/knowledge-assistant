import { useEffect, useState } from "react";
import { AppShell } from "@/app/shell";
import { onChatViewRequest } from "@/app/chat-navigation";
import { onWikiNavigationRequest } from "@/app/wiki-navigation";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatPage } from "@/features/chat/chat-page";
import { ChatProvider } from "@/features/chat/chat-provider";
import { TopbarStatus } from "@/features/chat/topbar-status";
import { DocumentsPage } from "@/features/knowledge/documents-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { SettingsProvider } from "@/features/settings/settings-provider";
import { WikiPage } from "@/features/wiki/wiki-page";

type View = "chat" | "settings" | "documents" | "wiki";
const TITLES: Record<View, string> = {
  chat: "Chat",
  settings: "Settings",
  documents: "Documents",
  wiki: "Wiki",
};

function App() {
  const [view, setView] = useState<View>("chat");
  const [wikiOpenSlug, setWikiOpenSlug] = useState<string | null>(null);

  useEffect(
    () =>
      onWikiNavigationRequest(({ slug }) => {
        setView("wiki");
        setWikiOpenSlug(slug);
      }),
    [],
  );

  useEffect(() => onChatViewRequest(() => setView("chat")), []);

  return (
    <SettingsProvider>
      {/* assistant-ui's attachment tiles render a raw Radix Tooltip, so the app
          must mount a TooltipProvider at the root. */}
      <TooltipProvider>
        <ChatProvider>
          <AppShell
            threads={<ThreadList />}
            topbar={<TopbarStatus />}
            title={TITLES[view]}
            active={view}
            onNavigate={(id) => {
              if (
                id === "chat" ||
                id === "settings" ||
                id === "documents" ||
                id === "wiki"
              )
                setView(id);
            }}
          >
            {/* chat stays mounted so runtime and thread state survive view switches */}
            <div className="h-full" hidden={view !== "chat"}>
              <ChatPage />
            </div>
            {view === "settings" && <SettingsPage />}
            {view === "documents" && <DocumentsPage />}
            {view === "wiki" && (
              <WikiPage
                openSlug={wikiOpenSlug}
                onOpened={() => setWikiOpenSlug(null)}
              />
            )}
          </AppShell>
        </ChatProvider>
      </TooltipProvider>
    </SettingsProvider>
  );
}

export default App;
