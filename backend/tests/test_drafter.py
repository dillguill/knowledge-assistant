import httpx
import respx

from app.config import get_settings
from app.db import store, wiki_store
from app.main import create_app

UPSTREAM = "https://openrouter.ai/api/v1/chat/completions"
OWNER = {"X-Owner-Token": "sekrit"}


def _completion(text: str) -> dict:
    return {"choices": [{"message": {"content": text}}]}


def client() -> httpx.AsyncClient:
    app = create_app()
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    )


async def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_TOKEN", "sekrit")
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))


@respx.mock
async def test_draft_happy_path_creates_proposal_with_citations_and_rationale(
    tmp_path, monkeypatch
):
    await env(tmp_path, monkeypatch)
    col = store.create_collection("Garage")
    doc = store.add_document(col["id"], "manual.txt", "text/plain",
                             "upload", b"x", "torque is 22 Nm")

    route = respx.post(UPSTREAM).respond(
        json=_completion(
            "Here you go:\n```wiki-update\n# Torque\ntorque is 22 Nm\n```\n"
        )
    )
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={
                "instruction": "Draft a torque spec page",
                "collection_ids": [col["id"]],
            },
            headers=OWNER,
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["content"] == "# Torque\ntorque is 22 Nm"
    assert body["rationale"] == "Draft a torque spec page"
    assert body["citations"] == [
        {"id": doc["id"], "label": "S1", "filename": "manual.txt", "kind": "document"}
    ]
    assert body["page_id"] is None
    assert body["title"] == "Draft a torque spec page"
    assert body["status"] == "pending"
    assert route.called
    get_settings.cache_clear()


@respx.mock
async def test_draft_page_id_variant_inherits_title_and_folder(tmp_path, monkeypatch):
    await env(tmp_path, monkeypatch)
    folder = wiki_store.create_folder("Garage", None)
    page = wiki_store.create_page(
        "Torque Specs", folder["id"], "torque is 22 Nm", "owner"
    )

    route = respx.post(UPSTREAM).respond(
        json=_completion("```wiki-update\ntorque is 26 Nm\n```")
    )
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={"instruction": "Update the torque value", "page_id": page["id"]},
            headers=OWNER,
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["page_id"] == page["id"]
    assert body["title"] == "Torque Specs"
    assert body["folder_id"] == folder["id"]
    assert body["content"] == "torque is 26 Nm"

    sent = route.calls[0].request.content
    assert b"torque is 22 Nm" in sent
    assert b"Torque Specs" in sent
    get_settings.cache_clear()


@respx.mock
async def test_draft_missing_fence_returns_502_and_creates_no_proposal(
    tmp_path, monkeypatch
):
    await env(tmp_path, monkeypatch)
    respx.post(UPSTREAM).respond(json=_completion("Sorry, I can't help with that."))
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={"instruction": "Draft a page"},
            headers=OWNER,
        )
    assert resp.status_code == 502
    assert "draft_failed" in str(resp.json()["detail"])

    async with client() as c:
        proposals = (await c.get("/api/wiki/proposals")).json()["proposals"]
    assert proposals == []
    get_settings.cache_clear()


@respx.mock
async def test_draft_opener_without_closing_fence_returns_502_and_creates_no_proposal(
    tmp_path, monkeypatch
):
    await env(tmp_path, monkeypatch)
    respx.post(UPSTREAM).respond(
        json=_completion("```wiki-update\n# Incomplete\nno closing fence here")
    )
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={"instruction": "Draft a page"},
            headers=OWNER,
        )
    assert resp.status_code == 502
    assert "draft_failed" in str(resp.json()["detail"])

    async with client() as c:
        proposals = (await c.get("/api/wiki/proposals")).json()["proposals"]
    assert proposals == []
    get_settings.cache_clear()


@respx.mock
async def test_draft_nested_code_block_survives_extraction(tmp_path, monkeypatch):
    await env(tmp_path, monkeypatch)
    completion_text = (
        "Sure thing:\n"
        "```wiki-update\n"
        "# Example\n"
        "\n"
        "```python\n"
        "def add(a, b):\n"
        "    return a + b\n"
        "```\n"
        "\n"
        "That's it.\n"
        "```\n"
    )
    expected_content = (
        "# Example\n"
        "\n"
        "```python\n"
        "def add(a, b):\n"
        "    return a + b\n"
        "```\n"
        "\n"
        "That's it."
    )
    respx.post(UPSTREAM).respond(json=_completion(completion_text))
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={"instruction": "Draft a page with a code sample"},
            headers=OWNER,
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["content"] == expected_content

    async with client() as c:
        proposals = (await c.get("/api/wiki/proposals")).json()["proposals"]
    stored = next(p for p in proposals if p["id"] == body["id"])
    assert stored["content"] == expected_content
    get_settings.cache_clear()


async def test_draft_is_owner_gated(tmp_path, monkeypatch):
    await env(tmp_path, monkeypatch)
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft", json={"instruction": "Draft a page"}
        )
    assert resp.status_code == 401
    get_settings.cache_clear()


async def test_draft_unknown_page_id_is_404(tmp_path, monkeypatch):
    await env(tmp_path, monkeypatch)
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={"instruction": "Draft a page", "page_id": 9999},
            headers=OWNER,
        )
    assert resp.status_code == 404
    get_settings.cache_clear()


@respx.mock
async def test_draft_pending_cap_exceeded_returns_429(tmp_path, monkeypatch):
    await env(tmp_path, monkeypatch)
    for i in range(25):
        wiki_store.create_proposal(None, f"Filler {i}", None, "x")

    route = respx.post(UPSTREAM).respond(
        json=_completion("```wiki-update\nnew content\n```")
    )
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={"instruction": "Draft a page"},
            headers=OWNER,
        )
    assert resp.status_code == 429
    assert route.called is False

    async with client() as c:
        proposals = (await c.get("/api/wiki/proposals")).json()["proposals"]
    assert len(proposals) == 25
    get_settings.cache_clear()


@respx.mock
async def test_draft_upstream_5xx_returns_502(tmp_path, monkeypatch):
    await env(tmp_path, monkeypatch)
    respx.post(UPSTREAM).respond(status_code=500)
    async with client() as c:
        resp = await c.post(
            "/api/wiki/draft",
            json={"instruction": "Draft a page"},
            headers=OWNER,
        )
    assert resp.status_code == 502
    get_settings.cache_clear()
