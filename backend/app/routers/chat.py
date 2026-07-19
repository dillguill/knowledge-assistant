import json
from typing import AsyncIterator, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services import openrouter
from app.services.context_builder import build_source_context
from app.services.target_builder import build_target_context

router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage] = Field(min_length=1)
    collection_ids: list[int] = []
    attachment_ids: list[int] = []
    wiki_page_ids: list[int] = []
    target_page_id: int | None = None


def _event(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _sse(request: ChatRequest) -> AsyncIterator[str]:
    messages = [m.model_dump() for m in request.messages]

    target_inserted = False
    if request.target_page_id is not None:
        try:
            target_block, target = build_target_context(request.target_page_id)
        except KeyError:
            yield _event(
                {
                    "type": "error",
                    "code": "unknown_target",
                    "message": "Target page not found.",
                }
            )
            yield "data: [DONE]\n\n"
            return
        yield _event({"type": "target", "target": target})
        messages.insert(0, {"role": "system", "content": target_block})
        target_inserted = True

    if request.collection_ids or request.attachment_ids or request.wiki_page_ids:
        block, sources = build_source_context(
            request.collection_ids,
            request.attachment_ids,
            request.wiki_page_ids,
            get_settings().context_char_budget,
        )
        if sources:
            yield _event({"type": "sources", "sources": sources})
            messages.insert(
                1 if target_inserted else 0, {"role": "system", "content": block}
            )
    try:
        async for delta in openrouter.stream_chat(
            model=request.model,
            messages=messages,
        ):
            yield _event({"type": "text-delta", "text": delta})
    except openrouter.RateLimitedError as exc:
        event: dict = {
            "type": "error",
            "code": "rate_limited",
            "message": "Free-tier rate limit hit — wait a moment and retry.",
        }
        if exc.retry_after is not None:
            event["retry_after"] = exc.retry_after
        yield _event(event)
    except openrouter.ModelGoneError as exc:
        yield _event(
            {
                "type": "error",
                "code": "model_gone",
                "message": f"The model {exc.model} is no longer available.",
            }
        )
    except openrouter.UpstreamError:
        yield _event(
            {
                "type": "error",
                "code": "upstream_error",
                "message": "The model provider is unavailable.",
            }
        )
    yield "data: [DONE]\n\n"


@router.post("/api/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        _sse(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
