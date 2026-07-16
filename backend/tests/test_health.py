import httpx
import pytest

from app.main import create_app


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def client() -> httpx.AsyncClient:
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_health_returns_ok():
    async with await client() as c:
        resp = await c.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_cors_allows_pages_origin(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://dillguill.github.io")
    from app.config import get_settings

    get_settings.cache_clear()
    async with await client() as c:
        resp = await c.options(
            "/api/health",
            headers={
                "Origin": "https://dillguill.github.io",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert resp.status_code == 200
    assert (
        resp.headers["access-control-allow-origin"]
        == "https://dillguill.github.io"
    )
