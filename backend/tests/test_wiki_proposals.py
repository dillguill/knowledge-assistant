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


async def test_create_proposal_for_existing_page_captures_base_version_id():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "v1"},
            headers=OWNER,
        )).json()
        versions = (await c.get(
            f"/api/wiki/pages/{page['id']}/versions"
        )).json()["versions"]
        base_version_id = versions[0]["id"]

        r = await c.post(
            "/api/wiki/proposals",
            json={
                "page_id": page["id"],
                "title": "Oil change",
                "content": "v2 proposed",
                "rationale": "clarify torque",
            },
        )
        assert r.status_code == 201
        body = r.json()
        assert body["page_id"] == page["id"]
        assert body["base_version_id"] == base_version_id
        assert body["status"] == "pending"


async def test_create_proposal_is_ungated_no_token_required():
    async with client() as c:
        r = await c.post(
            "/api/wiki/proposals",
            json={"title": "New page", "content": "hello"},
        )
        assert r.status_code == 201


async def test_create_proposal_unknown_page_id_is_404():
    async with client() as c:
        r = await c.post(
            "/api/wiki/proposals",
            json={"page_id": 9999, "title": "X", "content": "y"},
        )
        assert r.status_code == 404


async def test_create_proposal_unknown_folder_id_is_404():
    async with client() as c:
        r = await c.post(
            "/api/wiki/proposals",
            json={"title": "X", "folder_id": 9999, "content": "y"},
        )
        assert r.status_code == 404


async def test_pending_cap_returns_429_on_26th():
    async with client() as c:
        for i in range(25):
            r = await c.post(
                "/api/wiki/proposals",
                json={"title": f"Page {i}", "content": "x"},
            )
            assert r.status_code == 201
        r = await c.post(
            "/api/wiki/proposals",
            json={"title": "Page 26", "content": "x"},
        )
        assert r.status_code == 429
        assert r.json()["detail"] == "Proposal queue is full."


async def test_approve_existing_page_proposal_replaces_content_and_carries_citations():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "v1"},
            headers=OWNER,
        )).json()

        proposal = (await c.post(
            "/api/wiki/proposals",
            json={
                "page_id": page["id"],
                "title": "Oil change",
                "content": "v2 proposed",
                "rationale": "clarify torque",
                "citations": [{"source": "manual", "page": 3}],
            },
        )).json()

        r = await c.post(
            f"/api/wiki/proposals/{proposal['id']}/approve", headers=OWNER
        )
        assert r.status_code == 200
        body = r.json()
        assert body["content"] == "v2 proposed"
        assert body["last_version"]["author"] == "assistant"

        versions = (await c.get(
            f"/api/wiki/pages/{page['id']}/versions"
        )).json()["versions"]
        assert len(versions) == 2
        latest = versions[0]
        assert latest["author"] == "assistant"
        assert latest["citations"] == [{"source": "manual", "page": 3}]
        assert f"approved proposal #{proposal['id']}" in latest["note"]


async def test_approve_new_page_proposal_creates_page_with_assistant_author():
    async with client() as c:
        proposal = (await c.post(
            "/api/wiki/proposals",
            json={"title": "Brand New Page", "content": "fresh content"},
        )).json()
        assert proposal["page_id"] is None

        r = await c.post(
            f"/api/wiki/proposals/{proposal['id']}/approve", headers=OWNER
        )
        assert r.status_code == 200
        body = r.json()
        assert body["title"] == "Brand New Page"
        assert body["content"] == "fresh content"
        assert body["last_version"]["author"] == "assistant"

        r = await c.get(f"/api/wiki/pages/{body['id']}/versions")
        versions = r.json()["versions"]
        assert len(versions) == 1
        assert versions[0]["author"] == "assistant"


async def test_double_approve_is_409():
    async with client() as c:
        proposal = (await c.post(
            "/api/wiki/proposals",
            json={"title": "New page", "content": "hello"},
        )).json()

        r1 = await c.post(
            f"/api/wiki/proposals/{proposal['id']}/approve", headers=OWNER
        )
        assert r1.status_code == 200

        r2 = await c.post(
            f"/api/wiki/proposals/{proposal['id']}/approve", headers=OWNER
        )
        assert r2.status_code == 409


