import { useMemo } from "react";
import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import type { ApiModel } from "./use-models";

/** Sentinel `value` for the "no override" choice — mapped back to `null` at the
 * boundary so callers keep working in terms of `string | null`. */
const DEFAULT_ID = "__default__";

function providerFromId(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : "other";
}

function modelLabel(id: string, name: string): string {
  const slash = id.indexOf("/");
  if (slash > 0) return id.slice(slash + 1).replace(/:free$/, "");
  return name;
}

/** `context_length` is a token count, not bytes — show it as K/M tokens. */
function formatCtx(ctx: number): string {
  return ctx >= 1_000_000
    ? `${(ctx / 1_000_000).toFixed(1)}M ctx`
    : `${Math.round(ctx / 1000)}K ctx`;
}

export function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: ApiModel[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { allOptions, defaultOption, groups } = useMemo(() => {
    const defaultOption: ModelOption = {
      id: DEFAULT_ID,
      name: "Default model",
      keywords: ["default"],
    };
    const grouped = new Map<string, ModelOption[]>();
    for (const m of models) {
      const provider = providerFromId(m.id);
      const option: ModelOption = {
        id: m.id,
        name: modelLabel(m.id, m.name),
        ...(m.context_length
          ? { description: formatCtx(m.context_length) }
          : {}),
        keywords: [m.name, m.id, provider],
      };
      const arr = grouped.get(provider) ?? [];
      arr.push(option);
      grouped.set(provider, arr);
    }
    const groups = [...grouped.entries()];
    const allOptions = [defaultOption, ...groups.flatMap(([, items]) => items)];
    return { allOptions, defaultOption, groups };
  }, [models]);

  if (models.length === 0) return null;

  return (
    <ModelSelector.Root
      models={allOptions}
      value={value ?? DEFAULT_ID}
      onValueChange={(v) => onChange(v === DEFAULT_ID ? null : v)}
    >
      <ModelSelector.Trigger variant="outline" size="sm" className="max-w-44" />
      <ModelSelector.Content searchable align="start">
        <ModelSelector.Search />
        <ModelSelector.List>
          <ModelSelector.Empty />
          <ModelSelector.Group>
            <ModelSelector.Item model={defaultOption} />
          </ModelSelector.Group>
          {groups.map(([provider, items]) => (
            <ModelSelector.Group key={provider} heading={provider}>
              {items.map((m) => (
                <ModelSelector.Item key={m.id} model={m} />
              ))}
            </ModelSelector.Group>
          ))}
        </ModelSelector.List>
      </ModelSelector.Content>
    </ModelSelector.Root>
  );
}
