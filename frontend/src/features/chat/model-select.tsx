import type { ApiModel } from "./use-models";

export function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: ApiModel[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (models.length === 0) return null;
  return (
    <select
      aria-label="Model"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 max-w-56 truncate rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {value === null && <option value="">Default model</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
