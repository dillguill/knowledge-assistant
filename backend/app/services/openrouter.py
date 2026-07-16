import json
import time
from typing import Any, AsyncIterator

import httpx

from app.config import get_settings

_MODEL_CACHE_TTL_S = 300
_model_cache: tuple[float, list[dict[str, Any]]] | None = None


class UpstreamError(Exception):
    pass


class RateLimitedError(UpstreamError):
    pass


async def stream_chat(
    model: str | None, messages: list[dict[str, str]]
) -> "AsyncIterator[str]":
    """Proxy an OpenRouter streaming completion, yielding text deltas."""
    settings = get_settings()
    payload = {
        "model": model or settings.default_model,
        "messages": messages,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": "https://dillguill.github.io/knowledge-assistant/",
        "X-Title": "Knowledge Assistant",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15)) as client:
        async with client.stream(
            "POST",
            f"{settings.openrouter_base_url}/chat/completions",
            json=payload,
            headers=headers,
        ) as resp:
            if resp.status_code == 429:
                raise RateLimitedError("rate limited")
            if resp.status_code >= 400:
                raise UpstreamError(f"upstream status {resp.status_code}")
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[len("data: ") :]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = (
                    chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                )
                if delta:
                    yield delta


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
