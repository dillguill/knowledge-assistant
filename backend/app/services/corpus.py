"""Seeds the demo corpus on first boot so the deployed app is never empty."""

from pathlib import Path

from app.db import store

CORPUS_DIR = Path(__file__).resolve().parents[2] / "corpus"


def seed_demo_corpus() -> None:
    if store.list_collections():
        return
    col = store.create_collection("Demo corpus")
    for path in sorted(CORPUS_DIR.glob("*.md")):
        raw = path.read_bytes()
        store.add_document(col["id"], path.name, "text/markdown",
                           "corpus", raw, raw.decode("utf-8"))
