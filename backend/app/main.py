from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import store, wiki_store
from app.routers import chat as chat_router
from app.routers import knowledge as knowledge_router
from app.routers import models as models_router
from app.routers import wiki as wiki_router
from app.services import sync
from app.services.corpus import seed_demo_corpus
from app.services.wiki_seed import seed_wiki


def _startup() -> None:
    """Idempotent startup work shared by both entrypoints.

    Runs the DB migrations before any request is served. ``create_app`` invokes
    it from a FastAPI lifespan (so ASGITransport tests, which skip lifespan, can
    call ``store.init_db`` themselves), while the Space entrypoint calls it
    directly at module import.
    """
    settings = get_settings()
    store.init_db(settings.data_dir)
    sync.pull()
    wiki_store.init_wiki(settings.data_dir)
    seed_demo_corpus()
    seed_wiki()


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
    app.include_router(knowledge_router.router)
    app.include_router(knowledge_router.attachments_router)
    app.include_router(wiki_router.router)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        _startup()
        yield

    return configure(
        FastAPI(title="Knowledge Assistant API", version="0.3.0",
                lifespan=lifespan)
    )
