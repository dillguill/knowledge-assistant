"""Archives a fetched web page as a document and builds its wiki footnote.

Archiving comes first: a footnote referencing a document that does not exist
is worse than no footnote, so the endpoint only returns one after the write
succeeds.

Page bodies are DATA, never instructions — they are stored verbatim and the
grounding fence is applied at prompt-assembly time, like every other source.
"""

from app.db import store

WEB_COLLECTION_NAME = "Web"


def build_excerpt(content: str, fallback: str, limit: int = 300) -> str:
    """The provider's own blurb when it has one; otherwise the head of the page
    body, trimmed back to a sentence boundary so it reads as a quotation."""
    if fallback.strip():
        return " ".join(fallback.split())
    text = " ".join(content.split())
    if len(text) <= limit:
        return text
    window = text[:limit]
    cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
    if cut > 0:
        return window[: cut + 1]
    return window.rstrip()


def build_footnote(
    index: int, title: str, url: str, excerpt: str, fetched_at: str
) -> str:
    """Markdown footnote: blockquoted excerpt, then the original link. The link
    targets the live page, not the archived copy — a reader following a citation
    wants the real source."""
    return (
        f"[^{index}]: > {excerpt}\n"
        f"    [{title}]({url}) — archived {fetched_at}"
    )


def archive(url: str, title: str, content: str, excerpt: str = "") -> dict:
    collection = store.get_or_create_collection(WEB_COLLECTION_NAME)
    document = store.upsert_web_document(collection["id"], url, title, content)
    fetched_at = (document["fetched_at"] or "")[:10]
    return {
        "document": document,
        "footnote": build_footnote(
            1, title, url, build_excerpt(content, excerpt), fetched_at
        ),
    }
