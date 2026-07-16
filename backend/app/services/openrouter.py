import time
from typing import Any

import httpx

from app.config import get_settings

_MODEL_CACHE_TTL_S = 300
_model_cache: tuple[float, list[dict[str, Any]]] | None = None


class UpstreamError(Exception):
    pass


def clear_model_cache() -> None:
    global _model_cache
    _model_cache = None


async def list_free_models() -> list[dict[str, Any]]:
    global _model_cache
    now = time.monotonic()
    if _model_cache is not None and now - _model_cache[0] < _MODEL_CACHE_TTL_S:
        return _model_cache[1]

    settings = get_settings()
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{settings.openrouter_base_url}/models")
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise UpstreamError(str(exc)) from exc

    models = [
        {
            "id": m["id"],
            "name": m.get("name", m["id"]),
            "context_length": m.get("context_length"),
        }
        for m in resp.json().get("data", [])
        if m["id"].endswith(":free")
    ]
    models.sort(key=lambda m: m["name"].lower())
    _model_cache = (now, models)
    return models
