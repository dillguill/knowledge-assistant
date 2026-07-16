from fastapi import APIRouter, HTTPException

from app.services import openrouter

router = APIRouter()


@router.get("/api/models")
async def get_models() -> dict[str, list[dict[str, object]]]:
    try:
        models = await openrouter.list_free_models()
    except openrouter.UpstreamError:
        raise HTTPException(
            status_code=502,
            detail={"code": "upstream_error", "message": "OpenRouter is unavailable"},
        )
    return {"models": models}
