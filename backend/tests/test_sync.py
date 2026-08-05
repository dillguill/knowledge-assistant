import asyncio
from unittest.mock import MagicMock

import pytest

from app.config import get_settings
from app.services import sync


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
    sync._reset_for_tests()


def test_disabled_without_config():
    assert sync.enabled() is False
    assert sync.status() == "disabled"
    sync.schedule_push()  # must be a silent no-op


async def test_debounced_push_coalesces(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()
    uploads = MagicMock()
    monkeypatch.setattr(sync, "_upload_folder", uploads)
    sync.schedule_push(delay_s=0.05)
    sync.schedule_push(delay_s=0.05)  # coalesces with the first
    assert sync.status() == "pending"
    await asyncio.sleep(0.15)
    assert uploads.call_count == 1
    assert sync.status() == "idle"


def test_pull_survives_missing_repo(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()

    def boom(**kwargs):
        raise RuntimeError("404 repo not found")

    monkeypatch.setattr(sync, "_snapshot_download", boom)
    sync.pull()  # must not raise


def test_pull_excludes_git_pushed_wiki_subtree(monkeypatch):
    # The wiki's own content (wiki/**) lives at the dataset repo's root,
    # git-pushed independently by pull_wiki_git — the whole-tree pull must
    # not also download it into data_dir's root as a stray duplicate.
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()
    downloads = MagicMock()
    monkeypatch.setattr(sync, "_snapshot_download", downloads)
    sync.pull()
    assert downloads.call_args.kwargs["ignore_patterns"] == ["wiki/**"]


async def test_debounced_push_excludes_local_wiki_git_clone(monkeypatch):
    # wiki_git/ is a nested git working tree with its own .git internals —
    # the whole-tree blob-replace push must never touch it (see
    # pull_wiki_git/schedule_wiki_push for its independent sync path).
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()
    uploads = MagicMock()
    monkeypatch.setattr(sync, "_upload_folder", uploads)
    sync.schedule_push(delay_s=0.05)
    await asyncio.sleep(0.1)
    assert uploads.call_args.kwargs["ignore_patterns"] == ["wiki_git/**"]


# --- wiki git remote sync (separate from the whole-tree blob sync above) ---


def test_wiki_schedule_push_noop_when_disabled():
    sync.schedule_wiki_push()  # must be a silent no-op


async def test_wiki_debounced_push_coalesces(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()
    pushes = MagicMock()
    monkeypatch.setattr(sync, "_wiki_git_push", pushes)
    sync.schedule_wiki_push(delay_s=0.05)
    sync.schedule_wiki_push(delay_s=0.05)  # coalesces with the first
    await asyncio.sleep(0.15)
    assert pushes.call_count == 1


def test_pull_wiki_git_survives_failure(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()

    def boom(data_dir):
        raise RuntimeError("network down")

    monkeypatch.setattr(sync, "_wiki_git_pull_or_clone", boom)
    sync.pull_wiki_git()  # must not raise
