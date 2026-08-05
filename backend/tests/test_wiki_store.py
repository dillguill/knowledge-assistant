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


def test_create_folder_duplicate_root_name_raises():
    # App-level check: two ROOT folders (parent_id=NULL) with same name must be rejected.
    wiki_store.create_folder("Engines", None)
    with pytest.raises(sqlite3.IntegrityError):
        wiki_store.create_folder("Engines", None)


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


def test_rename_folder_to_existing_root_name_raises():
    # App-level check: renaming a root folder to an existing root name must be rejected.
    f1 = wiki_store.create_folder("Engines", None)
    wiki_store.create_folder("Motors", None)
    with pytest.raises(sqlite3.IntegrityError):
        wiki_store.rename_folder(f1["id"], "Motors")


def test_move_folder():
    a = wiki_store.create_folder("A", None)
    b = wiki_store.create_folder("B", None)
    wiki_store.move_folder(b["id"], a["id"])
    moved = [x for x in wiki_store.list_folders() if x["id"] == b["id"]][0]
    assert moved["parent_id"] == a["id"]


def test_move_folder_into_parent_with_same_name_raises():
    # App-level check: moving a folder into a parent that already has a same-named child must be rejected.
    parent = wiki_store.create_folder("Parent", None)
    child1 = wiki_store.create_folder("Child", parent["id"])
    child2 = wiki_store.create_folder("Child", None)
    with pytest.raises(sqlite3.IntegrityError):
        wiki_store.move_folder(child2["id"], parent["id"])


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


def test_update_page_content_creates_version_and_bumps_updated_at(data_dir):
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")

    # Backdate the page's updated_at to verify it bumps on update
    conn = sqlite3.connect(data_dir / "knowledge.db")
    conn.execute(
        "UPDATE wiki_pages SET updated_at = '2000-01-01 00:00:00' WHERE id = ?",
        (page["id"],),
    )
    conn.commit()
    conn.close()

    original_updated_at = "2000-01-01 00:00:00"
    updated = wiki_store.update_page_content(
        page["id"], "v2", "assistant", note="clarify", citations=["doc-1"]
    )
    assert updated["content"] == "v2"
    versions = wiki_store.list_versions(page["id"])
    assert len(versions) == 2

    fetched = wiki_store.get_page(page["id"])
    assert fetched["content"] == "v2"
    # Assert that updated_at has bumped
    assert fetched["updated_at"] != original_updated_at
    assert fetched["updated_at"] > original_updated_at


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


# --- git sync ---


def _git_path(page_id: int) -> str | None:
    with wiki_store._connect() as conn:
        row = conn.execute(
            "SELECT git_path FROM wiki_pages WHERE id = ?", (page_id,)
        ).fetchone()
    return row["git_path"] if row else None


def test_create_page_writes_git_commit_and_sets_git_path():
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    assert _git_path(page["id"]) == "wiki/torque-specs.md"


def test_update_page_content_writes_git_commit_and_updates_git_path():
    folder = wiki_store.create_folder("Engines", None)
    page = wiki_store.create_page("Torque Specs", folder["id"], "v1", "owner")
    wiki_store.update_page_content(page["id"], "v2", "owner", note="clarify")
    assert _git_path(page["id"]) == "wiki/engines/torque-specs.md"


def test_update_page_content_git_failure_does_not_roll_back_sqlite_write(monkeypatch):
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")

    def boom(**kwargs):
        raise wiki_store.wiki_git.GitCommitError("disk full")

    monkeypatch.setattr(wiki_store.wiki_git, "commit_page", boom)
    updated = wiki_store.update_page_content(page["id"], "v2", "owner")
    assert updated["content"] == "v2"
    assert wiki_store.get_page(page["id"])["content"] == "v2"


def test_approve_proposal_sets_commit_sha_on_success():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    proposal = wiki_store.create_proposal(page["id"], "Torque Specs", None, "v2")
    wiki_store.approve_proposal(proposal["id"])
    with wiki_store._connect() as conn:
        row = conn.execute(
            "SELECT commit_sha FROM wiki_proposals WHERE id = ?", (proposal["id"],)
        ).fetchone()
    assert row["commit_sha"] is not None


