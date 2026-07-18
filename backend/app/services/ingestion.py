"""Text extraction for uploaded sources. Extracted text is DATA, never
instructions — downstream prompt assembly must keep it fenced."""

import io
from pathlib import PurePosixPath

import trafilatura
from pypdf import PdfReader


class UnsupportedFileType(Exception):
    pass


def _suffix(filename: str) -> str:
    return PurePosixPath(filename.lower()).suffix


def extract_text(filename: str, content_type: str, data: bytes) -> str:
    suffix = _suffix(filename)
    if suffix == ".pdf" or content_type == "application/pdf":
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    if suffix in (".html", ".htm") or content_type == "text/html":
        text = trafilatura.extract(
            data.decode("utf-8", errors="replace"), favor_precision=True
        )
        if not text:
            raise UnsupportedFileType(f"no extractable content in {filename}")
        return text.strip()
    if suffix in (".txt", ".md") or content_type.startswith("text/"):
        return data.decode("utf-8", errors="replace")
    raise UnsupportedFileType(f"unsupported file type: {filename}")
