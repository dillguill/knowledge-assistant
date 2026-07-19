import pytest

from app.config import get_settings
from app.db import wiki_store
from app.services.wiki_seed import seed_wiki


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    wiki_store.init_wiki(str(tmp_path))
    yield
    get_settings.cache_clear()


def test_seeds_once_and_only_when_empty():
    seed_wiki()
    folders = wiki_store.list_folders()
    assert [f["name"] for f in folders] == ["Guides"]

    pages = wiki_store.list_pages()
    assert [p["title"] for p in pages] == ["Welcome to the Wiki"]
    assert pages[0]["folder_id"] == folders[0]["id"]
    assert pages[0]["last_author"] == "owner"

    versions = wiki_store.list_versions(pages[0]["id"])
    assert len(versions) == 1
    assert versions[0]["author"] == "owner"

    seed_wiki()  # second call: no duplicates
    assert wiki_store.list_folders() == folders
    assert wiki_store.list_pages() == pages


def test_skips_entirely_when_a_page_already_exists():
    wiki_store.create_page("Existing Page", None, "hello", "owner")

    seed_wiki()

    assert wiki_store.list_folders() == []
    assert [p["title"] for p in wiki_store.list_pages()] == ["Existing Page"]
