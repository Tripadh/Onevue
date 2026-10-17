"""PDF extraction interface, safety validation, and PyMuPDF parser."""

from collections.abc import Sequence
from typing import Any, Protocol
from urllib.parse import urlparse

import pymupdf
from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings
from app.schemas.errors import ErrorCode

_PDF_MAGIC_SIGNATURE = b"%PDF"

# Suppress MuPDF C-level stderr error output to prevent log pollution
if hasattr(pymupdf, "TOOLS") and hasattr(pymupdf.TOOLS, "mupdf_display_errors"):
    pymupdf.TOOLS.mupdf_display_errors(False)


class PDFExtractionError(Exception):
    """Exception raised when PDF validation, safety checks, or extraction fails.

    Attributes:
        code: ErrorCode enum identifying the nature of the extraction failure.
        message: Sanitized error description without raw document content or secrets.
    """

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class PDFLink(BaseModel):
    """Extracted hyperlink annotation from a PDF document."""

    model_config = ConfigDict(extra="forbid")

    url: str
    page: int = Field(description="1-based page number where the link is located.")
    anchor_text: str | None = Field(
        default=None,
        description="Visible text inside the link annotation rectangle, if recovered.",
    )


class PageExtraction(BaseModel):
    """Extracted text and link annotations for a single page."""

    model_config = ConfigDict(extra="forbid")

    page_number: int = Field(description="1-based page number.")
    text: str
    links: list[PDFLink] = Field(default_factory=list)


class PDFExtractionResult(BaseModel):
    """Typed result of extracting text and annotations from a PDF document."""

    model_config = ConfigDict(extra="forbid")

    text: str
    links: list[PDFLink] = Field(default_factory=list)
    page_count: int
    pages: list[PageExtraction] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PDFParser(Protocol):
    """Protocol defining the interchangeable PDF parser interface."""

    def extract(
        self,
        content: bytes,
        *,
        max_pages: int | None = None,
        max_text_chars: int | None = None,
    ) -> PDFExtractionResult:
        """Extract text and hyperlinks from raw PDF bytes."""
        ...


def _is_valid_annotation_uri(url: str) -> bool:
    """Validate that an annotation URI has a safe, allowed scheme.

    Supported safe schemes: http, https, mailto, tel.
    """
    if not url:
        return False
    try:
        parsed = urlparse(url)
        scheme = parsed.scheme.lower()
        if scheme in ("http", "https"):
            return bool(parsed.netloc)
        if scheme in ("mailto", "tel"):
            return bool(parsed.path)
        return False
    except Exception:
        return False


def _extract_page_links(
    page: pymupdf.Page,
    page_number: int,
) -> list[PDFLink]:
    """Extract and validate hyperlink annotations from a single page."""
    extracted_links: list[PDFLink] = []
    seen_urls: set[str] = set()

    try:
        raw_links = page.get_links()
    except Exception:
        return extracted_links

    for raw_link in raw_links:
        uri = (raw_link.get("uri") or "").strip()
        if not uri or not _is_valid_annotation_uri(uri):
            continue

        if uri in seen_urls:
            continue
        seen_urls.add(uri)

        # Recover visible anchor text within or immediately adjacent to link bbox
        anchor_text: str | None = None
        link_rect = raw_link.get("from")
        if link_rect:
            try:
                # Clip text directly within rect
                clip_text = (page.get_text("text", clip=link_rect) or "").strip()
                if not clip_text:
                    # Expand slightly by 2pt margin in case bbox is tight
                    expanded = pymupdf.Rect(
                        link_rect.x0 - 2,
                        link_rect.y0 - 2,
                        link_rect.x1 + 2,
                        link_rect.y1 + 2,
                    )
                    clip_text = (page.get_text("text", clip=expanded) or "").strip()

                if clip_text:
                    anchor_text = " ".join(clip_text.split())
                    if len(anchor_text) > 500:
                        anchor_text = anchor_text[:500]
            except Exception:
                anchor_text = None

        extracted_links.append(
            PDFLink(
                url=uri,
                page=page_number,
                anchor_text=anchor_text,
            )
        )

    return extracted_links


