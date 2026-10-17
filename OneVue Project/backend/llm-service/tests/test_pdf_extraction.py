"""Unit tests for PDF validation, extraction, layout sorting, and links."""

from unittest.mock import patch

import pymupdf
import pytest

from app.extraction.pdf import (
    PDFExtractionError,
    PDFExtractionResult,
    PDFLink,
    extract_pdf,
)
from app.schemas.errors import ErrorCode

# =====================================================================
# Synthetic PDF Fixture Generators (Pure In-Memory PyMuPDF)
# =====================================================================


def _make_simple_pdf(text: str = "Simple candidate resume content.") -> bytes:
    """Create a basic single-page synthetic PDF with plain text."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 72), text, fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_multipage_pdf(pages_text: list[str]) -> bytes:
    """Create a multi-page synthetic PDF."""
    doc = pymupdf.open()
    for text in pages_text:
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 72), text, fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_empty_pdf() -> bytes:
    """Create a PDF with pages but completely devoid of text (e.g. scanned)."""
    doc = pymupdf.open()
    doc.new_page(width=595, height=842)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_encrypted_pdf(password: str = "topsecret") -> bytes:
    """Create a password-protected encrypted synthetic PDF."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 72), "Confidential Resume Data", fontsize=12)
    pdf_bytes = doc.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw=password,
        owner_pw="adminpass",
    )
    doc.close()
    return pdf_bytes


