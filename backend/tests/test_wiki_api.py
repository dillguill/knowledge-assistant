import httpx
import pytest

from app.config import get_settings
from app.db import store, wiki_store
from app.main import create_app

OWNER = {"X-Owner-Token": "sekrit"}


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    yield
    get_settings.cache_clear()


def client() -> httpx.AsyncClient:
    app = create_app()
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    )


async def test_tree_roundtrip():
    async with client() as c:
        r = await c.get("/api/wiki/tree")
        assert r.status_code == 200
        assert r.json() == {"folders": [], "pages": []}

        folder = (await c.post(
            "/api/wiki/folders", json={"name": "Garage", "parent_id": None},
            headers=OWNER,
        )).json()
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": folder["id"],
                  "content": "torque 22 Nm"},
            headers=OWNER,
        )).json()

        r = await c.get("/api/wiki/tree")
        tree = r.json()
        assert [f["id"] for f in tree["folders"]] == [folder["id"]]
        assert [p["id"] for p in tree["pages"]] == [page["id"]]


async def test_writes_require_owner_but_reads_do_not():
    async with client() as c:
        assert (await c.post(
            "/api/wiki/folders", json={"name": "X", "parent_id": None}
        )).status_code == 401
        assert (await c.get("/api/wiki/tree")).status_code == 200
        assert (await c.get("/api/wiki/search?q=torque")).status_code == 200


async def test_duplicate_folder_name_is_409():
    async with client() as c:
        await c.post("/api/wiki/folders", json={"name": "Garage", "parent_id": None},
                     headers=OWNER)
        r = await c.post("/api/wiki/folders", json={"name": "Garage", "parent_id": None},
                         headers=OWNER)
        assert r.status_code == 409


async def test_delete_non_empty_folder_is_409():
    async with client() as c:
        folder = (await c.post(
            "/api/wiki/folders", json={"name": "Garage", "parent_id": None},
            headers=OWNER,
        )).json()
        await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": folder["id"], "content": "x"},
            headers=OWNER,
        )
        r = await c.delete(f"/api/wiki/folders/{folder['id']}", headers=OWNER)
        assert r.status_code == 409


async def test_delete_unknown_folder_is_404():
    async with client() as c:
        r = await c.delete("/api/wiki/folders/999", headers=OWNER)
        assert r.status_code == 404


async def test_folder_patch_rename_move_and_empty_noop():
    async with client() as c:
        parent = (await c.post(
            "/api/wiki/folders", json={"name": "Parent", "parent_id": None},
            headers=OWNER,
        )).json()
        folder = (await c.post(
            "/api/wiki/folders", json={"name": "Garage", "parent_id": None},
            headers=OWNER,
        )).json()

        r = await c.patch(f"/api/wiki/folders/{folder['id']}",
                          json={"name": "Workshop"}, headers=OWNER)
        assert r.status_code == 200
        assert r.json()["name"] == "Workshop"

        r = await c.patch(f"/api/wiki/folders/{folder['id']}",
                          json={"parent_id": parent["id"]}, headers=OWNER)
        assert r.status_code == 200
        assert r.json()["parent_id"] == parent["id"]

        r = await c.patch(f"/api/wiki/folders/{folder['id']}", json={}, headers=OWNER)
        assert r.status_code == 200
        assert r.json()["name"] == "Workshop"

        r = await c.patch("/api/wiki/folders/999", json={"name": "X"}, headers=OWNER)
        assert r.status_code == 404


async def test_page_put_creates_version():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "v1"},
            headers=OWNER,
        )).json()

        r = await c.put(
            f"/api/wiki/pages/{page['id']}",
            json={"content": "v2", "note": "updated torque"},
            headers=OWNER,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["content"] == "v2"
        assert body["last_version"]["author"] == "owner"
        assert body["last_version"]["note"] == "updated torque"

        r = await c.get(f"/api/wiki/pages/{page['id']}/versions")
        assert len(r.json()["versions"]) == 2

        r = await c.put("/api/wiki/pages/999", json={"content": "x"}, headers=OWNER)
        assert r.status_code == 404


async def test_page_patch_and_delete():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "v1"},
            headers=OWNER,
        )).json()

        r = await c.patch(f"/api/wiki/pages/{page['id']}",
                          json={"title": "Oil Change Guide"}, headers=OWNER)
        assert r.status_code == 200
        assert r.json()["title"] == "Oil Change Guide"

        r = await c.delete(f"/api/wiki/pages/{page['id']}", headers=OWNER)
        assert r.status_code == 204

        assert (await c.get(f"/api/wiki/pages/{page['id']}")).status_code == 404
        assert (await c.patch(f"/api/wiki/pages/{page['id']}",
                              json={"title": "X"}, headers=OWNER)).status_code == 404
        assert (await c.delete(f"/api/wiki/pages/{page['id']}",
                               headers=OWNER)).status_code == 404


