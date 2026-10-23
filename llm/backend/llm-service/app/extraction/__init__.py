"""Extraction package for PDF parsing, text cleaning, and rules extraction."""

from app.extraction.cleaner import clean_text
from app.extraction.isolated_parser import (
    IsolatedPDFParser,
    get_isolated_pdf_parser,
)
from app.extraction.pdf import (
    PageExtraction,
    PDFExtractionError,
    PDFExtractionResult,
    PDFLink,
    PDFParser,
    PyMuPDFParser,
    extract_pdf,
)
from app.extraction.rules import (
    EmailCandidate,
    PhoneCandidate,
    RuleExtractionResult,
    SourceEvidence,
    URLCandidate,
    URLCategory,
    classify_url,
    extract_rule_based_fields,
)

__all__ = [
    "EmailCandidate",
    "IsolatedPDFParser",
    "PDFExtractionError",
    "PDFExtractionResult",
    "PDFLink",
    "PDFParser",
    "PageExtraction",
    "PhoneCandidate",
    "PyMuPDFParser",
    "RuleExtractionResult",
    "SourceEvidence",
    "URLCandidate",
    "URLCategory",
    "classify_url",
    "clean_text",
    "extract_pdf",
    "extract_rule_based_fields",
    "get_isolated_pdf_parser",
]
