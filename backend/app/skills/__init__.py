"""Skills: what the harness runs. Control flow is Python; prompt bodies are
markdown loaded at import."""

from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel


@dataclass(frozen=True)
class Skill:
    name: str
    label: str
    description: str
    input_model: type[BaseModel]
    scheduler: Any
    estimated_calls: Callable[[dict], int]
    owner_only: bool = True
