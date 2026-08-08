import pytest

from app.config import get_settings
from app.db import store


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    yield tmp_path
    get_settings.cache_clear()


def test_create_and_list_collections():
    c = store.create_collection("Garage")
    assert c["name"] == "Garage" and c["file_count"] == 0
    assert [x["name"] for x in store.list_collections()] == ["Garage"]


def test_add_document_stores_raw_and_text(data_dir):
    c = store.create_collection("Garage")
    d = store.add_document(c["id"], "manual v1.pdf", "application/pdf",
                           "upload", b"%PDF-raw", "torque is 22 Nm")
    assert d["collection_id"] == c["id"]
    assert d["size_bytes"] == len(b"%PDF-raw")
    path = store.get_document_path(d)
    assert path.read_bytes() == b"%PDF-raw"
    assert path.name == f"{d['id']}_manual_v1.pdf"
    assert store.list_collections()[0]["file_count"] == 1
    [(doc, text)] = store.get_texts([d["id"]])
    assert doc["id"] == d["id"] and text == "torque is 22 Nm"


def test_attachment_documents_have_no_collection():
    d = store.add_document(None, "note.txt", "text/plain",
                           "attachment", b"hi", "hi")
    assert d["collection_id"] is None
    assert store.get_document(d["id"])["origin"] == "attachment"


def test_init_db_is_idempotent(data_dir):
    store.init_db(str(data_dir))  # second call must not raise


def test_normalize_query_lowercases_and_collapses_whitespace():
    from app.db import store

    assert store.normalize_query("  Best   PYTHON  linters ") == "best python linters"


def test_cached_search_roundtrip(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))

    results = [{"url": "https://a.test", "title": "A", "content": "body", "excerpt": "ex"}]
    store.put_cached_search("Rust Linters", 5, results)

    # Normalized lookup hits the same row.
    assert store.get_cached_search("  rust   linters ", 5, ttl_s=3600) == results
    # A different max_results is a different cache key.
    assert store.get_cached_search("rust linters", 3, ttl_s=3600) is None
    # An expired entry is a miss.
    assert store.get_cached_search("rust linters", 5, ttl_s=0) is None


def test_migration_adds_provenance_columns_to_an_existing_db(tmp_path, monkeypatch):
    import sqlite3

    from app.config import get_settings
    from app.db import store

    # The autouse fixture already initialized tmp_path with the current schema,
    # so build the legacy database somewhere untouched.
    legacy_dir = tmp_path / "legacy"
    legacy_dir.mkdir()
    monkeypatch.setenv("DATA_DIR", str(legacy_dir))
    get_settings.cache_clear()

    # Simulate a pre-v0.5.0 database: documents without the new columns, and
    # with the narrow origin CHECK that rejects 'web'.
    db_path = legacy_dir / "knowledge.db"
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE collections (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE documents (
                id INTEGER PRIMARY KEY,
                collection_id INTEGER REFERENCES collections(id),
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                origin TEXT NOT NULL
                    CHECK (origin IN ('upload', 'corpus', 'attachment')),
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO collections (id, name) VALUES (1, 'Garage');
            INSERT INTO documents
                (id, collection_id, filename, content_type, origin, size_bytes)
                VALUES (7, 1, 'manual.txt', 'text/plain', 'upload', 3);
            """
        )

    store.init_db(str(legacy_dir))

    with sqlite3.connect(db_path) as conn:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
        rows = conn.execute(
            "SELECT id, filename, origin, collection_id FROM documents"
        ).fetchall()
    assert "source_url" in columns
    assert "fetched_at" in columns
    # The rebuild must preserve existing rows, ids included.
    assert rows == [(7, "manual.txt", "upload", 1)]
    # And the widened CHECK must now admit 'web'.
    doc = store.upsert_web_document(1, "https://a.test/x", "Title", "body")
    assert doc["origin"] == "web"


def test_migration_is_idempotent(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    collection = store.get_or_create_collection("Web")
    store.upsert_web_document(collection["id"], "https://a.test/x", "T", "body")

    store.init_db(str(tmp_path))
    store.init_db(str(tmp_path))

    assert len(store.list_documents(collection["id"])) == 1


def test_get_or_create_collection_is_idempotent(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))

    first = store.get_or_create_collection("Web")
    second = store.get_or_create_collection("Web")
    assert first["id"] == second["id"]
    assert [c["name"] for c in store.list_collections()].count("Web") == 1


def test_upsert_web_document_updates_rather_than_duplicating(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    collection = store.get_or_create_collection("Web")

    first = store.upsert_web_document(
        collection["id"], "https://a.test/x", "Title", "first body"
    )
    second = store.upsert_web_document(
        collection["id"], "https://a.test/x", "New Title", "second body"
    )

    assert first["id"] == second["id"]
    assert second["source_url"] == "https://a.test/x"
    assert second["fetched_at"] is not None
    assert len(store.list_documents(collection["id"])) == 1
    assert store.get_texts([second["id"]])[0][1] == "second body"


def test_upsert_web_document_keeps_the_fts_index_in_step(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    collection = store.get_or_create_collection("Web")

    doc = store.upsert_web_document(
        collection["id"], "https://a.test/x", "Title", "carburetor rebuild"
    )
    store.upsert_web_document(
        collection["id"], "https://a.test/x", "Title", "alternator bracket"
    )

    # The superseded body must be gone from the index, not merely shadowed.
    # Nothing queries the FTS index yet, so go at it directly.
    import sqlite3

    with sqlite3.connect(tmp_path / "knowledge.db") as conn:
        hits = conn.execute(
            "SELECT rowid FROM document_texts_fts WHERE document_texts_fts MATCH ?",
            ("alternator",),
        ).fetchall()
        stale = conn.execute(
            "SELECT rowid FROM document_texts_fts WHERE document_texts_fts MATCH ?",
            ("carburetor",),
        ).fetchall()
    assert [r[0] for r in hits] == [doc["id"]]
    assert stale == []


def test_upsert_web_document_distinct_urls_are_distinct_documents(
    tmp_path, monkeypatch
):
    from app.config import get_settings
    from app.db import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    collection = store.get_or_create_collection("Web")

    a = store.upsert_web_document(collection["id"], "https://a.test/x", "A", "one")
    b = store.upsert_web_document(collection["id"], "https://a.test/y", "B", "two")
    assert a["id"] != b["id"]
    assert len(store.list_documents(collection["id"])) == 2
