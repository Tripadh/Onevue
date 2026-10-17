"""Unit tests for alternative PDF backends and compare_pdf_backends.py.

Guarantees:
- Uses 100% synthetic fixtures generated in memory.
- Validates PyPDFium2Parser extraction, error mapping, and limitations reporting.
- Validates Settings PDF_BACKEND configuration and default (pymupdf).
- Validates comparison script metrics calculation and privacy redaction.
- No live provider or network calls.
"""

from unittest.mock import patch

import pymupdf
import pytest

from app.config import Settings
from app.extraction.pdf import PDFExtractionError
from app.extraction.pdfium_backend import PyPDFium2Parser
from app.schemas.errors import ErrorCode
from scripts.compare_pdf_backends import (
    compare_backends_on_content,
    format_comparison_report,
    generate_synthetic_comparison_pdf,
    main,
)


class TestPyPDFium2BackendFunctionality:
    """Test PyPDFium2Parser behavior and error code mapping."""

    @pytest.fixture
    def synthetic_pdf_bytes(self) -> bytes:
        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_text(
            (50, 72), "Jordan Doe\nSenior Systems Architect\nPython, Linux"
        )
        b = doc.tobytes()
        doc.close()
        return b

    def test_successful_extraction_and_metadata(self, synthetic_pdf_bytes):
        parser = PyPDFium2Parser()
        res = parser.extract(synthetic_pdf_bytes)

        assert res.page_count == 1
        assert "Jordan Doe" in res.text
        assert "Senior Systems Architect" in res.text
        assert res.metadata["parser"] == "pypdfium2"
        assert res.metadata["hyperlinks_supported"] is False
        assert "limitation" in res.metadata

    def test_corrupted_pdf_raises_sanitized_error(self):
        parser = PyPDFium2Parser()
        with pytest.raises(PDFExtractionError) as exc_info:
            parser.extract(b"NOT A REAL PDF DOCUMENT")

        assert exc_info.value.code == ErrorCode.INVALID_FILE
        assert "corrupted or not a valid PDF" in exc_info.value.message

    def test_encrypted_pdf_raises_sanitized_error(self):
        doc = pymupdf.open()
        p = doc.new_page()
        p.insert_text((50, 72), "Encrypted content")
        enc_bytes = doc.tobytes(
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            user_pw="password123",
            owner_pw="owner123",
        )
        doc.close()

        parser = PyPDFium2Parser()
        with pytest.raises(PDFExtractionError) as exc_info:
            parser.extract(enc_bytes)

        assert exc_info.value.code == ErrorCode.ENCRYPTED_PDF
        assert "encrypted or password-protected" in exc_info.value.message

    def test_scanned_or_empty_pdf_raises_scanned_error(self):
        doc = pymupdf.open()
        doc.new_page()  # Page with zero text
        empty_bytes = doc.tobytes()
        doc.close()

        parser = PyPDFium2Parser()
        with pytest.raises(PDFExtractionError) as exc_info:
            parser.extract(empty_bytes)

        assert exc_info.value.code == ErrorCode.SCANNED_PDF
        assert "no extractable text" in exc_info.value.message

    def test_page_limit_enforced(self, synthetic_pdf_bytes):
        parser = PyPDFium2Parser()
        with pytest.raises(PDFExtractionError) as exc_info:
            parser.extract(synthetic_pdf_bytes, max_pages=0)

        assert exc_info.value.code == ErrorCode.TOO_MANY_PAGES


class TestPdfBackendConfiguration:
    """Test Settings PDF_BACKEND configuration and defaults."""

    def test_default_pdf_backend_is_pymupdf(self):
        settings = Settings(
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert settings.PDF_BACKEND == "pymupdf"

    def test_can_configure_pypdfium2_backend(self):
        settings = Settings(
            PDF_BACKEND="pypdfium2",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert settings.PDF_BACKEND == "pypdfium2"

    def test_rejects_unsupported_pdf_backend(self):
        with pytest.raises(ValueError, match="Unsupported PDF_BACKEND"):
            Settings(
                PDF_BACKEND="unsupported_lib",
                SERVICE_API_KEYS="sec-key",
                METRICS_TOKEN="test-metrics-token",
            )


class TestComparePdfBackendsScript:
    """Test comparison tool metrics calculation and privacy guarantees."""

    def test_compare_backends_on_synthetic_content(self):
        pdf_bytes = generate_synthetic_comparison_pdf()
        results = compare_backends_on_content(pdf_bytes)

        mu = results["pymupdf"]
        pdfium = results["pypdfium2"]
        comp = results["comparison"]

        assert mu["success"] is True
        assert pdfium["success"] is True
        assert mu["links_count"] >= 1
        assert pdfium["links_count"] == 0  # Expected limitation of pypdfium2
        assert mu["license"] == "AGPL-3.0 / Commercial"
        assert pdfium["license"] == "Apache-2.0 / BSD-3-Clause"
        assert comp["word_overlap_ratio"] > 0.9
        assert comp["sequence_similarity_ratio"] >= 0.1

    def test_format_comparison_report_does_not_leak_document_text(self, capsys):
        pdf_bytes = generate_synthetic_comparison_pdf()
        results = compare_backends_on_content(pdf_bytes)

        format_comparison_report(results, is_synthetic=True)
        captured = capsys.readouterr()

        # Check table structure
        assert "PyMuPDF" in captured.out
        assert "PyPDFium2" in captured.out
        assert "AGPL-3.0" in captured.out
        assert "Apache-2.0" in captured.out
        assert "Text Content Logged : NONE" in captured.out

        # Ensure raw body text is never printed
        assert "Engineered microservices handling 50k" not in captured.out

    def test_local_pdf_path_requires_explicit_confirmation(self, tmp_path, capsys):
        fake_pdf = tmp_path / "test.pdf"
        fake_pdf.write_bytes(b"%PDF-1.4...")

        with patch(
            "sys.argv", ["compare_pdf_backends.py", "--pdf-path", str(fake_pdf)]
        ):
            code = main()
            assert code == 2

        captured = capsys.readouterr()
        assert "[SAFETY HALT]" in captured.err
        assert "--i-confirm-authorized-document" in captured.err
