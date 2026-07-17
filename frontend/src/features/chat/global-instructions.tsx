import { useAssistantInstructions } from "@assistant-ui/react";
import { useSettings } from "@/features/settings/settings-provider";

function Instructions({ prompt }: { prompt: string }) {
  useAssistantInstructions(prompt);
  return null;
}

/** Registers the global system prompt with the runtime's model context. */
export function GlobalInstructions() {
  const { systemPrompt } = useSettings();
  if (!systemPrompt?.trim()) return null;
  return <Instructions prompt={systemPrompt} />;
}