async def test_reject_marks_status_and_leaves_page_untouched():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "v1"},
            headers=OWNER,
        )).json()

        proposal = (await c.post(
            "/api/wiki/proposals",
            json={
                "page_id": page["id"],
                "title": "Oil change",
                "content": "v2 proposed",
            },
        )).json()

        r = await c.post(
            f"/api/wiki/proposals/{proposal['id']}/reject", headers=OWNER
        )
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"

        current_page = (await c.get(f"/api/wiki/pages/{page['id']}")).json()
        assert current_page["content"] == "v1"

        # rejecting again (non-pending) is 409
        r2 = await c.post(
            f"/api/wiki/proposals/{proposal['id']}/reject", headers=OWNER
        )
        assert r2.status_code == 409


async def test_approve_and_reject_require_owner_token():
    async with client() as c:
        proposal = (await c.post(
            "/api/wiki/proposals",
            json={"title": "New page", "content": "hello"},
        )).json()

        r = await c.post(f"/api/wiki/proposals/{proposal['id']}/approve")
        assert r.status_code == 401

        r = await c.post(f"/api/wiki/proposals/{proposal['id']}/reject")
        assert r.status_code == 401


async def test_deleting_target_page_cascades_its_proposal():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "v1"},
            headers=OWNER,
        )).json()

        proposal = (await c.post(
            "/api/wiki/proposals",
            json={
                "page_id": page["id"],
                "title": "Oil change",
                "content": "v2 proposed",
            },
        )).json()

        await c.delete(f"/api/wiki/pages/{page['id']}", headers=OWNER)

        r = await c.get("/api/wiki/proposals?status=pending")
        pending_ids = [p["id"] for p in r.json()["proposals"]]
        assert proposal["id"] not in pending_ids

        r = await c.post(
            f"/api/wiki/proposals/{proposal['id']}/approve", headers=OWNER
        )
        assert r.status_code == 404


async def test_list_proposals_filters_by_status_and_includes_current_content():
    async with client() as c:
        page = (await c.post(
            "/api/wiki/pages",
            json={"title": "Oil change", "folder_id": None, "content": "v1"},
            headers=OWNER,
        )).json()

        existing_proposal = (await c.post(
            "/api/wiki/proposals",
            json={
                "page_id": page["id"],
                "title": "Oil change",
                "content": "v2 proposed",
            },
        )).json()
        new_page_proposal = (await c.post(
            "/api/wiki/proposals",
            json={"title": "Brand New Page", "content": "fresh content"},
        )).json()

        r = await c.get("/api/wiki/proposals?status=pending")
        assert r.status_code == 200
        items = r.json()["proposals"]
        assert len(items) == 2
        by_id = {p["id"]: p for p in items}
        assert by_id[existing_proposal["id"]]["current_content"] == "v1"
        assert by_id[new_page_proposal["id"]]["current_content"] is None
        # newest-first
        assert items[0]["id"] == new_page_proposal["id"]

        await c.post(
            f"/api/wiki/proposals/{existing_proposal['id']}/approve", headers=OWNER
        )

        r = await c.get("/api/wiki/proposals?status=pending")
        pending_ids = [p["id"] for p in r.json()["proposals"]]
        assert existing_proposal["id"] not in pending_ids

        r = await c.get("/api/wiki/proposals?status=approved")
        approved_ids = [p["id"] for p in r.json()["proposals"]]
        assert existing_proposal["id"] in approved_ids


async def test_proposal_title_and_content_length_limits():
    async with client() as c:
        r = await c.post(
            "/api/wiki/proposals",
            json={"title": "", "content": "x"},
        )
        assert r.status_code == 422

        r = await c.post(
            "/api/wiki/proposals",
            json={"title": "x" * 201, "content": "y"},
        )
        assert r.status_code == 422

        r = await c.post(
            "/api/wiki/proposals",
            json={"title": "ok", "content": "x" * 200_001},
        )
        assert r.status_code == 422
