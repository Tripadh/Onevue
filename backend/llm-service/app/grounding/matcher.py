"""Deterministic source evidence matching for resume text and PDF annotations.

Evaluates whether populated draft fields are supported by cleaned resume text
or PDF hyperlink annotations without fabricating offsets or page numbers.
"""

import re
from collections.abc import Sequence

from app.extraction.pdf import PDFLink
from app.extraction.rules import SourceEvidence
from app.schemas.response import GroundingStatus

_MONTH_NAMES: dict[str, list[str]] = {
    "01": ["jan", "january"],
    "02": ["feb", "february"],
    "03": ["mar", "march"],
    "04": ["apr", "april"],
    "05": ["may"],
    "06": ["jun", "june"],
    "07": ["jul", "july"],
    "08": ["aug", "august"],
    "09": ["sep", "sept", "september"],
    "10": ["oct", "october"],
    "11": ["nov", "november"],
    "12": ["dec", "december"],
}


def _canonical_url(url: str) -> str:
    """Normalize URL for comparison by stripping scheme, www, and trailing slashes."""
    cleaned = url.strip().lower()
    for prefix in ("https://", "http://"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :]
            break
    if cleaned.startswith("www."):
        cleaned = cleaned[4:]
    return cleaned.rstrip("/")


def match_text_value(
    value: str | None,
    text: str,
) -> tuple[GroundingStatus, list[SourceEvidence]]:
    """Match a short string value (name, title, company, skill) against resume text.

    Args:
        value: Candidate string value.
        text: Cleaned resume source text.

    Returns:
        tuple of (GroundingStatus, list of SourceEvidence).
    """
    if not value or not value.strip():
        return GroundingStatus.NOT_CHECKED, []

    val_trimmed = value.strip()

    # 1. Exact substring match
    idx = text.find(val_trimmed)
    if idx != -1:
        ev = SourceEvidence(
            extracted_value=val_trimmed,
            source_type="text",
            start_offset=idx,
            end_offset=idx + len(val_trimmed),
        )
        return GroundingStatus.GROUNDED, [ev]

    # 2. Case-insensitive and whitespace-normalized match
    words = val_trimmed.split()
    if words:
        pattern = r"\s+".join(re.escape(w) for w in words)
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            ev = SourceEvidence(
                extracted_value=text[match.start() : match.end()],
                source_type="text",
                start_offset=match.start(),
                end_offset=match.end(),
            )
            return GroundingStatus.GROUNDED, [ev]

    # Not found in source text
    return GroundingStatus.UNSUPPORTED, []


def match_date_value(
    date_val: str | None,
    text: str,
) -> tuple[GroundingStatus, list[SourceEvidence]]:
    """Match a normalized date (YYYY or YYYY-MM) against resume text.

    Supports exact date strings, Month Name + Year, or numeric MM/YYYY representations.
    If only the year is found for a YYYY-MM date, marks PARTIALLY_GROUNDED.

    Args:
        date_val: Normalized date string ('YYYY' or 'YYYY-MM') or None.
        text: Cleaned resume source text.

    Returns:
        tuple of (GroundingStatus, list of SourceEvidence).
    """
    if not date_val or not date_val.strip():
        return GroundingStatus.NOT_CHECKED, []

    date_str = date_val.strip()

    # 1. Year only (YYYY)
    if re.match(r"^\d{4}$", date_str):
        m = re.search(rf"\b{date_str}\b", text)
        if m:
            ev = SourceEvidence(
                extracted_value=m.group(0),
                source_type="text",
                start_offset=m.start(),
                end_offset=m.end(),
            )
            return GroundingStatus.GROUNDED, [ev]
        return GroundingStatus.UNSUPPORTED, []

    # 2. Year and Month (YYYY-MM)
    m_ym = re.match(r"^(\d{4})-(0[1-9]|1[0-2])$", date_str)
    if m_ym:
        year_str, month_str = m_ym.group(1), m_ym.group(2)
        month_names = _MONTH_NAMES.get(month_str, [])
        month_pattern = "|".join(month_names)

        # Full pattern: e.g. "Jan 2022", "January 2022", "01/2022", "2022-01"
        patterns = [
            rf"\b(?:{month_pattern})\.?,?\s+{year_str}\b",
            rf"\b{year_str}\s+(?:{month_pattern})\b",
            rf"\b0?{int(month_str)}[/\-.]{year_str}\b",
            rf"\b{year_str}[/\-.]{month_str}\b",
        ]
        combined_pattern = "|".join(f"(?:{p})" for p in patterns)
        match = re.search(combined_pattern, text, re.IGNORECASE)
        if match:
            ev = SourceEvidence(
                extracted_value=text[match.start() : match.end()],
                source_type="text",
                start_offset=match.start(),
                end_offset=match.end(),
            )
            return GroundingStatus.GROUNDED, [ev]

        # Check if at least the year is present
        year_match = re.search(rf"\b{year_str}\b", text)
        if year_match:
            ev = SourceEvidence(
                extracted_value=year_match.group(0),
                source_type="text",
                start_offset=year_match.start(),
                end_offset=year_match.end(),
            )
            return GroundingStatus.PARTIALLY_GROUNDED, [ev]

        return GroundingStatus.UNSUPPORTED, []

    # Other formats: direct match fallback
    return match_text_value(date_str, text)


