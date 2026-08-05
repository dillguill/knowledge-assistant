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
    monkeypatch.setattr(sync, "_create_branch", MagicMock())
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


def test_pull_uses_the_dedicated_data_sync_branch(monkeypatch):
    # The whole-tree blob sync and the wiki's real git history are two
    # logically independent writers — sharing a branch caused a genuine
    # non-fast-forward collision in live testing (both mechanisms racing to
    # advance "main"). They now live on separate branches entirely, so the
    # whole-tree pull no longer needs to exclude wiki/** — data-sync never
    # has it in the first place, since nothing ever uploads it there.
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()
    downloads = MagicMock()
    monkeypatch.setattr(sync, "_snapshot_download", downloads)
    sync.pull()
    assert downloads.call_args.kwargs["revision"] == sync._DATA_SYNC_REVISION


async def test_debounced_push_ensures_branch_and_excludes_local_wiki_git_clone(monkeypatch):
    # wiki_git/ is a nested git working tree with its own .git internals —
    # the whole-tree blob-replace push must never touch it (see
    # pull_wiki_git/schedule_wiki_push for its independent sync path), on
    # top of now targeting its own dedicated branch.
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()
    uploads = MagicMock()
    branches = MagicMock()
    monkeypatch.setattr(sync, "_upload_folder", uploads)
    monkeypatch.setattr(sync, "_create_branch", branches)
    sync.schedule_push(delay_s=0.05)
    await asyncio.sleep(0.1)
    branches.assert_called_once_with(
        repo_id="u/r", repo_type="dataset", branch=sync._DATA_SYNC_REVISION,
        token="t", exist_ok=True,
    )
    assert uploads.call_args.kwargs["ignore_patterns"] == ["wiki_git/**"]
    assert uploads.call_args.kwargs["revision"] == sync._DATA_SYNC_REVISION


async def test_debounced_push_survives_branch_creation_failure(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "t")
    monkeypatch.setenv("HF_DATASET_REPO", "u/r")
    get_settings.cache_clear()

    def boom(**kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(sync, "_create_branch", boom)
    sync.schedule_push(delay_s=0.05)
    await asyncio.sleep(0.1)  # must not raise


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
