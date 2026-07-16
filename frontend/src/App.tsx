import { AppShell } from "@/app/shell";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { ChatPage } from "@/features/chat/chat-page";
import { ChatProvider } from "@/features/chat/chat-provider";

function App() {
  return (
    <ChatProvider>
      <AppShell threads={<ThreadList />}>
        <ChatPage />
      </AppShell>
    </ChatProvider>
  );
}

export default App;
