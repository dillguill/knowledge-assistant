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
