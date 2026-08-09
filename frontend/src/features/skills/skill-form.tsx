import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listCollections, type Collection } from "@/features/knowledge/api";
import type { JsonSchema, SkillSummary } from "./api";

/**
 * A form generated from a skill's input schema, so a new skill becomes
 * runnable with no frontend change.
 *
 * Deliberately NOT a general schema-driven form engine. It handles four field
 * kinds, and the id-list widgets are keyed by field *name* rather than by
 * schema shape — a real constraint, written down as one: two skills sharing a
 * concept must share the field name.
 */
const ID_LIST_FIELDS = new Set(["collection_ids", "wiki_page_ids"]);

type Values = Record<string, string | boolean | number[]>;

function humanize(name: string, schema: JsonSchema): string {
  if (schema.title) return schema.title;
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function initialValue(name: string, schema: JsonSchema): string | boolean | number[] {
  if (ID_LIST_FIELDS.has(name)) return [];
  if (schema.type === "boolean") return schema.default === true;
  return "";
}

export function SkillForm({
  skill,
  onSubmit,
  submitting,
}: {
  skill: SkillSummary;
  onSubmit: (inputs: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const properties = skill.input_schema.properties ?? {};
  const required = skill.input_schema.required ?? [];

  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(
      Object.entries(properties).map(([name, schema]) => [
        name,
        initialValue(name, schema),
      ]),
    ),
  );
  const [collections, setCollections] = useState<Collection[]>([]);
  const [error, setError] = useState<string | null>(null);

  const needsCollections = Object.keys(properties).includes("collection_ids");

  useEffect(() => {
    if (!needsCollections) return;
    // A picker that fails to load must not block the whole form.
    void listCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
  }, [needsCollections]);

  function toggleId(field: string, id: number) {
    setValues((prev) => {
      const current = (prev[field] as number[]) ?? [];
      return {
        ...prev,
        [field]: current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id],
      };
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const missing = required.filter((name) => {
      const value = values[name];
      return typeof value === "string" ? value.trim() === "" : false;
    });
    if (missing.length > 0) {
      setError(`${missing.map((m) => humanize(m, properties[m] ?? {})).join(", ")} is required.`);
      return;
    }
    setError(null);

    const inputs: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      if (Array.isArray(value)) {
        if (value.length > 0) inputs[name] = value;
      } else if (typeof value === "string") {
        const schema = properties[name];
        if (value.trim() === "") continue;
        inputs[name] =
          schema?.type === "integer" || schema?.type === "number"
            ? Number(value)
            : value;
      } else {
        inputs[name] = value;
      }
    }
    onSubmit(inputs);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {Object.entries(properties).map(([name, schema]) => {
        const label = humanize(name, schema);
        const fieldId = `skill-field-${name}`;

        if (ID_LIST_FIELDS.has(name)) {
          const options = name === "collection_ids" ? collections : [];
          if (options.length === 0) return null;
          const selected = (values[name] as number[]) ?? [];
          return (
            <fieldset key={name} className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{label}</legend>
              {options.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border"
                    checked={selected.includes(option.id)}
                    onChange={() => toggleId(name, option.id)}
                  />
                  {option.name}
                </label>
              ))}
            </fieldset>
          );
        }

        if (schema.type === "boolean") {
          return (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-border"
                checked={values[name] === true}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [name]: e.target.checked }))
                }
              />
              {label}
            </label>
          );
        }

        return (
          <div key={name} className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-sm font-medium">
              {label}
            </label>
            <Input
              id={fieldId}
              type={
                schema.type === "integer" || schema.type === "number"
                  ? "number"
                  : "text"
              }
              value={String(values[name] ?? "")}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [name]: e.target.value }))
              }
            />
            {schema.description && (
              <p className="text-xs text-muted-foreground">{schema.description}</p>
            )}
          </div>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Starting…" : "Run"}
        </Button>
        {/* The free allowance is 50 model calls a day, shared with chat — the
            price of a run belongs in front of the decision to start one. */}
        <span className="text-xs text-muted-foreground">
          ≈{skill.estimated_calls} model calls
        </span>
      </div>
    </form>
  );
}
