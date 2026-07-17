from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import chat as chat_router
from app.routers import models as models_router


def configure(app: FastAPI) -> FastAPI:
    """Attach CORS, routers, and the health route to a FastAPI-compatible app.

    Shared by ``create_app`` (plain FastAPI, used locally and on Render) and the
    Space entrypoint (``gradio.Server``, a FastAPI subclass) so both expose the
    same API surface from one definition.
    """
    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(models_router.router)
    app.include_router(chat_router.router)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


def create_app() -> FastAPI:
    return configure(FastAPI(title="Knowledge Assistant API", version="0.1.0"))
