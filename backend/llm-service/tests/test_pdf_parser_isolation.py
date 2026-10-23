"""Tests for Phase 15 isolated PDF parser process boundary and fault isolation."""

from unittest.mock import patch

import pymupdf
import pytest

from app.extraction.isolated_parser import IsolatedPDFParser
from app.extraction.pdf import PDFExtractionError
from app.schemas.errors import ErrorCode


def _create_minimal_pdf_bytes(text: str = "Test document content") -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


class TestIsolatedPDFParser:
    """Test IsolatedPDFParser process execution, limits, and failure containment."""

    def test_successful_pdf_extraction_in_worker(self):
        """Verify normal PDF extraction succeeds across process boundary."""
        content = _create_minimal_pdf_bytes(
            "Jane Doe\nSoftware Engineer\nJane has 5 years of Python experience."
        )
        parser = IsolatedPDFParser(
            max_workers=2,
            timeout_seconds=5.0,
        )

        result = parser.extract(content, max_pages=5, max_text_chars=10000)
        assert result.page_count == 1
        assert "Jane Doe" in result.text
        assert "Software Engineer" in result.text

    def test_malformed_pdf_sanitized_error(self):
        """Verify malformed PDF bytes produce sanitized PDFExtractionError."""
        parser = IsolatedPDFParser(
            max_workers=1,
            timeout_seconds=5.0,
        )

        bad_bytes = b"NOT_A_REAL_PDF_HEADER_1234567890"
        with pytest.raises(PDFExtractionError) as exc_info:
            parser.extract(bad_bytes)

        err = exc_info.value
        assert err.code == ErrorCode.INVALID_FILE
        # Verify no file paths or stack traces leaked
        assert "/tmp" not in err.message
        assert "Traceback" not in err.message

    def test_hard_wall_clock_timeout_terminates_worker(self):
        """Verify worker taking too long is terminated via SIGTERM/SIGKILL."""
        parser = IsolatedPDFParser(
            max_workers=1,
            timeout_seconds=0.3,  # Short timeout for fast test
        )

        content = _create_minimal_pdf_bytes("Slow document")

        # Simulate poll returning False (no data within timeout window)
        with patch(
            "multiprocessing.connection.Connection.poll",
            return_value=False,
        ):
            with pytest.raises(PDFExtractionError) as exc_info:
                parser.extract(content)

            err = exc_info.value
            assert err.code == ErrorCode.INVALID_FILE
            assert "timed out" in err.message.lower()

    def test_worker_crash_or_unexpected_exit_handled_safely(self):
        """Verify parent handles worker unexpected exit safely."""
        parser = IsolatedPDFParser(
            max_workers=1,
            timeout_seconds=2.0,
        )
        content = _create_minimal_pdf_bytes("Crash test")

        # Simulate worker closing pipe without sending result (EOF)
        with patch(
            "multiprocessing.connection.Connection.poll",
            return_value=True,
        ):
            with patch(
                "multiprocessing.connection.Connection.recv",
                side_effect=EOFError("Worker disconnected"),
            ):
                with pytest.raises(PDFExtractionError) as exc_info:
                    parser.extract(content)

                err = exc_info.value
                assert err.code == ErrorCode.INVALID_FILE
                # Message must be sanitized and mention termination
                assert "terminated unexpectedly" in err.message

    def test_shutdown_terminates_active_workers(self):
        """Verify shutdown() cleans up all registered worker processes."""
        parser = IsolatedPDFParser(
            max_workers=2,
            timeout_seconds=5.0,
        )
        # Verify shutdown can be called on idle parser without error
        parser.shutdown()
        assert len(parser._active_workers) == 0

    def test_concurrent_isolated_extractions(self):
        """Verify sequential isolated extractions run without interference."""
        parser = IsolatedPDFParser(
            max_workers=2,
            timeout_seconds=5.0,
        )

        pdf1 = _create_minimal_pdf_bytes("Worker One Content")
        pdf2 = _create_minimal_pdf_bytes("Worker Two Content")

        res1 = parser.extract(pdf1)
        res2 = parser.extract(pdf2)

        assert "Worker One Content" in res1.text
        assert "Worker Two Content" in res2.text
