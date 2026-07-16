import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useLocalRuntime,
} from "@assistant-ui/react";
import { createApiAdapter } from "./api-adapter";
import { demoAdapter } from "./demo-adapter";
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

export function ChatProvider({ children }: { children: ReactNode }) {
  const status = useBackendStatus(API_URL);
  const [model, setModel] = useState<string | null>(null);
  const modelRef = useRef<string | null>(null);
  modelRef.current = model;

  const adapter = useMemo(
    () =>
      API_URL ? createApiAdapter(API_URL, () => modelRef.current) : demoAdapter,
    [],
  );

  const runtime = useLocalRuntime(adapter, {
    adapters: {
      attachments: new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
      ]),
    },
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
