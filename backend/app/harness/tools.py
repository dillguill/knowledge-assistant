"""Tool registry: names, schemas, handlers, and owner gating.

Registration is explicit rather than decorator-magic — the set of callable
tools should be readable in one place, not assembled as a side effect of
imports.
"""

import inspect
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

log = logging.getLogger(__name__)

Handler = Callable[..., Awaitable[dict]]


def ok(data: Any) -> dict:
    return {"ok": True, "data": data}


def err(code: str, message: str) -> dict:
    return {"ok": False, "error": {"code": code, "message": message}}


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict = field(default_factory=dict)
    handler: Handler | None = None
    owner_only: bool = False

    def definition(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def definitions(self, *, owner: bool) -> list[dict]:
        """Advisory half of the owner gate: a visitor's model never learns an
        owner-only tool exists. `dispatch` is the authoritative half."""
        return [
            t.definition()
            for t in self._tools.values()
            if owner or not t.owner_only
        ]

    async def dispatch(self, name: str, arguments: dict, *, owner: bool) -> dict:
        """Call a tool by name. NEVER raises: every failure mode comes back as
        a typed error the model can see and continue past."""
        tool = self._tools.get(name)
        if tool is None:
            return err("unknown_tool", f"No tool named {name}.")
        if tool.owner_only and not owner:
            return err("not_permitted", f"{name} requires owner access.")
        if tool.handler is None:
            return err("tool_error", f"{name} has no handler.")
        if not isinstance(arguments, dict):
            return err("bad_arguments", "Tool arguments must be an object.")
        try:
            inspect.signature(tool.handler).bind(**arguments)
        except TypeError as exc:
            return err("bad_arguments", str(exc))
        try:
            return await tool.handler(**arguments)
        except Exception as exc:  # a handler bug must not fail the whole run
            log.warning("tool %s raised: %s", name, exc)
            return err("tool_error", str(exc))