def _make_twocolumn_pdf(
    header: str,
    left_lines: list[str],
    right_lines: list[str],
) -> bytes:
    """Create a two-column synthetic PDF with interleaved insertion order."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)

    # Full-width header
    page.insert_text((50, 50), header, fontsize=14)

    # Interleaved insertion to test coordinate-aware reading order
    max_len = max(len(left_lines), len(right_lines))
    for i in range(max_len):
        y_pos = 100 + (i * 25)
        if i < len(left_lines):
            page.insert_text((50, y_pos), left_lines[i], fontsize=10)
        if i < len(right_lines):
            page.insert_text((350, y_pos), right_lines[i], fontsize=10)

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_hyperlink_pdf(
    links: list[tuple[str, str, int]],
    base_text: str = "Candidate Profile Links",
) -> bytes:
    """Create a synthetic PDF with visible or hidden anchor-text hyperlinks.

    links: list of tuples (url, anchor_text, page_index_0_based)
    """
    doc = pymupdf.open()
    max_page = max(item[2] for item in links) if links else 0
    for _ in range(max_page + 1):
        doc.new_page(width=600, height=800)

    for idx, (url, anchor_text, p_idx) in enumerate(links):
        page = doc[p_idx]
        y_pos = 100 + (idx * 40)
        rect = pymupdf.Rect(50, y_pos - 15, 250, y_pos + 5)
        page.insert_text((50, y_pos), anchor_text, fontsize=11)
        page.insert_link(
            {
                "kind": pymupdf.LINK_URI,
                "from": rect,
                "uri": url,
            }
        )

    # Insert base text on first page
    doc[0].insert_text((50, 50), base_text, fontsize=14)

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


# =====================================================================
# 1. FILE VALIDATION & SAFETY LIMITS TESTS
# =====================================================================


class TestPDFValidationAndLimits:
    """Test suite for file validation, encryption, limits, and resource handling."""

    def test_valid_pdf_extraction(self):
        """Verify successful extraction from a valid PDF."""
        content = _make_simple_pdf("Ada Lovelace - Mathematician")
        result = extract_pdf(content)

        assert isinstance(result, PDFExtractionResult)
        assert result.page_count == 1
        assert "Ada Lovelace - Mathematician" in result.text
        assert len(result.pages) == 1

    def test_invalid_bytes_not_a_pdf(self):
        """Verify rejection of bytes lacking PDF signature with INVALID_FILE."""
        not_pdf = b"Plain text file content, not a PDF document."
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(not_pdf)
        assert exc_info.value.code == ErrorCode.INVALID_FILE

    def test_corrupted_pdf_rejected(self):
        """Verify corrupted PDF bytes are rejected with INVALID_FILE."""
        corrupt = b"%PDF-1.4\nCorrupted garbage data \x00\xff\xfe\x00\x00\x00\x00"
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(corrupt)
        assert exc_info.value.code == ErrorCode.INVALID_FILE

    def test_encrypted_pdf_rejected(self):
        """Verify encrypted/password-protected PDFs are rejected with ENCRYPTED_PDF."""
        encrypted = _make_encrypted_pdf(password="secret123")
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(encrypted)
        assert exc_info.value.code == ErrorCode.ENCRYPTED_PDF
        assert "encrypted or password-protected" in exc_info.value.message

    def test_exceeding_byte_limit_rejected_early(self):
        """Verify files exceeding max_bytes are rejected early with FILE_TOO_LARGE."""
        content = _make_simple_pdf("Short text")
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(content, max_bytes=100)  # Very low byte limit
        assert exc_info.value.code == ErrorCode.FILE_TOO_LARGE

    def test_exceeding_page_limit_rejected(self):
        """Verify PDFs exceeding max_pages are rejected with TOO_MANY_PAGES."""
        content = _make_multipage_pdf(["Page 1", "Page 2", "Page 3", "Page 4"])
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(content, max_pages=2)
        assert exc_info.value.code == ErrorCode.TOO_MANY_PAGES
        assert "4 pages" in exc_info.value.message

    def test_page_limit_checked_before_text_extraction(self):
        """Verify page count validation occurs prior to page text extraction."""
        content = _make_multipage_pdf(["Page 1", "Page 2", "Page 3"])

        with patch(
            "app.extraction.pdf._extract_page_text_column_aware"
        ) as mock_extract:
            with pytest.raises(PDFExtractionError) as exc_info:
                extract_pdf(content, max_pages=1)
            assert exc_info.value.code == ErrorCode.TOO_MANY_PAGES
            mock_extract.assert_not_called()

    def test_scanned_or_image_only_pdf_rejected(self):
        """Verify PDFs without extractable text are rejected with SCANNED_PDF."""
        content = _make_empty_pdf()
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(content)
        assert exc_info.value.code == ErrorCode.SCANNED_PDF
        assert "OCR is disabled" in exc_info.value.message

    def test_exceeding_text_character_limit_rejected(self):
        """Verify PDFs exceeding max_text_chars raise typed error with INVALID_FILE."""
        content = _make_simple_pdf(
            "Long resume text exceeding our strict test character threshold."
        )
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(content, max_text_chars=20)
        assert exc_info.value.code == ErrorCode.INVALID_FILE
        assert "exceeds the maximum allowed limit" in exc_info.value.message

    def test_resources_closed_on_success_and_failure(self):
        """Verify PyMuPDF Document resources are closed in both cases."""
        content_ok = _make_simple_pdf("Resource cleanup test")
        closed_flags: list[bool] = []

        orig_open = pymupdf.open

        def tracked_open(*args, **kwargs):
            doc = orig_open(*args, **kwargs)
            orig_close = doc.close

            def tracked_close():
                closed_flags.append(True)
                return orig_close()

            doc.close = tracked_close
            return doc

        with patch("pymupdf.open", side_effect=tracked_open):
            # 1. Success case
            extract_pdf(content_ok)
            assert len(closed_flags) == 1

            # 2. Failure case (character limit exceeded)
            with pytest.raises(PDFExtractionError):
                extract_pdf(content_ok, max_text_chars=5)
            assert len(closed_flags) == 2


# =====================================================================
# 2. TEXT EXTRACTION & LAYOUT TESTS
# =====================================================================


class TestPDFTextAndLayout:
    """Test suite for reading order, column handling, and page preservation."""

    def test_single_column_extraction(self):
        """Verify top-to-bottom reading order for standard single-column text."""
        lines = [
            "Jane Doe - Software Engineer",
            "EXPERIENCE",
            "Staff Engineer at Anthropic (2022 - Present)",
            "Senior Engineer at Google (2018 - 2022)",
        ]
        doc = pymupdf.open()
        page = doc.new_page(width=595, height=842)
        for idx, line in enumerate(lines):
            page.insert_text((50, 50 + idx * 30), line, fontsize=11)
        pdf_bytes = doc.tobytes()
        doc.close()

        result = extract_pdf(pdf_bytes)
        assert "Jane Doe - Software Engineer" in result.text
        assert "Staff Engineer at Anthropic" in result.text
        idx_jane = result.text.index("Jane Doe")
        idx_staff = result.text.index("Staff Engineer")
        idx_senior = result.text.index("Senior Engineer")
        assert idx_jane < idx_staff < idx_senior

    def test_two_column_reading_order(self):
        """Verify coordinate-aware extraction reads left column before right column."""
        header = "Alex Mercer - Principal Architect"
        left_col = [
            "TECHNICAL SKILLS",
            "Python, FastAPI, C++",
            "Docker, Kubernetes",
            "PostgreSQL, Redis",
        ]
        right_col = [
            "PROFESSIONAL EXPERIENCE",
            "Principal Architect - Cloud Corp",
            "Designed high-throughput streaming systems.",
            "Led architecture transition to microservices.",
        ]

        pdf_bytes = _make_twocolumn_pdf(header, left_col, right_col)
        result = extract_pdf(pdf_bytes)

        # Header must be at top
        assert result.text.startswith(header)

        # Left column items must appear before right column items
        idx_skills = result.text.index("TECHNICAL SKILLS")
        idx_postgres = result.text.index("PostgreSQL, Redis")
        idx_experience = result.text.index("PROFESSIONAL EXPERIENCE")
        idx_streaming = result.text.index("Designed high-throughput streaming systems.")

        assert idx_skills < idx_postgres < idx_experience < idx_streaming, (
            "Expected complete Left Column to precede Right Column"
        )

    def test_multipage_extraction_preserves_boundaries(self):
        """Verify extraction across multiple pages preserves separate page entries."""
        page_1_text = "Page 1: Profile and Skills"
        page_2_text = "Page 2: Projects and Achievements"

        pdf_bytes = _make_multipage_pdf([page_1_text, page_2_text])
        result = extract_pdf(pdf_bytes)

        assert result.page_count == 2
        assert len(result.pages) == 2
        assert result.pages[0].page_number == 1
        assert "Profile and Skills" in result.pages[0].text
        assert result.pages[1].page_number == 2
        assert "Projects and Achievements" in result.pages[1].text

    def test_deterministic_extraction(self):
        """Verify repeated extraction on the same fixture produces identical output."""
        pdf_bytes = _make_twocolumn_pdf(
            "Deterministic Candidate",
            ["Skills A", "Skills B"],
            ["Work X", "Work Y"],
        )
        res1 = extract_pdf(pdf_bytes)
        res2 = extract_pdf(pdf_bytes)

        assert res1.text == res2.text
        assert res1.page_count == res2.page_count
        assert len(res1.links) == len(res2.links)


# =====================================================================
# 3. HYPERLINK ANNOTATION EXTRACTION TESTS
# =====================================================================


class TestPDFHyperlinkExtraction:
    """Test suite for extracting hyperlink annotations and anchor text."""

    def test_visible_hyperlink(self):
        """Verify visible URL annotations are extracted."""
        url = "https://github.com/onevue-project"
        pdf_bytes = _make_hyperlink_pdf([(url, url, 0)])
        result = extract_pdf(pdf_bytes)

        assert len(result.links) == 1
        assert result.links[0].url == url
        assert result.links[0].page == 1

    def test_hidden_anchor_text_hyperlink(self):
        """Verify links hidden behind descriptive labels recover anchor text."""
        url = "https://linkedin.com/in/alex-dev"
        anchor = "LinkedIn Profile"
        pdf_bytes = _make_hyperlink_pdf([(url, anchor, 0)])
        result = extract_pdf(pdf_bytes)

        assert len(result.links) == 1
        link = result.links[0]
        assert link.url == url
        assert link.page == 1
        assert link.anchor_text is not None
        assert "LinkedIn Profile" in link.anchor_text

    def test_multiple_links_on_one_page(self):
        """Verify multiple distinct links on a single page are all captured."""
        links = [
            ("https://github.com/user", "GitHub", 0),
            ("https://portfolio.dev", "Portfolio", 0),
            ("https://linkedin.com/in/user", "LinkedIn", 0),
        ]
        pdf_bytes = _make_hyperlink_pdf(links)
        result = extract_pdf(pdf_bytes)

        assert len(result.links) == 3
        extracted_urls = {link.url for link in result.links}
        assert extracted_urls == {
            "https://github.com/user",
            "https://portfolio.dev",
            "https://linkedin.com/in/user",
        }

    def test_links_on_different_pages(self):
        """Verify links on distinct pages record 1-based page numbers."""
        links = [
            ("https://github.com/user", "GitHub", 0),  # Page 1
            ("https://paper.archive.org/123", "Research Paper", 1),  # Page 2
        ]
        pdf_bytes = _make_hyperlink_pdf(links)
        result = extract_pdf(pdf_bytes)

        assert len(result.links) == 2
        assert result.links[0].page == 1
        assert result.links[1].page == 2

    def test_duplicate_links_deduplicated(self):
        """Verify identical URLs are deduplicated across the document."""
        duplicate_url = "https://github.com/shared-repo"
        links = [
            (duplicate_url, "Project 1 Repo", 0),
            (duplicate_url, "Project 2 Repo", 0),
        ]
        pdf_bytes = _make_hyperlink_pdf(links)
        result = extract_pdf(pdf_bytes)

        assert len(result.links) == 1
        assert result.links[0].url == duplicate_url

    def test_no_link_pdf(self):
        """Verify PDF with no link annotations returns empty links list."""
        pdf_bytes = _make_simple_pdf("Resume without hyperlinks")
        result = extract_pdf(pdf_bytes)

        assert result.links == []
        assert isinstance(result.links, list)

    def test_ignores_non_web_annotations(self):
        """Verify internal target annotations (e.g. goto page) are excluded."""
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((50, 50), "Internal Document", fontsize=12)

        page.insert_link(
            {
                "kind": pymupdf.LINK_GOTO,
                "from": pymupdf.Rect(50, 100, 150, 120),
                "page": 0,
            }
        )
        page.insert_link(
            {
                "kind": pymupdf.LINK_URI,
                "from": pymupdf.Rect(50, 150, 250, 170),
                "uri": "https://example.com/web",
            }
        )
        pdf_bytes = doc.tobytes()
        doc.close()

        result = extract_pdf(pdf_bytes)
        assert len(result.links) == 1
        assert result.links[0].url == "https://example.com/web"


# =====================================================================
# 4. PARSER PROTOCOL INTERCHANGEABILITY TESTS
# =====================================================================


class TestParserInterchangeability:
    """Verify that custom parsers conforming to PDFParser protocol work."""

    def test_custom_parser_implementation(self):
        """Verify custom parser injection through the extract_pdf interface."""

        class MockCustomParser:
            def extract(
                self,
                content: bytes,
                *,
                max_pages: int | None = None,
                max_text_chars: int | None = None,
            ) -> PDFExtractionResult:
                return PDFExtractionResult(
                    text="Mock extracted text",
                    links=[PDFLink(url="https://mock.dev", page=1)],
                    page_count=1,
                    pages=[],
                    metadata={"parser": "mock"},
                )

        pdf_bytes = _make_simple_pdf("Real content")
        result = extract_pdf(pdf_bytes, parser=MockCustomParser())

        assert result.text == "Mock extracted text"
        assert result.metadata["parser"] == "mock"
        assert len(result.links) == 1
