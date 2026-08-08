"""Archives a fetched web page as a document and builds its wiki footnote.

Archiving comes first: a footnote referencing a document that does not exist
is worse than no footnote, so the endpoint only returns one after the write
succeeds.

Page bodies are DATA, never instructions — they are stored verbatim and the
grounding fence is applied at prompt-assembly time, like every other source.
"""

import re
from urllib.parse import urlparse

from app.db import store

WEB_COLLECTION_NAME = "Web"

# Search engines fall back to the post body as the title for pages with no
# usable <title> (Reddit, Facebook), and cut it off with an ellipsis.
_TRUNCATED = ("...", "…")


def resolve_title(search_title: str, content: str, url: str) -> str:
    """A document named mid-sentence is a bad citation, so a truncated search
    title is replaced: first by the page's own H1, then by the URL itself."""
    title = " ".join(search_title.split())
    if title and not title.endswith(_TRUNCATED):
        return title

    for line in content.split("\n"):
        heading = re.match(r"^#\s+(.+)", line.strip())
        if heading:
            candidate = " ".join(heading.group(1).split())
            if candidate:
                return candidate

    parsed = urlparse(url)
    # Walk back past trailing numeric ids (post ids, comment ids), which name
    # nothing — the readable slug sits just before them.
    segments = [s for s in parsed.path.split("/") if s]
    slug = ""
    for segment in reversed(segments):
        if not segment.isdigit():
            slug = segment.replace("-", " ").replace("_", " ")
            break
    host = parsed.netloc or url
    return f"{host}: {slug}".strip(": ") if slug else host


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
    title = resolve_title(title, content, url)
    document = store.upsert_web_document(collection["id"], url, title, content)
    fetched_at = (document["fetched_at"] or "")[:10]
    return {
        "document": document,
        "footnote": build_footnote(
            1, title, url, build_excerpt(content, excerpt), fetched_at
        ),
    }
