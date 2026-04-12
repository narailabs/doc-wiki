"""Tests for extract_binary.py — written BEFORE implementation (TDD).

Binary extraction libraries (pymupdf, python-docx, python-pptx) may not be
installed.  Tests that require them use ``pytest.importorskip`` and will be
skipped gracefully when the library is unavailable.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from extract_binary import extract

SCRIPT = str(Path(__file__).resolve().parent.parent / "extract_binary.py")

# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def sample_pdf(tmp_path):
    """Create a minimal PDF with pymupdf.  Skips if unavailable."""
    fitz = pytest.importorskip("fitz")
    pdf_path = tmp_path / "sample.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Hello from PDF page 1")
    page2 = doc.new_page()
    page2.insert_text((72, 72), "Content on page 2")
    doc.save(str(pdf_path))
    doc.close()
    return str(pdf_path)


@pytest.fixture
def sample_docx(tmp_path):
    """Create a minimal DOCX with python-docx.  Skips if unavailable."""
    docx_mod = pytest.importorskip("docx")
    docx_path = tmp_path / "sample.docx"
    doc = docx_mod.Document()
    doc.add_heading("Main Heading", level=1)
    doc.add_paragraph("First paragraph of the document.")
    doc.add_heading("Sub Heading", level=2)
    doc.add_paragraph("Second paragraph with more content.")
    doc.save(str(docx_path))
    return str(docx_path)


@pytest.fixture
def sample_pptx(tmp_path):
    """Create a minimal PPTX with python-pptx.  Skips if unavailable."""
    pptx_mod = pytest.importorskip("pptx")
    pptx_path = tmp_path / "sample.pptx"
    prs = pptx_mod.Presentation()
    # Slide 1
    slide1 = prs.slides.add_slide(prs.slide_layouts[1])
    slide1.shapes.title.text = "Slide 1 Title"
    slide1.placeholders[1].text = "Slide 1 body text"
    # Slide 2
    slide2 = prs.slides.add_slide(prs.slide_layouts[1])
    slide2.shapes.title.text = "Slide 2 Title"
    slide2.placeholders[1].text = "Slide 2 body text"
    prs.save(str(pptx_path))
    return str(pptx_path)


@pytest.fixture
def empty_pdf(tmp_path):
    """Create a PDF with no text content."""
    fitz = pytest.importorskip("fitz")
    pdf_path = tmp_path / "empty.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(pdf_path))
    doc.close()
    return str(pdf_path)


@pytest.fixture
def empty_docx(tmp_path):
    """Create a DOCX with no paragraphs."""
    docx_mod = pytest.importorskip("docx")
    docx_path = tmp_path / "empty.docx"
    doc = docx_mod.Document()
    doc.save(str(docx_path))
    return str(docx_path)


@pytest.fixture
def empty_pptx(tmp_path):
    """Create a PPTX with one blank slide."""
    pptx_mod = pytest.importorskip("pptx")
    pptx_path = tmp_path / "empty.pptx"
    prs = pptx_mod.Presentation()
    prs.slides.add_slide(prs.slide_layouts[6])  # blank layout
    prs.save(str(pptx_path))
    return str(pptx_path)


# ── General extraction tests ────────────────────────────────────────


class TestExtract:
    def test_extract_pdf(self, sample_pdf):
        """Extract text from a PDF."""
        result = extract(sample_pdf)
        assert "Hello from PDF page 1" in result

    def test_extract_docx(self, sample_docx):
        """Extract text from a DOCX."""
        result = extract(sample_docx)
        assert "First paragraph" in result

    def test_extract_pptx(self, sample_pptx):
        """Extract text from a PPTX."""
        result = extract(sample_pptx)
        assert "Slide 1" in result

    def test_auto_detect_format(self, sample_pdf):
        """extract() auto-detects format from file extension."""
        result = extract(sample_pdf)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_unsupported_format(self, tmp_path):
        """Unsupported file extension raises ValueError."""
        bad_file = tmp_path / "file.xyz"
        bad_file.write_text("data")
        with pytest.raises(ValueError, match="Unsupported"):
            extract(str(bad_file))


# ── PDF-specific tests ──────────────────────────────────────────────


class TestExtractPdf:
    def test_multipage(self, sample_pdf):
        """Multi-page PDF extracts text from all pages."""
        result = extract(sample_pdf)
        assert "page 1" in result
        assert "page 2" in result

    def test_returns_markdown(self, sample_pdf):
        """Output is a string (markdown text)."""
        result = extract(sample_pdf)
        assert isinstance(result, str)

    def test_empty_pdf(self, empty_pdf):
        """Empty PDF returns a string (possibly empty)."""
        result = extract(empty_pdf)
        assert isinstance(result, str)


# ── DOCX-specific tests ────────────────────────────────────────────


class TestExtractDocx:
    def test_paragraphs(self, sample_docx):
        """Multiple paragraphs are captured."""
        result = extract(sample_docx)
        assert "First paragraph" in result
        assert "Second paragraph" in result

    def test_headings(self, sample_docx):
        """Headings are converted to markdown # headers."""
        result = extract(sample_docx)
        assert "# Main Heading" in result or "## Sub Heading" in result

    def test_empty_docx(self, empty_docx):
        """Empty DOCX returns a string."""
        result = extract(empty_docx)
        assert isinstance(result, str)


# ── PPTX-specific tests ────────────────────────────────────────────


class TestExtractPptx:
    def test_slides_labeled(self, sample_pptx):
        """Slides produce labeled output."""
        result = extract(sample_pptx)
        assert "Slide 1" in result
        assert "Slide 2" in result

    def test_text_frames(self, sample_pptx):
        """Text from text frames is captured."""
        result = extract(sample_pptx)
        assert "body text" in result

    def test_empty_pptx(self, empty_pptx):
        """Empty PPTX returns a string."""
        result = extract(empty_pptx)
        assert isinstance(result, str)


# ── CLI tests ──────────────────────────────────────────────────────


class TestExtractBinaryCLI:
    def test_cli_extract(self, sample_pdf):
        """CLI outputs markdown to stdout."""
        result = subprocess.run(
            [sys.executable, SCRIPT, sample_pdf],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "Hello from PDF" in result.stdout

    def test_cli_with_format(self, sample_pdf):
        """CLI --format flag forces format detection."""
        result = subprocess.run(
            [sys.executable, SCRIPT, sample_pdf, "--format", "pdf"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert len(result.stdout) > 0