def match_url_value(
    url_val: str | None,
    links: Sequence[PDFLink] | None,
    text: str,
) -> tuple[GroundingStatus, list[SourceEvidence]]:
    """Match a URL against PDF hyperlink annotations and visible text.

    Args:
        url_val: Candidate URL string.
        links: PDF hyperlink annotations from PDF extraction.
        text: Cleaned resume source text.

    Returns:
        tuple of (GroundingStatus, list of SourceEvidence).
    """
    if not url_val or not url_val.strip():
        return GroundingStatus.NOT_CHECKED, []

    target_canon = _canonical_url(url_val)
    evidence_list: list[SourceEvidence] = []

    # 1. Match against PDF hyperlink annotations
    if links:
        for link in links:
            if _canonical_url(link.url) == target_canon:
                evidence_list.append(
                    SourceEvidence(
                        extracted_value=link.url,
                        source_type="annotation",
                        page=link.page,
                        anchor_text=link.anchor_text,
                    )
                )

    # 2. Match against visible text
    if target_canon:
        pattern = re.escape(target_canon)
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            evidence_list.append(
                SourceEvidence(
                    extracted_value=text[match.start() : match.end()],
                    source_type="text",
                    start_offset=match.start(),
                    end_offset=match.end(),
                )
            )

    if evidence_list:
        return GroundingStatus.GROUNDED, evidence_list

    return GroundingStatus.UNSUPPORTED, []


def match_long_text(
    content: str | None,
    text: str,
    min_token_overlap: float = 0.80,
) -> tuple[GroundingStatus, list[SourceEvidence]]:
    """Conservatively ground long descriptions and experience bullets.

    Requires >= 80% word token recall within a text window for partial match.
    Substantially rewritten descriptions are classified as UNSUPPORTED.

    Args:
        content: Bullet point or summary description.
        text: Cleaned resume source text.
        min_token_overlap: Minimum word token recall for partial match (default 0.80).

    Returns:
        tuple of (GroundingStatus, list of SourceEvidence).
    """
    if not content or not content.strip():
        return GroundingStatus.NOT_CHECKED, []

    cleaned_content = content.strip()

    # 1. Exact match
    idx = text.find(cleaned_content)
    if idx != -1:
        ev = SourceEvidence(
            extracted_value=cleaned_content,
            source_type="text",
            start_offset=idx,
            end_offset=idx + len(cleaned_content),
        )
        return GroundingStatus.GROUNDED, [ev]

    # 2. Normalized whitespace match
    words = cleaned_content.split()
    if not words:
        return GroundingStatus.NOT_CHECKED, []

    pattern = r"\s+".join(re.escape(w) for w in words)
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        ev = SourceEvidence(
            extracted_value=text[match.start() : match.end()],
            source_type="text",
            start_offset=match.start(),
            end_offset=match.end(),
        )
        return GroundingStatus.GROUNDED, [ev]

    # 3. Conservative token overlap comparison across text lines/sentences
    content_tokens = set(re.findall(r"\w+", cleaned_content.lower()))
    if len(content_tokens) < 3:
        # For very short phrases, require exact match
        return GroundingStatus.UNSUPPORTED, []

    best_recall = 0.0
    best_span: tuple[int, int] | None = None
    best_text_chunk: str | None = None

    # Evaluate against lines in source text
    for line in text.split("\n"):
        line_clean = line.strip()
        if not line_clean:
            continue
        line_tokens = set(re.findall(r"\w+", line_clean.lower()))
        if not line_tokens:
            continue

        overlap = len(content_tokens & line_tokens)
        recall = overlap / len(content_tokens)

        if recall > best_recall:
            best_recall = recall
            l_idx = text.find(line_clean)
            if l_idx != -1:
                best_span = (l_idx, l_idx + len(line_clean))
                best_text_chunk = line_clean

    if best_recall >= min_token_overlap and best_span and best_text_chunk:
        ev = SourceEvidence(
            extracted_value=best_text_chunk,
            source_type="text",
            start_offset=best_span[0],
            end_offset=best_span[1],
        )
        return GroundingStatus.PARTIALLY_GROUNDED, [ev]

    return GroundingStatus.UNSUPPORTED, []
