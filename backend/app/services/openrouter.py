import json
import logging
import time
from typing import Any, AsyncIterator

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

_MODEL_CACHE_TTL_S = 300
_model_cache: tuple[float, list[dict[str, Any]]] | None = None


class UpstreamError(Exception):
    pass


class RateLimitedError(UpstreamError):
    """A 429. `detail` carries the provider's own reason.

    "Wait a minute", "the daily free allowance is spent", and "this model is
    busy" are different instructions to give a user, and OpenRouter says which
    one applies — discarding it leaves the failure undiagnosable.
    """

    def __init__(self, retry_after: int | None = None, detail: str = ""):
        super().__init__(f"rate limited: {detail}" if detail else "rate limited")
        self.retry_after = retry_after
        self.detail = detail


class ModelGoneError(UpstreamError):
    def __init__(self, model: str):
        super().__init__(f"model unavailable: {model}")
        self.model = model



def _rate_limit_detail(body: object) -> str:
    """Pull the provider's reason out of a 429 body. Never raises: a 429 with
    an HTML body is still a 429."""
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        if isinstance(error, str):
            return error
        if isinstance(body.get("message"), str):
            return body["message"]
    return ""


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
                header = resp.headers.get("Retry-After", "")
                await resp.aread()
                try:
                    detail = _rate_limit_detail(resp.json())
                except ValueError:
                    detail = ""
                log.warning("openrouter 429 (stream): %s", detail or "no detail")
                raise RateLimitedError(
                    int(header) if header.isdigit() else None, detail
                )
            if resp.status_code == 404:
                raise ModelGoneError(payload["model"])
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


async def _post_completion_body(payload: dict) -> dict:
    """POST a chat-completion payload to OpenRouter and return the full decoded
    body. Owns the headers, timeout, and the status-code ladder shared by every
    caller."""
    settings = get_settings()
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "HTTP-Referer": "https://dillguill.github.io/knowledge-assistant/",
        "X-Title": "Knowledge Assistant",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15)) as client:
            resp = await client.post(
                f"{settings.openrouter_base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
    except httpx.HTTPError as exc:
        raise UpstreamError(f"transport error: {exc}") from exc
    if resp.status_code == 429:
        header = resp.headers.get("Retry-After", "")
        try:
            detail = _rate_limit_detail(resp.json())
        except ValueError:
            detail = ""
        log.warning("openrouter 429: %s", detail or "no detail")
        raise RateLimitedError(int(header) if header.isdigit() else None, detail)
    if resp.status_code == 404:
        raise ModelGoneError(payload["model"])
    if resp.status_code >= 400:
        raise UpstreamError(f"upstream status {resp.status_code}")
    try:
        # A 200 carrying a non-JSON body is just as malformed as a missing key,
        # and must not escape as a raw decode error mid-stream.
        body = resp.json()
    except ValueError as exc:
        raise UpstreamError("malformed completion response") from exc
    if not isinstance(body, dict):
        raise UpstreamError("malformed completion response")
    return body


def _message_of(body: dict) -> dict:
    try:
        return body["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise UpstreamError("malformed completion response") from exc


async def _post_completion(payload: dict) -> dict:
    """The assistant message alone — what `complete`/`complete_with_tools` need."""
    return _message_of(await _post_completion_body(payload))


async def complete_message(
    model: str | None,
    messages: list[dict],
    *,
    tools: list[dict] | None = None,
    response_format: dict | None = None,
) -> tuple[dict, dict]:
    """One completion, returning the assistant message AND the usage block.

    The harness records tokens per step, so discarding usage the way `complete`
    does would leave every step row half empty.
    """
    settings = get_settings()
    payload: dict = {
        "model": model or settings.default_model,
        "messages": messages,
        "stream": False,
    }
    # Omitted rather than sent as null: some providers 400 on a null
    # response_format instead of ignoring it.
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if response_format:
        payload["response_format"] = response_format
    body = await _post_completion_body(payload)
    usage = body.get("usage")
    return _message_of(body), usage if isinstance(usage, dict) else {}


async def complete(model: str | None, messages: list[dict[str, str]]) -> str:
    """Run a single non-streaming OpenRouter chat completion, returning the text."""
    settings = get_settings()
    payload = {
        "model": model or settings.default_model,
        "messages": messages,
        "stream": False,
    }
    message = await _post_completion(payload)
    try:
        return message["content"]
    except (KeyError, TypeError) as exc:
        raise UpstreamError("malformed completion response") from exc


async def complete_with_tools(
    model: str | None,
    messages: list[dict],
    tools: list[dict],
) -> dict:
    """One non-streaming completion offering `tools`, returning the raw assistant
    message dict. The caller inspects `tool_calls` to decide whether a tool ran."""
    settings = get_settings()
    payload = {
        "model": model or settings.default_model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "stream": False,
    }
    return await _post_completion(payload)


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
            "supported_parameters": m.get("supported_parameters") or [],
        }
        for m in resp.json().get("data", [])
        if m["id"].endswith(":free")
    ]
    models.sort(key=lambda m: m["name"].lower())
    _model_cache = (now, models)
    return models