def test_approve_proposal_leaves_commit_sha_null_on_git_failure(monkeypatch):
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    proposal = wiki_store.create_proposal(page["id"], "Torque Specs", None, "v2")

    def boom(**kwargs):
        raise wiki_store.wiki_git.GitCommitError("disk full")

    monkeypatch.setattr(wiki_store.wiki_git, "commit_page", boom)
    wiki_store.approve_proposal(proposal["id"])
    with wiki_store._connect() as conn:
        row = conn.execute(
            "SELECT commit_sha, status FROM wiki_proposals WHERE id = ?",
            (proposal["id"],),
        ).fetchone()
    assert row["status"] == "approved"
    assert row["commit_sha"] is None


def test_rename_folder_relocates_descendant_page_git_paths():
    parent = wiki_store.create_folder("Engines", None)
    page = wiki_store.create_page("Torque Specs", parent["id"], "content", "owner")
    wiki_store.rename_folder(parent["id"], "Motors")
    assert _git_path(page["id"]) == "wiki/motors/torque-specs.md"


def test_move_folder_relocates_descendant_page_git_paths():
    a = wiki_store.create_folder("A", None)
    b = wiki_store.create_folder("B", None)
    page = wiki_store.create_page("Torque Specs", b["id"], "content", "owner")
    wiki_store.move_folder(b["id"], a["id"])
    assert _git_path(page["id"]) == "wiki/a/b/torque-specs.md"


def test_move_page_relocates_git_path():
    folder = wiki_store.create_folder("Engines", None)
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    wiki_store.move_page(page["id"], folder["id"])
    assert _git_path(page["id"]) == "wiki/engines/torque-specs.md"


def test_delete_page_removes_git_file(data_dir):
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    git_path = _git_path(page["id"])
    wiki_store.delete_page(page["id"])
    repo = wiki_store.wiki_git._repo_dir(str(data_dir))
    assert not (repo / git_path).exists()


def test_folder_path_parts_terminates_on_cycle():
    a = wiki_store.create_folder("A", None)
    b = wiki_store.create_folder("B", a["id"])
    # move_folder has no cycle guard today; corrupt the parent chain directly
    # via raw SQL to prove _folder_path_parts defends itself against one.
    with wiki_store._connect() as conn:
        conn.execute(
            "UPDATE wiki_folders SET parent_id = ? WHERE id = ?", (b["id"], a["id"])
        )
        parts = wiki_store._folder_path_parts(conn, b["id"])
    assert isinstance(parts, list)


def test_resync_page_returns_sha():
    page = wiki_store.create_page("Torque Specs", None, "content", "owner")
    assert wiki_store.resync_page(page["id"]) is not None


def test_resync_page_raises_for_unknown_page():
    with pytest.raises(ValueError):
        wiki_store.resync_page(999)


def test_reconcile_git_syncs_all_pages():
    wiki_store.create_page("Torque Specs", None, "a", "owner")
    wiki_store.create_page("Oil Change", None, "b", "owner")
    assert wiki_store.reconcile_git() == 2


# --- git history (page_history / commit_content / restore_commit) ---


def test_page_history_returns_git_log_entries_newest_first():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    wiki_store.update_page_content(page["id"], "v2", "owner", note="clarify")
    history = wiki_store.page_history(page["id"])
    assert len(history) == 2
    assert history[0]["note"] == "clarify"
    assert history[1]["note"] == "created"
    for entry in history:
        assert set(entry) == {"sha", "author", "note", "created_at"}


def test_page_history_empty_when_git_path_missing():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    with wiki_store._connect() as conn:
        conn.execute(
            "UPDATE wiki_pages SET git_path = NULL WHERE id = ?", (page["id"],)
        )
    assert wiki_store.page_history(page["id"]) == []


def test_commit_content_returns_historical_body():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    original_sha = wiki_store.page_history(page["id"])[0]["sha"]
    wiki_store.update_page_content(page["id"], "v2", "owner")
    assert wiki_store.commit_content(page["id"], original_sha) == "v1"


def test_commit_content_returns_none_for_unknown_sha():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    assert wiki_store.commit_content(page["id"], "deadbeef" * 5) is None


def test_restore_commit_writes_historical_content_as_new_forward_commit():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    original_sha = wiki_store.page_history(page["id"])[0]["sha"]
    wiki_store.update_page_content(page["id"], "v2", "owner")

    restored = wiki_store.restore_commit(page["id"], original_sha)
    assert restored["content"] == "v1"
    assert wiki_store.get_page(page["id"])["content"] == "v1"

    new_history = wiki_store.page_history(page["id"])
    assert len(new_history) == 3
    assert new_history[0]["note"].startswith("restored ")


def test_restore_commit_raises_for_unknown_sha():
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    with pytest.raises(ValueError):
        wiki_store.restore_commit(page["id"], "deadbeef" * 5)