def _extract_page_text_column_aware(page: pymupdf.Page) -> str:
    """Extract page text using coordinate-aware sorting for multi-column layouts."""
    page_width = page.rect.width
    text_dict = page.get_text("dict")

    lines: list[tuple[float, float, float, float, str]] = []
    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:  # Text blocks only
            continue
        for line in block.get("lines", []):
            line_text = " ".join(
                (span.get("text") or "").strip()
                for span in line.get("spans", [])
                if (span.get("text") or "").strip()
            ).strip()
            if line_text:
                bbox = line.get("bbox")
                if bbox:
                    lines.append((bbox[0], bbox[1], bbox[2], bbox[3], line_text))

    if not lines:
        return ""

    # Classify lines by horizontal position
    left_lines: list[tuple[float, float, float, float, str]] = []
    right_lines: list[tuple[float, float, float, float, str]] = []
    full_width: list[tuple[float, float, float, float, str]] = []

    for item in lines:
        x0, y0, x1, y1, text = item
        width = x1 - x0
        center_x = (x0 + x1) / 2

        # A line spanning more than 60% of page or crossing both margins is full-width
        if width > 0.60 * page_width or (
            x0 < 0.40 * page_width and x1 > 0.60 * page_width
        ):
            full_width.append(item)
        elif center_x < 0.50 * page_width:
            left_lines.append(item)
        else:
            right_lines.append(item)

    # Detect if two columns coexist with vertical overlap
    has_two_columns = False
    if left_lines and right_lines:
        left_y_min = min(ln[1] for ln in left_lines)
        left_y_max = max(ln[3] for ln in left_lines)
        right_y_min = min(ln[1] for ln in right_lines)
        right_y_max = max(ln[3] for ln in right_lines)

        # Overlapping vertical range confirms multi-column body
        if max(left_y_min, right_y_min) < min(left_y_max, right_y_max):
            has_two_columns = True

    if not has_two_columns:
        # Standard single-column reading order: top-to-bottom, left-to-right
        sorted_lines = sorted(lines, key=lambda item: (item[1], item[0]))
        return _format_lines_into_blocks(sorted_lines)

    # Multi-column reading order
    col_y_start = min(min(ln[1] for ln in left_lines), min(ln[1] for ln in right_lines))
    col_y_end = max(max(ln[3] for ln in left_lines), max(ln[3] for ln in right_lines))

    headers = [ln for ln in full_width if ln[3] <= col_y_start + 10]
    footers = [ln for ln in full_width if ln[1] >= col_y_end - 10]
    mid_spans = [ln for ln in full_width if ln not in headers and ln not in footers]

    headers_sorted = sorted(headers, key=lambda item: (item[1], item[0]))
    left_sorted = sorted(left_lines, key=lambda item: (item[1], item[0]))
    right_sorted = sorted(right_lines, key=lambda item: (item[1], item[0]))
    mid_sorted = sorted(mid_spans, key=lambda item: (item[1], item[0]))
    footers_sorted = sorted(footers, key=lambda item: (item[1], item[0]))

    ordered_groups = [
        headers_sorted,
        left_sorted,
        right_sorted,
        mid_sorted,
        footers_sorted,
    ]
    block_texts = [
        _format_lines_into_blocks(group) for group in ordered_groups if group
    ]
    return "\n\n".join(b for b in block_texts if b)


def _format_lines_into_blocks(
    sorted_lines: Sequence[tuple[float, float, float, float, str]],
) -> str:
    """Format ordered lines into paragraph blocks based on line spacing."""
    if not sorted_lines:
        return ""

    blocks: list[list[str]] = []
    current_block: list[str] = [sorted_lines[0][4]]
    prev_y1 = sorted_lines[0][3]

    for line in sorted_lines[1:]:
        y0, y1, text = line[1], line[3], line[4]
        gap = y0 - prev_y1

        # A vertical gap greater than 14 points indicates a new section or paragraph
        if gap > 14:
            blocks.append(current_block)
            current_block = [text]
        else:
            current_block.append(text)
        prev_y1 = y1

    if current_block:
        blocks.append(current_block)

    return "\n\n".join("\n".join(block) for block in blocks)


