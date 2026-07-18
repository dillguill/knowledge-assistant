import httpx
import pytest
from fastapi import Depends, FastAPI

from app.auth import require_owner
from app.config import get_settings


def app_with_gate() -> FastAPI:
    app = FastAPI()

    @app.post("/guarded", dependencies=[Depends(require_owner)])
    async def guarded() -> dict:
        return {"ok": True}

    return app


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_with_gate()), base_url="http://t"
    )


@pytest.fixture(autouse=True)
def owner_env(monkeypatch):
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_valid_token_passes():
    async with client() as c:
        r = await c.post("/guarded", headers={"X-Owner-Token": "sekrit"})
    assert r.status_code == 200


async def test_wrong_token_is_401():
    async with client() as c:
        r = await c.post("/guarded", headers={"X-Owner-Token": "nope"})
    assert r.status_code == 401


async def test_missing_token_is_401():
    async with client() as c:
        r = await c.post("/guarded")
    assert r.status_code == 401


async def test_unconfigured_owner_is_503(monkeypatch):
    monkeypatch.setenv("OWNER_TOKEN", "")
    get_settings.cache_clear()
    async with client() as c:
        r = await c.post("/guarded", headers={"X-Owner-Token": "sekrit"})
    assert r.status_code == 503
