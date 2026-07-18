import pytest

from app.config import get_settings
from app.db import store
from app.services.corpus import seed_demo_corpus


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    store.init_db(str(tmp_path))
    yield
    get_settings.cache_clear()


def test_seeds_once_and_only_when_empty():
    seed_demo_corpus()
    cols = store.list_collections()
    assert [c["name"] for c in cols] == ["Demo corpus"]
    assert cols[0]["file_count"] >= 2
    seed_demo_corpus()  # second call: no duplicates
    assert store.list_collections()[0]["file_count"] == cols[0]["file_count"]
