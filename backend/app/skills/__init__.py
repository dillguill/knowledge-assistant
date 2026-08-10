"""Skills: what the harness runs. Control flow is Python; prompt bodies are
markdown loaded at import."""

from dataclasses import dataclass
from pathlib import Path
from string import Template
from typing import Any, Callable

from pydantic import BaseModel

from app.services.context_builder import RULES


@dataclass(frozen=True)
class Skill:
    name: str
    label: str
    description: str
    input_model: type[BaseModel]
    scheduler: Any
    estimated_calls: Callable[[dict], int]
    owner_only: bool = True


_registry: dict[str, Skill] = {}


def register(skill: Skill) -> None:
    if skill.name in _registry:
        raise ValueError(f"skill already registered: {skill.name}")
    _registry[skill.name] = skill


def get(name: str) -> Skill | None:
    return _registry.get(name)


def all() -> list[Skill]:
    return list(_registry.values())


def load_prompt(package_dir: str, name: str) -> str:
    """Prompt bodies live beside their skill as markdown, loaded at import.

    Tuning a prompt is then a .md edit with a readable diff and no Python
    touched — most of the 'editable content' benefit without committing to a
    declarative step vocabulary before three skills exist to derive one from.
    """
    return (Path(package_dir) / "prompts" / f"{name}.md").read_text(encoding="utf-8")


def render(template: str, **variables: object) -> str:
    """string.Template, not str.format: prompt bodies contain literal JSON
    examples, and every brace in them would be a format spec.

    ${GROUNDING} is always available and always the one canonical rule from
    context_builder — the same constant target_builder and the drafter reuse.

    `substitute`, not `safe_substitute`: a prompt referencing a variable nobody
    passes should fail on the first run, not ship a literal ${TOPIC} to a model.
    """
    return Template(template).substitute(GROUNDING=RULES, **variables)
