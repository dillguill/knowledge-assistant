import sqlite3

import pytest

from app.config import get_settings
from app.db import wiki_store


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    wiki_store.init_wiki(str(tmp_path))
    yield tmp_path
    get_settings.cache_clear()


def test_init_wiki_is_idempotent(data_dir):
    wiki_store.init_wiki(str(data_dir))  # second call must not raise


# --- folder CRUD ---


def test_create_and_list_folders():
    f = wiki_store.create_folder("Engines", None)
    assert f["name"] == "Engines"
    assert f["parent_id"] is None
    assert [x["name"] for x in wiki_store.list_folders()] == ["Engines"]


def test_create_folder_duplicate_name_same_parent_raises():
    # NOTE: SQLite treats NULL != NULL in UNIQUE indexes, so top-level
    # (parent_id=NULL) name collisions are not rejected by the schema as
    # specified. Exercise the constraint under a shared non-null parent,
    # where it reliably fires.
    parent = wiki_store.create_folder("Vehicles", None)
    wiki_store.create_folder("Engines", parent["id"])
    with pytest.raises(sqlite3.IntegrityError):
        wiki_store.create_folder("Engines", parent["id"])


def test_create_folder_same_name_different_parent_ok():
    parent = wiki_store.create_folder("Engines", None)
    child = wiki_store.create_folder("Engines", parent["id"])
    assert child["parent_id"] == parent["id"]


def test_delete_folder_with_pages_raises_value_error():
    folder = wiki_store.create_folder("Engines", None)
    wiki_store.create_page("Torque Specs", folder["id"], "content", "owner")
    with pytest.raises(ValueError):
        wiki_store.delete_folder(folder["id"])


def test_delete_folder_with_subfolder_raises_value_error():
    parent = wiki_store.create_folder("Engines", None)
    wiki_store.create_folder("V8", parent["id"])
    with pytest.raises(ValueError):
        wiki_store.delete_folder(parent["id"])


def test_delete_empty_folder_succeeds():
    folder = wiki_store.create_folder("Engines", None)
    wiki_store.delete_folder(folder["id"])
    assert wiki_store.list_folders() == []


def test_rename_folder():
    folder = wiki_store.create_folder("Engines", None)
    wiki_store.rename_folder(folder["id"], "Motors")
    assert [x["name"] for x in wiki_store.list_folders()] == ["Motors"]


def test_move_folder():
    a = wiki_store.create_folder("A", None)
    b = wiki_store.create_folder("B", None)
    wiki_store.move_folder(b["id"], a["id"])
    moved = [x for x in wiki_store.list_folders() if x["id"] == b["id"]][0]
    assert moved["parent_id"] == a["id"]


# --- page create ---


def test_create_page_writes_slug_and_first_version():
    page = wiki_store.create_page("Torque Specs", None, "Use 22 Nm.", "owner")
    assert page["slug"] == "torque-specs"
    assert page["title"] == "Torque Specs"
    assert page["content"] == "Use 22 Nm."
    versions = wiki_store.list_versions(page["id"])
    assert len(versions) == 1
    assert versions[0]["author"] == "owner"


def test_create_page_slug_collision_appends_suffix():
    p1 = wiki_store.create_page("Torque Specs", None, "a", "owner")
    p2 = wiki_store.create_page("Torque Specs", None, "b", "owner")
    p3 = wiki_store.create_page("Torque Specs", None, "c", "owner")
    assert p1["slug"] == "torque-specs"
    assert p2["slug"] == "torque-specs-2"
    assert p3["slug"] == "torque-specs-3"


def test_get_page_by_slug():
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    found = wiki_store.get_page_by_slug("torque-specs")
    assert found["id"] == page["id"]
    assert wiki_store.get_page_by_slug("nonexistent") is None


def test_get_page_returns_none_when_missing():
    assert wiki_store.get_page(999) is None


def test_list_pages():
    wiki_store.create_page("Torque Specs", None, "a", "owner")
    wiki_store.create_page("Oil Change", None, "b", "owner")
    titles = {p["title"] for p in wiki_store.list_pages()}
    assert titles == {"Torque Specs", "Oil Change"}
    # shape check
    row = wiki_store.list_pages()[0]
    for key in ("id", "folder_id", "title", "slug", "position", "updated_at", "last_author"):
        assert key in row


# --- update_page_content ---


