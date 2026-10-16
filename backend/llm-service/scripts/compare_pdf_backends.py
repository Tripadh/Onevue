"""Opt-in comparison tool for evaluating PDF extraction backends.

EVALUATION PURPOSE & LICENSING CONTEXT:
- Evaluates technical parity and performance between PyMuPDF (fitz) and PyPDFium2.
- Investigates the PyMuPDF AGPL-3.0 licensing concern versus Apache-2.0 / BSD-3-Clause
  permissive licensing in pypdfium2.
- Does NOT upload documents to remote servers or third-party APIs.
- Accepts synthetic documents generated in-memory or explicitly authorized files.
- Never prints or logs document text or confidential filenames.
- Reports technical differences without making legal conclusions.
"""

import argparse
import difflib
import os
import sys
import time
from pathlib import Path
from typing import Any

# Ensure project root is on sys.path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_CURRENT_DIR)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

import pymupdf  # noqa: E402

from app.extraction.pdf import (  # noqa: E402
    PDFExtractionError,
    PyMuPDFParser,
)
from app.extraction.pdfium_backend import PyPDFium2Parser  # noqa: E402


def generate_synthetic_comparison_pdf() -> bytes:
    """Generate a rich multi-column synthetic test resume PDF with hyperlinks."""
    doc = pymupdf.open()
    page = doc.new_page()

    # Header
    page.insert_text(
        (50, 60),
        "Alex Doe — Lead Systems Engineer\n"
        "alex.synthetic@example.com | (555) 019-2831 | Seattle, WA\n",
        fontsize=12,
    )

    # Insert a link annotation
    link_rect = pymupdf.Rect(50, 50, 200, 65)
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "uri": "https://linkedin.com/in/alex-doe-synthetic",
            "from": link_rect,
        }
    )

    # Multi-column content
    # Column 1 (Left: Experience)
    page.insert_text(
        (50, 100),
        "PROFESSIONAL EXPERIENCE\n\n"
        "Staff Infrastructure Engineer, Acme Corp (2021 - Present)\n"
        "- Engineered microservices handling 50k requests per second.\n"
        "- Reduced latency percentiles across distributed clusters.\n\n"
        "Senior Backend Developer, Beta Labs (2018 - 2021)\n"
        "- Built asynchronous data ingestion pipelines in Python.\n",
        fontsize=10,
    )

    # Column 2 (Right: Skills & Education)
    page.insert_text(
        (350, 100),
        "CORE TECHNICAL SKILLS\n\n"
        "Languages: Python, Rust, Go\n"
        "Frameworks: FastAPI, PyMuPDF, PyPDFium2\n\n"
        "EDUCATION\n\n"
        "B.S. in Computer Science\n"
        "University of Technology (2014 - 2018)\n",
        fontsize=10,
    )

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def compare_backends_on_content(content: bytes) -> dict[str, Any]:
    """Execute extraction with both PyMuPDF and PyPDFium2 and compare metrics."""
    pymupdf_parser = PyMuPDFParser()
    pypdfium2_parser = PyPDFium2Parser()

    # 1. Benchmark PyMuPDF
    t0 = time.perf_counter()
    pymupdf_res = None
    pymupdf_err = None
    try:
        pymupdf_res = pymupdf_parser.extract(content)
    except PDFExtractionError as exc:
        pymupdf_err = exc
    pymupdf_ms = (time.perf_counter() - t0) * 1000.0

    # 2. Benchmark PyPDFium2
    t1 = time.perf_counter()
    pypdfium2_res = None
    pypdfium2_err = None
    try:
        pypdfium2_res = pypdfium2_parser.extract(content)
    except PDFExtractionError as exc:
        pypdfium2_err = exc
    pypdfium2_ms = (time.perf_counter() - t1) * 1000.0

    # 3. Analyze text similarity if both succeeded
    sequence_ratio = 0.0
    word_overlap_ratio = 0.0
    char_count_mupdf = len(pymupdf_res.text) if pymupdf_res else 0
    char_count_pdfium = len(pypdfium2_res.text) if pypdfium2_res else 0

    if pymupdf_res and pypdfium2_res:
        matcher = difflib.SequenceMatcher(None, pymupdf_res.text, pypdfium2_res.text)
        sequence_ratio = round(matcher.ratio(), 4)

        words_mu = set(pymupdf_res.text.lower().split())
        words_pdfium = set(pypdfium2_res.text.lower().split())
        union = words_mu | words_pdfium
        if union:
            word_overlap_ratio = round(len(words_mu & words_pdfium) / len(union), 4)

    return {
        "pymupdf": {
            "success": pymupdf_res is not None,
            "error_code": pymupdf_err.code.value if pymupdf_err else None,
            "elapsed_ms": round(pymupdf_ms, 2),
            "char_count": char_count_mupdf,
            "page_count": pymupdf_res.page_count if pymupdf_res else 0,
            "links_count": len(pymupdf_res.links) if pymupdf_res else 0,
            "license": "AGPL-3.0 / Commercial",
        },
        "pypdfium2": {
            "success": pypdfium2_res is not None,
            "error_code": pypdfium2_err.code.value if pypdfium2_err else None,
            "elapsed_ms": round(pypdfium2_ms, 2),
            "char_count": char_count_pdfium,
            "page_count": pypdfium2_res.page_count if pypdfium2_res else 0,
            "links_count": len(pypdfium2_res.links) if pypdfium2_res else 0,
            "license": "Apache-2.0 / BSD-3-Clause",
        },
        "comparison": {
            "word_overlap_ratio": word_overlap_ratio,
            "sequence_similarity_ratio": sequence_ratio,
            "char_difference": abs(char_count_mupdf - char_count_pdfium),
            "hyperlink_gap": (
                (len(pymupdf_res.links) if pymupdf_res else 0)
                - (len(pypdfium2_res.links) if pypdfium2_res else 0)
            ),
        },
    }


