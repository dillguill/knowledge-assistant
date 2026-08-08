import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadSettings } from "../settings/settings-storage";
import { API_URL, useBackend, useModelSelection } from "./chat-provider";
import { useModels } from "./use-models";
import {
  loadWebSearchMode,
  setWebSearchMode,
  type WebSearchMode,
} from "./web-search-mode";

/** Web search is owner-gated in v0.5.0 (quota protection on a public chat
 * endpoint), so the control is absent entirely for visitors.
 *
 * `auto` needs native tool-calling. When the selected model doesn't advertise
 * it, the option is hidden and an armed `auto` falls back to `off` — never to
 * `on`, which would spend quota the user never asked for. */
export function WebSearchSelect({
  selectedModel,
  ownerToken,
}: {
  selectedModel: string | null;
  ownerToken: string;
}) {
  const models = useModels(API_URL);
  const [mode, setMode] = useState<WebSearchMode>(() => loadWebSearchMode());

  const supportsTools = Boolean(
    models
      .find((m) => m.id === selectedModel)
      ?.supported_parameters?.includes("tools"),
  );

  // The stored mode outlives the page, but the module ref the adapter reads
  // starts at "off" — sync it once on mount, or a persisted mode is silently
  // ignored until the user touches the control.
  useEffect(() => {
    setWebSearchMode(loadWebSearchMode());
  }, []);

  useEffect(() => {
    if (!supportsTools && loadWebSearchMode() === "auto") {
      setWebSearchMode("off");
      setMode("off");
    }
  }, [supportsTools]);

  if (!ownerToken) return null;

  const change = (next: string) => {
    const value = next as WebSearchMode;
    setWebSearchMode(value);
    setMode(value);
  };

  return (
    <Select value={mode} onValueChange={change}>
      <SelectTrigger className="h-7 w-[130px] text-xs" aria-label="Web search">
        <SelectValue placeholder="Web search" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="off">Web: off</SelectItem>
        <SelectItem value="on">Web: on</SelectItem>
        {supportsTools && <SelectItem value="auto">Web: auto</SelectItem>}
      </SelectContent>
    </Select>
  );
}

/** Composer-mounted wrapper: reads the selected model and owner token from
 * app state, so the control itself stays a pure, testable component. */
export function ComposerWebSearchSelect() {
  const status = useBackend();
  const { model } = useModelSelection();
  if (status !== "online") return null;
  return (
    <WebSearchSelect
      selectedModel={model}
      ownerToken={loadSettings().ownerToken ?? ""}
    />
  );
}
