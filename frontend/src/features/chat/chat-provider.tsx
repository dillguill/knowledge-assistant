import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { createLocalStorageAdapter, createSimpleTitleAdapter } from "@assistant-ui/core/react";
import { loadSettings } from "@/features/settings/settings-storage";
import { createApiAdapter } from "./api-adapter";
import { BackendAttachmentAdapter } from "./backend-attachment-adapter";
import { demoAdapter } from "./demo-adapter";
import { GlobalInstructions } from "./global-instructions";
import { SourceSelectionProvider, sourceRef, wikiSourceRef } from "./source-selection";
import { CreatePageModeProvider, createPageModeRef } from "./create-page-mode";
import { bumpTargetRefresh, TargetSelectionProvider, targetRef } from "./target-selection";
import { browserThreadStorage, STORAGE_PREFIX, loadActiveThreadId, saveActiveThreadId } from "./thread-storage";
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
  ? createApiAdapter(
      API_URL,
      () => modelRef.current,
      () => ({
        collectionIds: sourceRef.current,
        attachmentIds: [],
        wikiPageIds: wikiSourceRef.current,
      }),
      () => targetRef.current,
      // Each turn in target mode re-confirms the pinned page; refresh the
      // panel so edits made elsewhere (or a just-approved proposal) show up.
      () => bumpTargetRefresh(),
      () => createPageModeRef.current,
    )
  : demoAdapter;

const attachments = API_URL
  ? new BackendAttachmentAdapter()
  : new CompositeAttachmentAdapter([
      new SimpleImageAttachmentAdapter(),
      new SimpleTextAttachmentAdapter(),
    ]);

const threadListAdapter = createLocalStorageAdapter({
  storage: browserThreadStorage,
  prefix: STORAGE_PREFIX,
  titleGenerator: createSimpleTitleAdapter(),
});

function useChatThreadRuntime() {
  return useLocalRuntime(chatAdapter, { adapters: { attachments } });
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const status = useBackendStatus(API_URL);
  const [model, setModelState] = useState<string | null>(() => {
    const stored = loadSettings().defaultModel;
    modelRef.current = stored;
    return stored;
  });
  const setModel = (id: string | null) => {
    modelRef.current = id;
    setModelState(id);
  };

  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(
    loadActiveThreadId,
  );

  const handleThreadIdChange = useCallback((threadId: string | undefined) => {
    saveActiveThreadId(threadId);
    setActiveThreadId(threadId);
  }, []);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatThreadRuntime,
    adapter: threadListAdapter,
    threadId: activeThreadId,
    onThreadIdChange: handleThreadIdChange,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <GlobalInstructions />
      <StatusContext.Provider value={status}>
        <ModelContext.Provider value={{ model, setModel }}>
          <SourceSelectionProvider>
            <CreatePageModeProvider>
              <TargetSelectionProvider>{children}</TargetSelectionProvider>
            </CreatePageModeProvider>
          </SourceSelectionProvider>
        </ModelContext.Provider>
      </StatusContext.Provider>
    </AssistantRuntimeProvider>
  );
}
