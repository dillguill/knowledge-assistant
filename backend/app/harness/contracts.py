"""What a step promises to hand downstream.

A contract is declared as a pydantic model rather than raw JSON Schema: the
model produces the provider-side `response_format` AND does the validation, so
the shape is declared once. pydantic is already a dependency; a JSON Schema
validator would not be.

Validation failure is not cosmetic. The pipeline has no mechanism to back up,
so an outline that slipped through malformed gets elaborated faithfully by
every step after it.
"""

import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

_FENCE = re.compile(r"```(?:json)?\s*\n(.*?)\n```", re.DOTALL)


class ContractError(Exception):
    """The completion did not satisfy the step's declared output contract."""


def _strictify(schema: dict) -> dict:
    """OpenRouter's strict json_schema mode requires every object to forbid
    extra properties and list every property as required. pydantic emits the
    first only when the model sets extra='forbid', and the second only for
    fields without defaults — so normalize both here rather than depending on
    every contract author remembering."""
    if not isinstance(schema, dict):
        return schema
    if schema.get("type") == "object":
        schema["additionalProperties"] = False
        properties = schema.get("properties") or {}
        if properties:
            schema["required"] = list(properties)
        for value in properties.values():
            _strictify(value)
    items = schema.get("items")
    if isinstance(items, dict):
        _strictify(items)
    for key in ("$defs", "definitions"):
        group = schema.get(key)
        if isinstance(group, dict):
            for sub in group.values():
                _strictify(sub)
    return schema


def _extract_json(raw: str) -> str:
    """Recover a JSON payload from a reply that ignored response_format.

    Two observed shapes: a fenced block, or a bare object/array with prose
    around it. Anything else is a genuine contract failure, not something to
    guess at.
    """
    fenced = _FENCE.search(raw)
    if fenced:
        return fenced.group(1).strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        start = raw.find(opener)
        end = raw.rfind(closer)
        if start != -1 and end > start:
            return raw[start : end + 1]
    return raw.strip()


@dataclass(frozen=True)
class TextContract:
    """Free text. Still a contract: an empty completion is a step failure, not
    a section of the brief that happens to be blank."""

    def response_format(self) -> None:
        return None

    def validate(self, raw: str) -> str:
        text = (raw or "").strip()
        if not text:
            raise ContractError("the model returned no text")
        return text


@dataclass(frozen=True)
class JsonContract:
    model: type[BaseModel]

    def response_format(self) -> dict:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": self.model.__name__.lower(),
                "strict": True,
                "schema": _strictify(self.model.model_json_schema()),
            },
        }

    def validate(self, raw: str) -> Any:
        payload = _extract_json(raw or "")
        if not payload:
            raise ContractError("the model returned no text")
        try:
            return self.model.model_validate_json(payload)
        except ValidationError as exc:
            raise ContractError(
                "; ".join(
                    f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}"
                    for e in exc.errors()
                )
            ) from exc
        except (ValueError, TypeError) as exc:
            raise ContractError(f"could not parse JSON: {exc}") from exc


def repair_message(error: str) -> dict:
    """The retry turn. Quoting the exact validation failure back is what makes
    a bounded retry worth spending a call on — a bare 'try again' usually
    reproduces the same malformed shape."""
    return {
        "role": "user",
        "content": (
            "Your previous reply did not satisfy the required output format: "
            f"{error}. Reply again with ONLY the corrected JSON, no prose and "
            "no code fence."
        ),
    }
