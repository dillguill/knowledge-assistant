import { API_URL } from "@/features/chat/chat-provider";
import { loadSettings } from "@/features/settings/settings-storage";
import { parseSse } from "@/lib/sse";

export type SkillSummary = {
  name: string;
  label: string;
  description: string;
  input_schema: JsonSchema;
  estimated_calls: number;
  scheduler: string;
};

export type JsonSchema = {
  type?: string;
  title?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  description?: string;
};

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Run = {
  id: number;
  skill: string;
  scheduler: string;
  model: string | null;
  status: RunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type RunStep = {
  ordinal: number;
  name: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  status: "running" | "succeeded" | "failed";
  error: string | null;
};

export type RunEvent =
  | { type: "run-start"; run_id: number; skill: string }
  | {
      type: "step-start";
      name: string;
      ordinal: number;
    }
  | {
      type: "step-done";
      name: string;
      ordinal: number;
      status: "succeeded" | "failed";
      latency_ms?: number | null;
      tokens_in?: number | null;
      tokens_out?: number | null;
      error?: string | null;
    }
  | { type: "run-done"; run_id: number; output: Record<string, unknown> }
  | { type: "error"; code: string; message: string; retry_after?: number };

const base = () => API_URL ?? "";

function ownerHeaders(): Record<string, string> {
  const token = loadSettings().ownerToken;
  return token ? { "X-Owner-Token": token } : {};
}

/** Mirrors `features/knowledge/api.ts`'s `check`, plus the two states this API
 * has that the knowledge one doesn't: a concurrency conflict and a validation
 * failure. Both need to read as real states rather than "Request failed". */
async function check(res: Response): Promise<Response> {
  if (res.status === 401)
    throw new Error("Owner token required — set it in Settings.");
  if (res.status === 409 || res.status === 422 || res.status === 404) {
    const detail = await res
      .json()
      .then((b) => (typeof b?.detail === "string" ? b.detail : null))
      .catch(() => null);
    throw new Error(detail ?? `Request failed (${res.status}).`);
  }
  if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  return res;
}

export async function listSkills(): Promise<SkillSummary[]> {
  const res = await check(
    await fetch(`${base()}/api/skills`, { headers: ownerHeaders() }),
  );
  return (await res.json()).skills;
}

export async function startRun(
  skill: string,
  model: string | null,
  inputs: Record<string, unknown>,
): Promise<{ run_id: number; status: RunStatus }> {
  const res = await check(
    await fetch(`${base()}/api/skills/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ skill, model, inputs }),
    }),
  );
  return res.json();
}

export async function getRun(id: number): Promise<{ run: Run; steps: RunStep[] }> {
  const res = await check(
    await fetch(`${base()}/api/skills/runs/${id}`, { headers: ownerHeaders() }),
  );
  return res.json();
}

export async function listRuns(): Promise<Run[]> {
  const res = await check(
    await fetch(`${base()}/api/skills/runs`, { headers: ownerHeaders() }),
  );
  return (await res.json()).runs;
}

export async function cancelRun(id: number): Promise<void> {
  await check(
    await fetch(`${base()}/api/skills/runs/${id}/cancel`, {
      method: "POST",
      headers: ownerHeaders(),
    }),
  );
}

/** Follows a run's live view. `fetch` rather than `EventSource` because the
 * endpoint is owner-gated by header, which `EventSource` cannot send. */
export async function* streamRun(
  id: number,
  signal?: AbortSignal,
): AsyncGenerator<RunEvent> {
  const response = await fetch(`${base()}/api/skills/runs/${id}/stream`, {
    headers: ownerHeaders(),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Could not follow that run (${response.status}).`);
  }
  yield* parseSse<RunEvent>(response.body);
}
