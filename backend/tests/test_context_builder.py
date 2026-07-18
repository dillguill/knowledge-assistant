import pytest

from app.config import get_settings
from app.db import store
from app.services.context_builder import build_source_context


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    yield
    get_settings.cache_clear()


def test_empty_inputs_produce_no_context():
    assert build_source_context([], [], 1000) == ("", [])


def test_labels_and_material_in_order():
    col = store.create_collection("Garage")
    d1 = store.add_document(col["id"], "manual.pdf", "application/pdf",
                            "upload", b"x", "torque is 22 Nm")
    d2 = store.add_document(None, "bulletin.txt", "text/plain",
                            "attachment", b"y", "revised to 24 Nm")
    block, sources = build_source_context([col["id"]], [d2["id"]], 1000)
    assert sources == [
        {"id": d1["id"], "label": "S1", "filename": "manual.pdf"},
        {"id": d2["id"], "label": "S2", "filename": "bulletin.txt"},
    ]
    assert "[S1] manual.pdf" in block and "torque is 22 Nm" in block
    assert "[S2] bulletin.txt" in block and "revised to 24 Nm" in block
    assert "Answer ONLY from the source material" in block


def test_budget_truncates_with_notice():
    col = store.create_collection("Big")
    store.add_document(col["id"], "big.txt", "text/plain",
                       "upload", b"x", "A" * 5000)
    block, _ = build_source_context([col["id"]], [], 200)
    assert len(block) < 1200  # rules + truncated material
    assert "truncated" in block.lower()