async def test_restore_happy_path_and_wrong_page_404():
    async with client() as c:
        page_a = (await c.post(
            "/api/wiki/pages",
            json={"title": "Page A", "folder_id": None, "content": "a1"},
            headers=OWNER,
        )).json()
        page_b = (await c.post(
            "/api/wiki/pages",
            json={"title": "Page B", "folder_id": None, "content": "b1"},
            headers=OWNER,
        )).json()

        await c.put(f"/api/wiki/pages/{page_a['id']}",
                    json={"content": "a2"}, headers=OWNER)

        versions = (await c.get(
            f"/api/wiki/pages/{page_a['id']}/versions"
        )).json()["versions"]
        original_version_id = min(v["id"] for v in versions)

        r = await c.post(
            f"/api/wiki/pages/{page_a['id']}/restore/{original_version_id}",
            headers=OWNER,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["content"] == "a1"
        assert body["last_version"]["note"] == f"restored v{original_version_id}"

        # version exists, but belongs to page_a, not page_b
        r = await c.post(
            f"/api/wiki/pages/{page_b['id']}/restore/{original_version_id}",
            headers=OWNER,
        )
        assert r.status_code == 404

        r = await c.post(
            f"/api/wiki/pages/{page_a['id']}/restore/999", headers=OWNER
        )
        assert r.status_code == 404


async def test_search_endpoint():
    async with client() as c:
        await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None,
                  "content": "torque spec is 22 Nm"},
            headers=OWNER,
        )
        r = await c.get("/api/wiki/search?q=torque")
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) == 1
        assert results[0]["title"] == "Oil change"

        assert (await c.get("/api/wiki/search")).status_code == 422
        assert (await c.get("/api/wiki/search?q=")).status_code == 422


async def test_page_by_slug_and_404():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "x"},
            headers=OWNER,
        )).json()

        r = await c.get(f"/api/wiki/pages/by-slug/{page['slug']}")
        assert r.status_code == 200
        assert r.json()["id"] == page["id"]

        r = await c.get("/api/wiki/pages/by-slug/does-not-exist")
        assert r.status_code == 404


async def test_create_folder_with_unknown_parent_id_is_404():
    async with client() as c:
        r = await c.post(
            "/api/wiki/folders", json={"name": "Child", "parent_id": 9999},
            headers=OWNER,
        )
        assert r.status_code == 404


async def test_patch_folder_with_unknown_parent_id_is_404():
    async with client() as c:
        folder = (await c.post(
            "/api/wiki/folders", json={"name": "Garage", "parent_id": None},
            headers=OWNER,
        )).json()
        r = await c.patch(
            f"/api/wiki/folders/{folder['id']}",
            json={"parent_id": 9999},
            headers=OWNER,
        )
        assert r.status_code == 404


async def test_delete_folder_referenced_by_decided_proposal_succeeds_and_nulls_fk():
    # A decided (rejected/approved) proposal that references a folder must
    # not permanently block deletion of an otherwise-empty folder: the FK
    # is ON DELETE SET NULL, and the router also catches IntegrityError as
    # a belt-and-braces 409 rather than letting sqlite3 raise a 500.
    async with client() as c:
        folder = (await c.post(
            "/api/wiki/folders", json={"name": "Garage", "parent_id": None},
            headers=OWNER,
        )).json()

        proposal = (await c.post(
            "/api/wiki/proposals",
            json={"title": "New page", "folder_id": folder["id"], "content": "x"},
        )).json()

        await c.post(f"/api/wiki/proposals/{proposal['id']}/reject", headers=OWNER)

        r = await c.delete(f"/api/wiki/folders/{folder['id']}", headers=OWNER)
        assert r.status_code == 204

        proposals = (await c.get("/api/wiki/proposals")).json()["proposals"]
        reloaded = next(p for p in proposals if p["id"] == proposal["id"])
        assert reloaded["folder_id"] is None
        assert reloaded["status"] == "rejected"


async def test_duplicate_folder_name_still_409_after_parent_check():
    async with client() as c:
        parent = (await c.post(
            "/api/wiki/folders", json={"name": "Parent", "parent_id": None},
            headers=OWNER,
        )).json()
        await c.post(
            "/api/wiki/folders", json={"name": "Child", "parent_id": parent["id"]},
            headers=OWNER,
        )
        r = await c.post(
            "/api/wiki/folders", json={"name": "Child", "parent_id": parent["id"]},
            headers=OWNER,
        )
        assert r.status_code == 409
