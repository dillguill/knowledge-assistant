import pytest

from app.config import get_settings
from app.db import store, wiki_store
from app.services.context_builder import build_source_context


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    wiki_store.init_wiki(str(tmp_path))
    yield
    get_settings.cache_clear()


def test_empty_inputs_produce_no_context():
    assert build_source_context([], [], [], 1000) == ("", [])


def test_labels_and_material_in_order():
    col = store.create_collection("Garage")
    d1 = store.add_document(col["id"], "manual.pdf", "application/pdf",
                            "upload", b"x", "torque is 22 Nm")
    d2 = store.add_document(None, "bulletin.txt", "text/plain",
                            "attachment", b"y", "revised to 24 Nm")
    block, sources = build_source_context([col["id"]], [d2["id"]], [], 1000)
    assert sources == [
        {"id": d1["id"], "label": "S1", "filename": "manual.pdf", "kind": "document"},
        {"id": d2["id"], "label": "S2", "filename": "bulletin.txt", "kind": "document"},
    ]
    assert "[S1] manual.pdf" in block and "torque is 22 Nm" in block
    assert "[S2] bulletin.txt" in block and "revised to 24 Nm" in block
    assert "Answer ONLY from the source material" in block


def test_budget_truncates_with_notice():
    col = store.create_collection("Big")
    store.add_document(col["id"], "big.txt", "text/plain",
                       "upload", b"x", "A" * 5000)
    block, _ = build_source_context([col["id"]], [], [], 200)
    assert len(block) < 1200  # rules + truncated material
    assert "truncated" in block.lower()


def test_wiki_page_text_lands_in_block_with_label_and_title():
    page = wiki_store.create_page("Torque Specs", None, "torque is 22 Nm", "owner")
    block, sources = build_source_context([], [], [page["id"]], 1000)
    assert sources == [
        {"id": page["id"], "label": "S1", "filename": "Torque Specs",
         "kind": "wiki", "slug": page["slug"]},
    ]
    assert "[S1] Torque Specs" in block and "torque is 22 Nm" in block


def test_mixed_collections_attachments_wiki_ordering_stable():
    col = store.create_collection("Garage")
    d1 = store.add_document(col["id"], "manual.pdf", "application/pdf",
                            "upload", b"x", "torque is 22 Nm")
    d2 = store.add_document(None, "bulletin.txt", "text/plain",
                            "attachment", b"y", "revised to 24 Nm")
    page = wiki_store.create_page("Torque Specs", None, "wiki says 26 Nm", "owner")
    block, sources = build_source_context([col["id"]], [d2["id"]], [page["id"]], 1000)
    assert sources == [
        {"id": d1["id"], "label": "S1", "filename": "manual.pdf", "kind": "document"},
        {"id": d2["id"], "label": "S2", "filename": "bulletin.txt", "kind": "document"},
        {"id": page["id"], "label": "S3", "filename": "Torque Specs",
         "kind": "wiki", "slug": page["slug"]},
    ]
    assert "[S1] manual.pdf" in block
    assert "[S2] bulletin.txt" in block
    assert "[S3] Torque Specs" in block and "wiki says 26 Nm" in block


def test_wiki_only_input_produces_context():
    page = wiki_store.create_page("Solo Page", None, "solo content", "owner")
    block, sources = build_source_context([], [], [page["id"]], 1000)
    assert block != ""
    assert len(sources) == 1


def test_unknown_wiki_id_is_skipped():
    block, sources = build_source_context([], [], [9999], 1000)
    assert (block, sources) == ("", [])


def test_web_results_append_after_wiki_with_url_and_negative_ids():
    from app.services.context_builder import build_source_context
    from app.services.search import WebResult

    block, sources = build_source_context(
        [], [], [], budget=1000,
        web_results=[
            WebResult(url="https://a.test", title="A", content="body a", excerpt="ex a"),
            WebResult(url="https://b.test", title="B", content="body b", excerpt="ex b"),
        ],
        web_budget=1000,
    )

    assert [s["label"] for s in sources] == ["S1", "S2"]
    assert [s["kind"] for s in sources] == ["web", "web"]
    assert sources[0]["url"] == "https://a.test"
    assert sources[0]["filename"] == "A"
    # Negative ids keep web sources out of the document id space.
    assert sources[0]["id"] < 0 and sources[1]["id"] < 0
    assert sources[0]["id"] != sources[1]["id"]
    assert "body a" in block and "body b" in block


def test_web_results_do_not_shrink_the_document_budget():
    from app.services.context_builder import build_source_context
    from app.services.search import WebResult

    col = store.create_collection("Garage")
    store.add_document(col["id"], "manual.pdf", "application/pdf",
                       "upload", b"x", "torque is 22 Nm")

    # With no web results, the document alone gets the full document budget.
    block_no_web, sources_no_web = build_source_context([col["id"]], [], [], budget=2000)

    block_with_web, sources_with_web = build_source_context(
        [col["id"]], [], [], budget=2000,
        web_results=[WebResult(url="https://a.test", title="A", content="w" * 5000, excerpt="")],
        web_budget=600,
    )

    # The document's own chunk (label, filename, and full untruncated text) is
    # identical whether or not web results are present.
    doc_chunk_no_web = block_no_web.split("--- [S1] manual.pdf ---\n", 1)[1]
    doc_chunk_with_web = block_with_web.split("--- [S1] manual.pdf ---\n", 1)[1]
    assert doc_chunk_with_web.startswith(doc_chunk_no_web.split("\n\n", 1)[0])
    assert sources_no_web == sources_with_web[:1]
    assert "torque is 22 Nm" in block_with_web

    # The web item is truncated to its own budget, not to a share of `budget`.
    web_chunk = block_with_web.split("--- [S2] A ---\n", 1)[1]
    assert web_chunk.count("w") <= 700
    assert "[…truncated to fit the context budget]" in web_chunk


def test_no_web_results_leaves_existing_behavior_unchanged():
    from app.services.context_builder import build_source_context

    block, sources = build_source_context([], [], [], budget=1000)
    assert block == "" and sources == []
