import shutil
import subprocess

import pytest

from app.config import get_settings
from app.db import wiki_store
from app.services import wiki_git
from scripts.migrate_wiki_to_git import migrate


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    wiki_store.init_wiki(str(tmp_path))
    yield tmp_path
    get_settings.cache_clear()


def _reset_git_repo(data_dir):
    """wiki_store.create_page already auto-syncs to git (Branch 1's own
    wiring), so simulate the real pre-migration scenario this script targets
    — existing DB rows from before git-native storage existed, no wiki_git/
    directory yet — by wiping the repo the auto-sync created."""
    repo = wiki_git._repo_dir(str(data_dir))
    if repo.exists():
        shutil.rmtree(repo)


def test_migrate_writes_files_with_frontmatter_and_single_commit(data_dir):
    folder = wiki_store.create_folder("Engines", None)
    wiki_store.create_page("Torque Specs", folder["id"], "Use 22 Nm.", "owner")
    wiki_store.create_page("Oil Change", None, "Drain every 5000 miles.", "owner")
    _reset_git_repo(data_dir)

    count = migrate(str(data_dir))
    assert count == 2

    repo = wiki_git._repo_dir(str(data_dir))
    torque_file = repo / "wiki" / "engines" / "torque-specs.md"
    oil_file = repo / "wiki" / "oil-change.md"
    assert torque_file.exists()
    assert oil_file.exists()

    fields, body = wiki_git.parse_frontmatter(torque_file.read_text())
    assert fields["title"] == "Torque Specs"
    assert fields["slug"] == "torque-specs"
    assert body == "Use 22 Nm."

    log = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo, capture_output=True, text=True
    ).stdout.strip().splitlines()
    assert len(log) == 1


def test_migrate_refuses_to_rerun_without_force(data_dir):
    wiki_store.create_page("Torque Specs", None, "content", "owner")
    _reset_git_repo(data_dir)
    migrate(str(data_dir))

    with pytest.raises(RuntimeError):
        migrate(str(data_dir))

    repo = wiki_git._repo_dir(str(data_dir))
    log = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo, capture_output=True, text=True
    ).stdout.strip().splitlines()
    assert len(log) == 1  # unchanged — refused before writing anything new


def test_migrate_with_force_reruns(data_dir):
    page = wiki_store.create_page("Torque Specs", None, "v1", "owner")
    _reset_git_repo(data_dir)
    migrate(str(data_dir))

    # Bypass wiki_store's own auto-sync (raw SQL) so this isolates the
    # migration script's own re-run behavior from update_page_content's.
    with wiki_store._connect() as conn:
        conn.execute(
            "UPDATE wiki_pages SET content = ? WHERE id = ?", ("v2", page["id"])
        )

    with pytest.raises(RuntimeError):
        migrate(str(data_dir))  # refuses without --force

    count = migrate(str(data_dir), force=True)
    assert count == 1

    repo = wiki_git._repo_dir(str(data_dir))
    log = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo, capture_output=True, text=True
    ).stdout.strip().splitlines()
    assert len(log) == 2  # content actually changed, so a real second commit


def test_migrate_with_no_pages_writes_no_commit(data_dir):
    _reset_git_repo(data_dir)
    count = migrate(str(data_dir))
    assert count == 0
    repo = wiki_git._repo_dir(str(data_dir))
    log = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo, capture_output=True, text=True
    ).stdout.strip().splitlines()
    assert log == []
