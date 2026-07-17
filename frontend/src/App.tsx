import { useState } from "react";
import { AppShell } from "@/app/shell";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { ChatPage } from "@/features/chat/chat-page";
import { ChatProvider } from "@/features/chat/chat-provider";
import { TopbarStatus } from "@/features/chat/topbar-status";
import { SettingsPage } from "@/features/settings/settings-page";
import { SettingsProvider } from "@/features/settings/settings-provider";

type View = "chat" | "settings";
const TITLES: Record<View, string> = { chat: "Chat", settings: "Settings" };

function App() {
  const [view, setView] = useState<View>("chat");
  return (
    <SettingsProvider>
      <ChatProvider>
        <AppShell
          threads={<ThreadList />}
          topbar={<TopbarStatus />}
          title={TITLES[view]}
          active={view}
          onNavigate={(id) => {
            if (id === "chat" || id === "settings") setView(id);
          }}
        >
          {/* chat stays mounted so runtime and thread state survive view switches */}
          <div className="h-full" hidden={view !== "chat"}>
            <ChatPage />
          </div>
          {view === "settings" && <SettingsPage />}
        </AppShell>
      </ChatProvider>
    </SettingsProvider>
  );
}

export default App;
