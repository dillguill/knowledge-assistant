"""One-time, owner-run migration: writes every wiki page's current content
into the git-native storage introduced in v0.4.5, as a single migration
commit. Not part of app boot — an explicit script run once against the live
data dir:

    cd backend && uv run python -m scripts.migrate_wiki_to_git

Refuses to re-run against a repo that already has commits unless --force,
to avoid accidentally duplicating history. Pre-migration wiki_versions/
wiki_proposals history is deliberately not backfilled into git — see
context/v0.4.5_wiki-git-enhancement.md.
"""

import argparse
import sys

from app.config import get_settings
from app.db import wiki_store
from app.services import wiki_git


def migrate(data_dir: str, *, force: bool = False) -> int:
    """Write every page's current content into the wiki git repo and make one
    combined migration commit. Returns the number of pages written."""
    if wiki_git.has_commits(data_dir) and not force:
        raise RuntimeError(
            "wiki git repo already has commits — pass --force to re-run anyway"
        )

    written = 0
    with wiki_store._connect() as conn:
        for summary in wiki_store.list_pages():
            page = wiki_store.get_page(summary["id"])
            if page is None:
                continue
            folder_parts = wiki_store._folder_path_parts(conn, page["folder_id"])
            wiki_git.write_page_file(
                data_dir,
                folder_parts,
                page["slug"],
                page["title"],
                page["content"],
                page["created_at"],
                page["updated_at"],
            )
            written += 1

    if written:
        wiki_git.commit_all(data_dir, "Migrate wiki pages to git-native storage")
    return written


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true",
        help="re-run even if the wiki git repo already has commits",
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    wiki_store.init_wiki(settings.data_dir)
    try:
        count = migrate(settings.data_dir, force=args.force)
    except RuntimeError as exc:
        print(f"Migration aborted: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print(f"Migrated {count} page(s) to {settings.data_dir}/wiki_git")


if __name__ == "__main__":
    main()
