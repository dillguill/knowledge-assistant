import { createContext, useContext, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { createLocalStorageAdapter } from "@assistant-ui/core/react";
import { createApiAdapter } from "./api-adapter";
import { demoAdapter } from "./demo-adapter";
import { browserThreadStorage, STORAGE_PREFIX } from "./thread-storage";
import { useBackendStatus, type BackendStatus } from "./use-backend-status";

/** Backend base URL; unset (local dev without a backend) falls back to demo mode. */
export const API_URL: string | null =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  null;

const ModelContext = createContext<{
  model: string | null;
  setModel: (id: string | null) => void;
}>({ model: null, setModel: () => {} });

export function useModelSelection() {
  return useContext(ModelContext);
}

const StatusContext = createContext<BackendStatus>("demo");

export function useBackend() {
  return useContext(StatusContext);
}

const modelRef = { current: null as string | null };

const chatAdapter = API_URL
  ? createApiAdapter(API_URL, () => modelRef.current)
  : demoAdapter;

const attachments = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new SimpleTextAttachmentAdapter(),
]);

const threadListAdapter = createLocalStorageAdapter({
  storage: browserThreadStorage,
  prefix: STORAGE_PREFIX,
});

function useChatThreadRuntime() {
  return useLocalRuntime(chatAdapter, { adapters: { attachments } });
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const status = useBackendStatus(API_URL);
  const [model, setModelState] = useState<string | null>(null);
  const setModel = (id: string | null) => {
    modelRef.current = id;
    setModelState(id);
  };

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatThreadRuntime,
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <StatusContext.Provider value={status}>
        <ModelContext.Provider value={{ model, setModel }}>
          {children}
        </ModelContext.Provider>
      </StatusContext.Provider>
    </AssistantRuntimeProvider>
  );
}
