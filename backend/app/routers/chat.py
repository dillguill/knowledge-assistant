import json
from typing import AsyncIterator, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services import openrouter

router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage] = Field(min_length=1)


def _event(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _sse(request: ChatRequest) -> AsyncIterator[str]:
    try:
        async for delta in openrouter.stream_chat(
            model=request.model,
            messages=[m.model_dump() for m in request.messages],
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
