"""Experimental PDF backend implementation using pypdfium2 (Google PDFium bindings).

ARCHITECTURAL & LICENSING EVALUATION CONTEXT:
1. Licensing:
   - pypdfium2 is licensed under Apache-2.0 and BSD-3-Clause (permissive).
   - This provides an alternative to PyMuPDF's AGPL-3.0 copyleft license.
2. Limitations:
   - High-level pypdfium2 bindings do not provide built-in hyperlink extraction
     or bounding-box anchor text clipping. Hyperlinks embedded in PDF annotations
     are therefore not extracted by this backend.
   - Text extraction in pypdfium2 uses sequential textpage reading order rather than
     PyMuPDF's coordinate-aware multi-column bounding-box sorting.
3. Status:
   - Experimental and disabled by default.
   - PyMuPDF remains the production default.
"""

import logging

from app.extraction.pdf import (
    PageExtraction,
    PDFExtractionError,
    PDFExtractionResult,
)
from app.schemas.errors import ErrorCode

logger = logging.getLogger(__name__)


class PyPDFium2Parser:
    """Alternative PDF parser implementation backed by pypdfium2."""

    def __init__(self) -> None:
        try:
            import pypdfium2 as pdfium  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "pypdfium2 is not installed. "
                "Install pypdfium2 to use this experimental backend."
            ) from exc

    def extract(
        self,
        content: bytes,
        *,
        max_pages: int | None = None,
        max_text_chars: int | None = None,
    ) -> PDFExtractionResult:
        """Extract text from raw PDF bytes using pypdfium2."""
        import pypdfium2 as pdfium

        # 1. Validate magic header signature
        if not content.startswith(b"%PDF"):
            raise PDFExtractionError(
                ErrorCode.INVALID_FILE,
                "Failed to parse PDF document. File is corrupted or not a valid PDF.",
            )

        # 2. Open document and handle encryption or corruption
        try:
            doc = pdfium.PdfDocument(content)
        except Exception as exc:
            err_str = str(exc).lower()
            if "password" in err_str:
                raise PDFExtractionError(
                    ErrorCode.ENCRYPTED_PDF,
                    "The PDF file is encrypted or password-protected. "
                    "Encrypted files are not supported.",
                ) from exc
            raise PDFExtractionError(
                ErrorCode.INVALID_FILE,
                "Failed to parse PDF document. File is corrupted or not a valid PDF.",
            ) from exc

        try:
            page_count = len(doc)
            if page_count == 0:
                raise PDFExtractionError(
                    ErrorCode.INVALID_FILE,
                    "The PDF document contains zero pages.",
                )

            if max_pages is not None and page_count > max_pages:
                raise PDFExtractionError(
                    ErrorCode.TOO_MANY_PAGES,
                    f"The PDF contains {page_count} pages, which exceeds the limit "
                    f"of {max_pages} pages.",
                )

            pages_extracted: list[PageExtraction] = []

            for page_idx in range(page_count):
                page_number = page_idx + 1
                try:
                    page = doc[page_idx]
                    textpage = page.get_textpage()
                    raw_page_text = textpage.get_text_range()
                    page_text = (
                        raw_page_text.replace("\r\n", "\n").replace("\r", "\n").strip()
                    )
                except Exception as exc:
                    raise PDFExtractionError(
                        ErrorCode.INVALID_FILE,
                        "Failed to extract content from PDF. "
                        "Document structure is corrupted or unreadable.",
                    ) from exc

                pages_extracted.append(
                    PageExtraction(
                        page_number=page_number,
                        text=page_text,
                        # pypdfium2 high-level API does not extract hyperlinks
                        links=[],
                    )
                )

            full_text = "\n\n".join(
                p.text for p in pages_extracted if p.text.strip()
            ).strip()

            if not full_text:
                raise PDFExtractionError(
                    ErrorCode.SCANNED_PDF,
                    "The PDF contains no extractable text. Scanned or image-only "
                    "documents are not supported as OCR is disabled.",
                )

            if max_text_chars is not None and len(full_text) > max_text_chars:
                raise PDFExtractionError(
                    ErrorCode.INVALID_FILE,
                    f"Extracted text length ({len(full_text)} characters) exceeds "
                    f"the maximum allowed limit of {max_text_chars} characters.",
                )

            return PDFExtractionResult(
                text=full_text,
                links=[],
                page_count=page_count,
                pages=pages_extracted,
                metadata={
                    "parser": "pypdfium2",
                    "page_count": page_count,
                    "links_count": 0,
                    "hyperlinks_supported": False,
                    "limitation": (
                        "Hyperlink annotations and coordinate-aware column sorting "
                        "are not supported in high-level pypdfium2."
                    ),
                },
            )

        finally:
            doc.close()