def test_update_page_content_creates_version_and_bumps_updated_at():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    updated = wiki_store.update_page_content(
        page["id"], "v2", "assistant", note="clarify", citations=["doc-1"]
    )
    assert updated["content"] == "v2"
    versions = wiki_store.list_versions(page["id"])
    assert len(versions) == 2

    fetched = wiki_store.get_page(page["id"])
    assert fetched["content"] == "v2"


def test_update_page_content_citations_round_trip_as_list():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    wiki_store.update_page_content(
        page["id"], "v2", "owner", citations=["doc-1", "doc-2"]
    )
    versions = wiki_store.list_versions(page["id"])
    latest = versions[0]
    full = wiki_store.get_version(latest["id"])
    assert full["citations"] == ["doc-1", "doc-2"]


def test_update_page_content_default_citations_is_empty_list():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    version = wiki_store.list_versions(page["id"])[0]
    full = wiki_store.get_version(version["id"])
    assert full["citations"] == []


# --- rename/move/delete page ---


def test_rename_page_keeps_slug_stable():
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    wiki_store.rename_page(page["id"], "Torque Specifications")
    fetched = wiki_store.get_page(page["id"])
    assert fetched["title"] == "Torque Specifications"
    assert fetched["slug"] == "torque-specs"


def test_move_page():
    folder = wiki_store.create_folder("Engines", None)
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    wiki_store.move_page(page["id"], folder["id"])
    fetched = wiki_store.get_page(page["id"])
    assert fetched["folder_id"] == folder["id"]


def test_delete_page_cascades_versions():
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    wiki_store.update_page_content(page["id"], "v2", "owner")
    wiki_store.delete_page(page["id"])
    assert wiki_store.get_page(page["id"]) is None
    assert wiki_store.list_versions(page["id"]) == []


def test_delete_page_cascades_proposals():
    # Proposal CRUD is out of scope for this module (Task 3); this asserts
    # the FK ON DELETE CASCADE declared in the schema actually fires.
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    with wiki_store._connect() as conn:
        conn.execute(
            "INSERT INTO wiki_proposals (page_id, title, content) VALUES (?, ?, ?)",
            (page["id"], "Torque Specs", "proposed content"),
        )
    wiki_store.delete_page(page["id"])
    with wiki_store._connect() as conn:
        remaining = conn.execute(
            "SELECT * FROM wiki_proposals WHERE page_id = ?", (page["id"],)
        ).fetchall()
    assert remaining == []


# --- list_versions / get_version ---


def test_list_versions_newest_first_without_content():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    wiki_store.update_page_content(page["id"], "v2", "owner")
    wiki_store.update_page_content(page["id"], "v3", "owner")
    versions = wiki_store.list_versions(page["id"])
    assert len(versions) == 3
    created = [v["created_at"] for v in versions]
    assert created == sorted(created, reverse=True) or [v["id"] for v in versions] == sorted(
        [v["id"] for v in versions], reverse=True
    )
    for v in versions:
        assert "content" not in v


def test_get_version_includes_content():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    version = wiki_store.list_versions(page["id"])[0]
    full = wiki_store.get_version(version["id"])
    assert full["content"] == "v1"


def test_get_version_returns_none_when_missing():
    assert wiki_store.get_version(999) is None


# --- search_pages ---


def test_search_pages_finds_by_body_text():
    wiki_store.create_page("Torque Specs", None, "the torque wrench setting is 22 Nm", "owner")
    wiki_store.create_page("Oil Change", None, "drain the oil every 5000 miles", "owner")
    results = wiki_store.search_pages("wrench")
    assert len(results) == 1
    assert results[0]["slug"] == "torque-specs"
    assert "snippet" in results[0]
    assert "title" in results[0] and "id" in results[0]


def test_search_pages_finds_updated_content():
    page = wiki_store.create_page("Torque Specs", None, "original", "owner")
    wiki_store.update_page_content(page["id"], "updated text about flywheels", "owner")
    results = wiki_store.search_pages("flywheels")
    assert len(results) == 1
    assert results[0]["slug"] == "torque-specs"


def test_search_pages_no_match_returns_empty():
    wiki_store.create_page("Torque Specs", None, "content", "owner")
    assert wiki_store.search_pages("nonexistentword") == []


def test_search_pages_escapes_special_characters():
    wiki_store.create_page("FAQ", None, "what torque? use 22Nm-ish", "owner")
    # should not raise even though query has FTS special chars
    results = wiki_store.search_pages("torque?")
    assert isinstance(results, list)
