import { useEffect, useState } from "react";

export type BackendStatus = "demo" | "waking" | "online" | "offline";

const WAKE_POLL_MS = 5000;
const MAX_WAKE_MS = 180_000;

export function useBackendStatus(baseUrl: string | null): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>(baseUrl ? "waking" : "demo");

  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;
    const started = Date.now();

    const ping = async () => {
      try {
        const r = await fetch(`${baseUrl}/api/health`);
        if (cancelled) return;
        if (r.ok) {
          setStatus("online");
          return;
        }
        throw new Error(String(r.status));
      } catch {
        if (cancelled) return;
        if (Date.now() - started > MAX_WAKE_MS) {
          setStatus("offline");
        } else {
          setTimeout(ping, WAKE_POLL_MS);
        }
      }
    };
    void ping();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  return status;
}
