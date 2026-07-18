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
