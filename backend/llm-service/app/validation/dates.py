"""Date normalization utilities for converting lenient LLM date strings.

Converts unambiguous dates into schema-compliant 'YYYY' or 'YYYY-MM' strings.
Preserves ambiguous expressions for review without inventing dates or months.
Emits sanitized ExtractionWarning objects that never expose resume text.
"""

import re
from typing import Final

from app.schemas.errors import WarningCode
from app.schemas.response import ExtractionWarning

MONTH_MAP: Final[dict[str, int]] = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

AMBIGUOUS_KEYWORDS: Final[frozenset[str]] = frozenset(
    {
        "fall",
        "autumn",
        "spring",
        "summer",
        "winter",
        "present",
        "current",
        "now",
        "ongoing",
        "expected",
        "circa",
        "approx",
        "approximately",
        "mid",
        "late",
        "early",
        "q1",
        "q2",
        "q3",
        "q4",
    }
)

# Regex patterns for unambiguous formats
_RE_YEAR_ONLY = re.compile(r"^(\d{4})$")
_RE_YEAR_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_RE_MONTH_YEAR_ALPHA = re.compile(r"^([A-Za-z]+)\.?,?\s+(\d{4})$")
_RE_YEAR_MONTH_ALPHA = re.compile(r"^(\d{4})\s+([A-Za-z]+)\.?$")
_RE_NUMERIC_SLASH_DASH = re.compile(r"^(0?[1-9]|1[0-2])[/\-.](19\d{2}|20\d{2})$")
_RE_YEAR_SLASH_MONTH = re.compile(r"^(19\d{2}|20\d{2})[/.](0?[1-9]|1[0-2])$")
_RE_ISO_FULL_DATE = re.compile(r"^(19\d{2}|20\d{2})-(0?[1-9]|1[0-2])-(?:\d{1,2})$")
_RE_DAY_MONTH_YEAR = re.compile(
    r"^(?:\d{1,2}\s+([A-Za-z]+)\.?,?\s+(\d{4})|([A-Za-z]+)\.?,?\s+\d{1,2},?\s+(\d{4}))$"
)
_RE_RANGE_INDICATOR = re.compile(r"(\s+[-–—to]+\s+|\s*[-–—]\s*(?:19|20)\d{2})")


def normalize_date(
    raw_date: str | None,
    path: str = "",
) -> tuple[str | None, ExtractionWarning | None]:
    """Normalize a raw date string to YYYY or YYYY-MM if unambiguous.

    Args:
        raw_date: Lenient candidate date string or None.
        path: Path identifier (e.g. 'education[0].startDate') for warning attribution.

    Returns:
        tuple of (normalized_date_string_or_none, optional_extraction_warning).
        Ambiguous dates produce (None, AMBIGUOUS_DATE warning).
        Invalid dates produce (None, INVALID_DATE warning).
    """
    if raw_date is None:
        return None, None

    cleaned = raw_date.strip()
    if not cleaned:
        return None, None

    # Check for date ranges compressed into a single field
    if _RE_RANGE_INDICATOR.search(cleaned):
        warning = ExtractionWarning(
            path=path,
            code=WarningCode.INVALID_DATE,
            message=(
                "Date range detected in single date field; "
                "omitted from normalized profile."
            ),
        )
        return None, warning

    # Check for known ambiguous expressions
    lower = cleaned.lower()
    for word in re.split(r"[\s,'/\-]+", lower):
        if word in AMBIGUOUS_KEYWORDS:
            warning = ExtractionWarning(
                path=path,
                code=WarningCode.AMBIGUOUS_DATE,
                message=(
                    "Ambiguous date expression omitted from normalized "
                    "profile for manual review."
                ),
            )
            return None, warning

    # 1. Already valid YYYY
    m_year = _RE_YEAR_ONLY.match(cleaned)
    if m_year:
        year_val = int(m_year.group(1))
        if 1900 <= year_val <= 2100:
            return cleaned, None

    # 2. Already valid YYYY-MM
    m_ym = _RE_YEAR_MONTH.match(cleaned)
    if m_ym:
        year_val = int(m_ym.group(1))
        if 1900 <= year_val <= 2100:
            return cleaned, None

    # 3. Month Name + Year (e.g. 'Jan 2022', 'January 2022', 'Jan, 2022')
    m_alpha = _RE_MONTH_YEAR_ALPHA.match(cleaned)
    if m_alpha:
        m_name, y_str = m_alpha.group(1).lower(), m_alpha.group(2)
        if m_name in MONTH_MAP:
            month_num = MONTH_MAP[m_name]
            year_val = int(y_str)
            if 1900 <= year_val <= 2100:
                return f"{year_val:04d}-{month_num:02d}", None

    # 4. Year + Month Name (e.g. '2022 Jan')
    m_yalpha = _RE_YEAR_MONTH_ALPHA.match(cleaned)
    if m_yalpha:
        y_str, m_name = m_yalpha.group(1), m_yalpha.group(2).lower()
        if m_name in MONTH_MAP:
            month_num = MONTH_MAP[m_name]
            year_val = int(y_str)
            if 1900 <= year_val <= 2100:
                return f"{year_val:04d}-{month_num:02d}", None

    # 5. Month with day + Year (e.g. 'Jan 15, 2022', '15 Jan 2022')
    m_day = _RE_DAY_MONTH_YEAR.match(cleaned)
    if m_day:
        m_name = (m_day.group(1) or m_day.group(3) or "").lower()
        y_str = m_day.group(2) or m_day.group(4)
        if m_name in MONTH_MAP and y_str:
            month_num = MONTH_MAP[m_name]
            year_val = int(y_str)
            if 1900 <= year_val <= 2100:
                return f"{year_val:04d}-{month_num:02d}", None

    # 6. Numeric Month / Year (e.g. '01/2022', '5/2022', '01-2022')
    m_num = _RE_NUMERIC_SLASH_DASH.match(cleaned)
    if m_num:
        m_val, y_val = int(m_num.group(1)), int(m_num.group(2))
        if 1900 <= y_val <= 2100:
            return f"{y_val:04d}-{m_val:02d}", None

    # 7. Numeric Year / Month (e.g. '2022/01', '2022/5')
    m_ynum = _RE_YEAR_SLASH_MONTH.match(cleaned)
    if m_ynum:
        y_val, m_val = int(m_ynum.group(1)), int(m_ynum.group(2))
        if 1900 <= y_val <= 2100:
            return f"{y_val:04d}-{m_val:02d}", None

    # 8. ISO Date YYYY-MM-DD (e.g. '2022-01-15')
    m_iso = _RE_ISO_FULL_DATE.match(cleaned)
    if m_iso:
        y_val, m_val = int(m_iso.group(1)), int(m_iso.group(2))
        if 1900 <= y_val <= 2100:
            return f"{y_val:04d}-{m_val:02d}", None

    # Fallback: unrecognized or invalid format
    warning = ExtractionWarning(
        path=path,
        code=WarningCode.INVALID_DATE,
        message="Unrecognized or invalid date format omitted from normalized profile.",
    )
    return None, warning
