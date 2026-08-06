import subprocess

import pytest

from app.services import wiki_git


@pytest.fixture
def data_dir(tmp_path):
    return str(tmp_path)


def _log(repo):
    result = subprocess.run(
        ["git", "log", "--format=%H"], cwd=repo, capture_output=True, text=True
    )
    return result.stdout.split()


def _commit_message(repo, sha):
    result = subprocess.run(
        ["git", "show", "-s", "--format=%B", sha], cwd=repo, capture_output=True, text=True
    )
    return result.stdout


# --- ensure_repo ---


def test_ensure_repo_is_idempotent_and_sets_identity(data_dir):
    repo = wiki_git.ensure_repo(data_dir)
    wiki_git.ensure_repo(data_dir)  # second call must not raise
    assert (repo / ".git").is_dir()
    name = subprocess.run(
        ["git", "config", "user.name"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    email = subprocess.run(
        ["git", "config", "user.email"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    assert name == wiki_git.GIT_AUTHOR_NAME
    assert email == wiki_git.GIT_AUTHOR_EMAIL


# --- frontmatter ---


def test_render_and_parse_frontmatter_round_trip():
    text = wiki_git.render_frontmatter(
        "Torque Specs", "torque-specs", "2024-01-01 00:00:00", "2026-08-05 12:00:00"
    )
    fields, body = wiki_git.parse_frontmatter(text + "Use 22 Nm.")
    assert fields == {
        "title": "Torque Specs",
        "slug": "torque-specs",
        "created_at": "2024-01-01 00:00:00",
        "updated_at": "2026-08-05 12:00:00",
    }
    assert body == "Use 22 Nm."


def test_parse_frontmatter_handles_quoted_special_characters():
    text = wiki_git.render_frontmatter('He said "hi"', "he-said-hi", "t1", "t2")
    fields, _ = wiki_git.parse_frontmatter(text)
    assert fields["title"] == 'He said "hi"'


def test_parse_frontmatter_returns_empty_fields_when_absent():
    fields, body = wiki_git.parse_frontmatter("just a body, no frontmatter")
    assert fields == {}
    assert body == "just a body, no frontmatter"


# --- commit_page ---


def test_commit_page_writes_file_and_returns_sha(data_dir):
    sha, path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=["engines"],
        slug="torque-specs",
        title="Torque Specs",
        content="Use 22 Nm.",
        created_at="2024-01-01 00:00:00",
        updated_at="2024-01-01 00:00:00",
        author="owner",
        note="created",
    )
    assert path == "wiki/engines/torque-specs.md"
    repo = wiki_git._repo_dir(data_dir)
    full = repo / path
    assert full.exists()
    assert "Use 22 Nm." in full.read_text()
    assert sha in _log(repo)


def test_commit_page_root_page_has_no_folder_segment(data_dir):
    _, path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    assert path == "wiki/oil-change.md"


def test_commit_page_message_contains_trailers(data_dir):
    sha, _ = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="assistant",
        note="drafted",
    )
    repo = wiki_git._repo_dir(data_dir)
    msg = _commit_message(repo, sha)
    assert msg.startswith("drafted")
    assert "wiki-author: assistant" in msg
    assert "wiki-slug: oil-change" in msg


def test_commit_page_identical_content_is_a_noop(data_dir):
    kwargs = dict(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    sha1, _ = wiki_git.commit_page(**kwargs)
    sha2, _ = wiki_git.commit_page(**kwargs)
    assert sha1 == sha2
    repo = wiki_git._repo_dir(data_dir)
    assert len(_log(repo)) == 1


def test_commit_page_move_relocates_file_in_one_commit(data_dir):
    sha1, old_path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=["engines"],
        slug="torque-specs",
        title="Torque Specs",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    sha2, new_path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=["motors"],
        slug="torque-specs",
        title="Torque Specs",
        content="body",
        created_at="t1",
        updated_at="t2",
        author="owner",
        note="moved to a different folder",
        old_relative_path=old_path,
    )
    assert sha1 != sha2
    repo = wiki_git._repo_dir(data_dir)
    assert not (repo / old_path).exists()
    assert (repo / new_path).exists()
    assert len(_log(repo)) == 2


def test_commit_page_raises_git_commit_error_when_git_unavailable(data_dir, monkeypatch):
    def boom(args, **kwargs):
        raise OSError("git binary not found")

    monkeypatch.setattr(wiki_git, "_run_git", boom)
    with pytest.raises(wiki_git.GitCommitError):
        wiki_git.commit_page(
            data_dir=data_dir,
            folder_path_parts=[],
            slug="oil-change",
            title="Oil Change",
            content="body",
            created_at="t1",
            updated_at="t1",
            author="owner",
            note="created",
        )


# --- delete_page_file ---


def test_delete_page_file_removes_file_and_commits(data_dir):
    _, path = wiki_git.commit_page(
        data_dir=data_dir,
        folder_path_parts=[],
        slug="oil-change",
        title="Oil Change",
        content="body",
        created_at="t1",
        updated_at="t1",
        author="owner",
        note="created",
    )
    sha = wiki_git.delete_page_file(
        data_dir=data_dir, relative_path=path, author="owner", note="deleted"
    )
    repo = wiki_git._repo_dir(data_dir)
    assert not (repo / path).exists()
    msg = _commit_message(repo, sha)
    assert "deleted" in msg
    assert "wiki-author: owner" in msg
