import httpx
import pytest

from app.config import get_settings
from app.db import store
from app.main import create_app

OWNER = {"X-Owner-Token": "sekrit"}


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    yield
    get_settings.cache_clear()


def client() -> httpx.AsyncClient:
    app = create_app()
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    )


async def test_collection_crud_and_upload_roundtrip():
    async with client() as c:
        r = await c.post("/api/knowledge/collections",
                         json={"name": "Garage"}, headers=OWNER)
        assert r.status_code == 201
        col = r.json()

        r = await c.post(
            f"/api/knowledge/collections/{col['id']}/files",
            files={"file": ("notes.md", b"# torque 22 Nm", "text/markdown")},
            headers=OWNER,
        )
        assert r.status_code == 201
        doc = r.json()
        assert doc["filename"] == "notes.md"

        r = await c.get(f"/api/knowledge/collections/{col['id']}/files")
        assert [f["id"] for f in r.json()["files"]] == [doc["id"]]

        r = await c.get(f"/api/knowledge/files/{doc['id']}/raw")
        assert r.status_code == 200
        assert r.content == b"# torque 22 Nm"

        r = await c.get("/api/knowledge/collections")
        assert r.json()["collections"][0]["file_count"] == 1


async def test_uploads_require_owner_but_reads_do_not():
    async with client() as c:
        assert (await c.post("/api/knowledge/collections",
                             json={"name": "X"})).status_code == 401
        assert (await c.get("/api/knowledge/collections")).status_code == 200


async def test_unsupported_upload_is_415():
    async with client() as c:
        col = (await c.post("/api/knowledge/collections",
                            json={"name": "X"}, headers=OWNER)).json()
        r = await c.post(
            f"/api/knowledge/collections/{col['id']}/files",
            files={"file": ("x.exe", b"\x00", "application/octet-stream")},
            headers=OWNER,
        )
        assert r.status_code == 415


async def test_unknown_collection_and_file_are_404():
    async with client() as c:
        r = await c.post("/api/knowledge/collections/999/files",
                         files={"file": ("a.txt", b"a", "text/plain")},
                         headers=OWNER)
        assert r.status_code == 404
        assert (await c.get("/api/knowledge/files/999/raw")).status_code == 404
