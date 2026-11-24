import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { StepRailNode, type StepStatus } from "./step-rail";

/**
 * A chat tool call rendered as one node on the step rail, replacing the
 * expandable raw-payload block `ToolFallback` draws.
 *
 * The same treatment as the Skills run view, from a different source: there
 * the steps are `skill_run_steps` rows, here they are assistant-ui message
 * parts. Only this mapping differs, which is why `StepRailNode` is exported
 * separately from the data-driven `StepRail`.
 */

const TOOL_NAMES: Record<string, string> = {
  web_search: "Searched the web",
  fetch_url: "Read a page",
  site_map: "Mapped a site",
};

function statusOf(type?: string, reason?: string): StepStatus {
  if (type === "running") return "running";
  if (type === "requires-action") return "running";
  if (type === "incomplete") return reason === "cancelled" ? "pending" : "failed";
  return "succeeded";
}

/** The argument worth showing. A search's query is the whole point of the
 * call; dumping the full JSON is what made the old fallback unreadable. */
function summarizeArgs(argsText?: string): string | undefined {
  if (!argsText) return undefined;
  try {
    const args: unknown = JSON.parse(argsText);
    if (args && typeof args === "object") {
      const record = args as Record<string, unknown>;
      for (const key of ["query", "url", "topic", "q"]) {
        if (typeof record[key] === "string") return record[key] as string;
      }
    }
  } catch {
    // Model-authored text: malformed JSON is expected, never fatal.
  }
  return argsText.length > 120 ? `${argsText.slice(0, 120)}…` : argsText;
}

export const ToolStep: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  status,
}) => {
  const state = statusOf(status?.type, (status as { reason?: string })?.reason);
  return (
    <StepRailNode
      kind={`tool · ${toolName}`}
      name={TOOL_NAMES[toolName] ?? toolName}
      status={state}
      payload={summarizeArgs(argsText)}
      detail={
        state === "failed"
          ? "This tool call failed; the answer below may be less grounded."
          : undefined
      }
    />
  );
};