def format_comparison_report(results: dict[str, Any], is_synthetic: bool) -> None:
    """Print structured technical and licensing comparison report."""
    mu = results["pymupdf"]
    pdfium = results["pypdfium2"]
    comp = results["comparison"]

    w = 70
    sep = "=" * w
    sub_sep = "-" * w

    print("\n" + sep)
    print(" ONEVUE LLM SERVICE — PDF BACKEND EVALUATION REPORT".center(w))
    print(sep)
    doc_source = (
        "In-memory synthetic multi-column document"
        if is_synthetic
        else "Authorized local document"
    )
    print(f" Document Source     : {doc_source}")
    print(" Text Content Logged : NONE (Zero document text disclosed)")
    print(sub_sep)
    print(f" {'Metric / Capability':<22} | {'PyMuPDF':<14} | {'PyPDFium2':<14}")
    print(f" {'-' * 22}-|-{'-' * 14}-|-{'-' * 14}")
    mu_st = "Success" if mu["success"] else "Failed"
    pdf_st = "Success" if pdfium["success"] else "Failed"
    print(f" {'Extraction Status':<22} | {mu_st:<14} | {pdf_st:<14}")
    print(
        f" {'Execution Time':<22} | {mu['elapsed_ms']:>11.2f} ms | "
        f"{pdfium['elapsed_ms']:>11.2f} ms"
    )
    print(
        f" {'Extracted Chars':<22} | {mu['char_count']:>14} | "
        f"{pdfium['char_count']:>14}"
    )
    print(f" {'Page Count':<22} | {mu['page_count']:>14} | {pdfium['page_count']:>14}")
    print(
        f" {'Hyperlinks Extracted':<22} | {mu['links_count']:>14} | "
        f"{pdfium['links_count']:>14}"
    )
    print(f" {'Software License':<22} | {'AGPL-3.0':<14} | {'Apache-2.0':<14}")
    print(sub_sep)
    print(" TECHNICAL PARITY & DIFFERENCE ANALYSIS:")
    print(f"   Word Vocabulary Overlap : {comp['word_overlap_ratio'] * 100:.1f}%")
    print(
        "   Sequential Align Ratio  : "
        f"{comp['sequence_similarity_ratio'] * 100:.1f}% "
        "(reflects column sorting diff)"
    )
    print(f"   Character Count Delta   : {comp['char_difference']} chars")
    print(f"   Hyperlink Extraction Gap: {comp['hyperlink_gap']} links")
    print(sub_sep)
    print(
        " ARCHITECTURAL & LICENSING SUMMARY:\n\n"
        " 1. Licensing Considerations:\n"
        "    - PyMuPDF is licensed under GNU AGPL-3.0 (with commercial licensing).\n"
        "      Depending on deployment topology, AGPL copyleft obligations may\n"
        "      present legal concerns for proprietary cloud platforms.\n"
        "    - PyPDFium2 is licensed under Apache-2.0 / BSD-3-Clause (permissive).\n"
        "      It carries no copyleft obligations.\n\n"
        " 2. Functional Limitations of PyPDFium2:\n"
        "    - High-level pypdfium2 does NOT expose hyperlink annotations or\n"
        "      bounding-box anchor text clipping. Embedded links cannot be extracted\n"
        "      without low-level C FFI calls.\n"
        "    - PyMuPDF includes coordinate-aware column sorting to preserve\n"
        "      multi-column reading order, which pypdfium2 lacks out of the box.\n\n"
        " 3. Recommendation & Status:\n"
        "    - PyMuPDF remains the production default (PDF_BACKEND='pymupdf').\n"
        "    - PyPDFium2 is maintained as an experimental backend option.\n"
        "    - The licensing decision remains UNRESOLVED for legal counsel review.\n"
        "    - This evaluation does NOT make legal compliance conclusions.\n"
    )
    print(sep + "\n")


def parse_args(args: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments for backend comparison script."""
    parser = argparse.ArgumentParser(
        description="ONEVUE PDF backend comparison (PyMuPDF vs. PyPDFium2)."
    )
    parser.add_argument(
        "--pdf-path",
        type=Path,
        default=None,
        help="Optional local path to a PDF document. If omitted, uses synthetic PDF.",
    )
    parser.add_argument(
        "--i-confirm-authorized-document",
        action="store_true",
        default=False,
        help="Confirmation required when passing a local PDF file via --pdf-path.",
    )
    return parser.parse_args(args)


def main() -> int:
    """CLI entrypoint."""
    args = parse_args()
    if args.pdf_path is not None:
        if not args.i_confirm_authorized_document:
            sys.stderr.write(
                "\n[SAFETY HALT] Evaluating a local PDF document requires explicit "
                "authorization.\n"
                "Pass '--i-confirm-authorized-document' to confirm the document "
                "contains no unauthorized personal data.\n\n"
            )
            return 2
        if not args.pdf_path.exists():
            sys.stderr.write(f"\n[ERROR] File not found: {args.pdf_path}\n\n")
            return 1
        content = args.pdf_path.read_bytes()
        is_synthetic = False
    else:
        content = generate_synthetic_comparison_pdf()
        is_synthetic = True

    results = compare_backends_on_content(content)
    format_comparison_report(results, is_synthetic=is_synthetic)
    return 0


if __name__ == "__main__":
    sys.exit(main())
