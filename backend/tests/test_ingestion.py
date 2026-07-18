import io

import pytest
from pypdf import PdfWriter

from app.services.ingestion import UnsupportedFileType, extract_text


def make_pdf_bytes() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_plaintext_and_markdown_decode():
    assert extract_text("a.txt", "text/plain", "hello".encode()) == "hello"
    assert extract_text("a.md", "", b"# Title") == "# Title"


def test_pdf_extracts_without_error():
    # a blank page extracts to empty text but must not raise
    assert extract_text("a.pdf", "application/pdf", make_pdf_bytes()) == ""


def test_html_extracts_main_content():
    html = (
        b"<html><head><title>t</title></head><body><nav>menu</nav>"
        b"<article><p>The torque spec is 22 Nm and must be applied in "
        b"three passes following the spiral sequence.</p></article></body></html>"
    )
    text = extract_text("page.html", "text/html", html)
    assert "torque spec is 22" in text
    assert "menu" not in text


def test_unknown_type_raises():
    with pytest.raises(UnsupportedFileType):
        extract_text("a.exe", "application/octet-stream", b"\x00")
