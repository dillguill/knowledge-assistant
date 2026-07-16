import { AppShell } from "@/app/shell";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { ChatPage } from "@/features/chat/chat-page";
import { ChatProvider } from "@/features/chat/chat-provider";
import { TopbarStatus } from "@/features/chat/topbar-status";

function App() {
  return (
    <ChatProvider>
      <AppShell threads={<ThreadList />} topbar={<TopbarStatus />}>
        <ChatPage />
      </AppShell>
    </ChatProvider>
  );
}

export default App;