class PyMuPDFParser:
    """Production PDF parser implementation using PyMuPDF (fitz)."""

    def extract(
        self,
        content: bytes,
        *,
        max_pages: int | None = None,
        max_text_chars: int | None = None,
    ) -> PDFExtractionResult:
        """Extract text and hyperlinks from PDF bytes using PyMuPDF."""
        try:
            doc = pymupdf.open(stream=content, filetype="pdf")
        except Exception as exc:
            raise PDFExtractionError(
                ErrorCode.INVALID_FILE,
                "Failed to parse PDF document. File is corrupted or not a valid PDF.",
            ) from exc

        try:
            # 1. Check encryption and password protection
            if doc.is_encrypted or doc.needs_pass:
                raise PDFExtractionError(
                    ErrorCode.ENCRYPTED_PDF,
                    "The PDF file is encrypted or password-protected. "
                    "Encrypted files are not supported.",
                )

            # 2. Check page count before performing any text extraction
            page_count = doc.page_count
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

            # 3. Extract text and hyperlinks page by page
            pages_extracted: list[PageExtraction] = []
            all_links: list[PDFLink] = []
            seen_document_links: set[str] = set()

            for page_idx in range(page_count):
                page_number = page_idx + 1
                try:
                    page = doc[page_idx]
                    page_text = _extract_page_text_column_aware(page)
                    page_links = _extract_page_links(page, page_number)
                except Exception as exc:
                    raise PDFExtractionError(
                        ErrorCode.INVALID_FILE,
                        "Failed to extract content from PDF. "
                        "Document structure is corrupted or unreadable.",
                    ) from exc

                for link in page_links:
                    if link.url not in seen_document_links:
                        seen_document_links.add(link.url)
                        all_links.append(link)

                pages_extracted.append(
                    PageExtraction(
                        page_number=page_number,
                        text=page_text,
                        links=page_links,
                    )
                )

            # 4. Check for scanned / image-only / empty PDFs
            full_text = "\n\n".join(
                page.text for page in pages_extracted if page.text.strip()
            ).strip()

            if not full_text:
                raise PDFExtractionError(
                    ErrorCode.SCANNED_PDF,
                    "The PDF contains no extractable text. Scanned or image-only "
                    "documents are not supported as OCR is disabled.",
                )

            # 5. Check character limit policy (strict rejection, no silent truncation)
            if max_text_chars is not None and len(full_text) > max_text_chars:
                raise PDFExtractionError(
                    ErrorCode.INVALID_FILE,
                    f"Extracted text length ({len(full_text)} characters) exceeds "
                    f"the maximum allowed limit of {max_text_chars} characters.",
                )

            return PDFExtractionResult(
                text=full_text,
                links=all_links,
                page_count=page_count,
                pages=pages_extracted,
                metadata={
                    "parser": "pymupdf",
                    "page_count": page_count,
                    "links_count": len(all_links),
                },
            )
        finally:
            doc.close()


def extract_pdf(
    content: bytes,
    *,
    parser: PDFParser | None = None,
    max_bytes: int | None = None,
    max_pages: int | None = None,
    max_text_chars: int | None = None,
) -> PDFExtractionResult:
    """Validate and extract text and hyperlinks from raw PDF bytes.

    Args:
        content: Raw bytes of the PDF file.
        parser: Optional PDFParser implementation. Defaults to PyMuPDFParser.
        max_bytes: Maximum allowed byte size.
        max_pages: Maximum allowed page count.
        max_text_chars: Maximum allowed character count.

    Returns:
        PDFExtractionResult containing extracted text, pages, and hyperlinks.

    Raises:
        PDFExtractionError: If validation fails or limits are exceeded.
    """
    settings = get_settings()
    effective_max_bytes = (
        max_bytes if max_bytes is not None else settings.PDF_MAX_FILE_SIZE_BYTES
    )
    effective_max_pages = max_pages if max_pages is not None else settings.PDF_MAX_PAGES
    effective_max_chars = (
        max_text_chars if max_text_chars is not None else settings.PDF_MAX_TEXT_CHARS
    )

    # 1. Early file size check before parsing
    content_len = len(content)
    if content_len > effective_max_bytes:
        raise PDFExtractionError(
            ErrorCode.FILE_TOO_LARGE,
            f"PDF file size ({content_len} bytes) exceeds the maximum allowed limit "
            f"of {effective_max_bytes} bytes.",
        )

    # 2. Magic signature check
    if not content.startswith(_PDF_MAGIC_SIGNATURE) and (
        _PDF_MAGIC_SIGNATURE not in content[:1024]
    ):
        raise PDFExtractionError(
            ErrorCode.INVALID_FILE,
            "The provided file is not a valid PDF document (missing PDF magic header).",
        )

    # 3. Delegate to selected parser
    active_parser = parser or PyMuPDFParser()
    return active_parser.extract(
        content,
        max_pages=effective_max_pages,
        max_text_chars=effective_max_chars,
    )
