"""Text cleaning and normalization pipeline for extracted resume content.

This module provides pure, deterministic text-sanitization functions designed to
clean raw PDF text extractions without paraphrasing, summarizing, or destroying
meaningful technical terminology, grades, dates, or contact information.
"""

import re
import unicodedata

# Common prefixes in legitimately hyphenated English compounds
_HYPHENATED_COMPOUND_PREFIXES: frozenset[str] = frozenset(
    {
        "all",
        "cost",
        "cross",
        "end",
        "full",
        "half",
        "high",
        "in",
        "low",
        "mid",
        "multi",
        "non",
        "off",
        "on",
        "open",
        "out",
        "part",
        "post",
        "pre",
        "pro",
        "quasi",
        "real",
        "re",
        "self",
        "semi",
        "time",
        "top",
        "ultra",
        "well",
    }
)

# Matches non-breaking spaces and zero-width artifacts
_ZERO_WIDTH_PATTERN = re.compile(r"[\u200b\u200c\u200d\ufeff]")

# Matches various Unicode dash and hyphen variants
_DASH_VARIANTS_PATTERN = re.compile(r"[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]")

# Matches various Unicode bullet symbols
_BULLET_VARIANTS_PATTERN = re.compile(
    r"[\u2022\u2023\u2042\u2043\u2219\u25a0\u25a1\u25aa\u25ab\u25b8\u25b9\u25c6\u25c7\u25cb\u25cf\u25e6\u2605\u2606\u27a2\u27a4]"
)

# Matches split words across a line break (e.g., 'implemen-\n  tation')
_HYPHENATED_LINEBREAK_PATTERN = re.compile(r"(\b[a-zA-Z]{2,})-\n[ \t]*([a-zA-Z]{2,}\b)")

# Matches horizontal whitespace on a single line (excluding newlines)
_HORIZONTAL_WHITESPACE_PATTERN = re.compile(r"[^\S\n\t]+")

# Matches three or more consecutive newlines
_EXCESSIVE_NEWLINES_PATTERN = re.compile(r"\n{3,}")


def _repair_hyphenation(match: re.Match[str]) -> str:
    """Resolve hyphenated line break while preserving compound terms.

    If the first part is a recognized compound prefix (e.g., 'cross', 'high'),
    the hyphen is retained ('cross-platform'). Otherwise, the fragments are joined
    into a single word ('implementation').
    """
    prefix, suffix = match.group(1), match.group(2)
    if prefix.lower() in _HYPHENATED_COMPOUND_PREFIXES:
        return f"{prefix}-{suffix}"
    return f"{prefix}{suffix}"


def clean_text(text: str) -> str:
    """Clean and normalize extracted resume text deterministically and idempotently.

    Transformations:
    1. Unicode normalization via NFKC.
    2. Strips harmful control characters while preserving newlines and tabs.
    3. Normalizes carriage returns (`\\r\\n`, `\\r`) to `\\n`.
    4. Replaces non-breaking spaces with standard spaces and strips zero-width chars.
    5. Normalizes various dash characters (en-dash, em-dash, minus) to hyphens.
    6. Normalizes diverse Unicode bullet variants to a uniform bullet point (`• `).
    7. Repairs hyphenated word splits across line breaks.
    8. Normalizes multiple intra-line spaces to a single space.
    9. Collapses runs of more than two consecutive newlines into double newlines
       to preserve paragraph boundaries without excessive vertical gaps.

    Known limitations:
    - Highly stylized tabular matrices with spacing-based alignment
      may have inter-column spacing collapsed to a single space.
    - Unusual compound words split across line breaks where the prefix is not in the
      recognized prefix set may be joined into a single word.

    Args:
        text: Raw extracted text string.

    Returns:
        Cleaned, normalized text string.
    """
    if not text:
        return ""

    # 1. Unicode normalization (NFKC)
    normalized = unicodedata.normalize("NFKC", text)

    # 2. Remove control characters (except newline \n and tab \t)
    filtered_chars = [
        char
        for char in normalized
        if char in ("\n", "\t") or unicodedata.category(char) != "Cc"
    ]
    cleaned = "".join(filtered_chars)

    # 3. Normalize line endings and non-breaking / zero-width spaces
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = cleaned.replace("\u00a0", " ")
    cleaned = _ZERO_WIDTH_PATTERN.sub("", cleaned)

    # 4. Normalize dashes to standard hyphen
    cleaned = _DASH_VARIANTS_PATTERN.sub("-", cleaned)

    # 5. Normalize bullets
    cleaned = _BULLET_VARIANTS_PATTERN.sub("•", cleaned)
    cleaned = re.sub(r"•[ \t]*", "• ", cleaned)

    # 6. Repair line-break hyphenation
    cleaned = _HYPHENATED_LINEBREAK_PATTERN.sub(_repair_hyphenation, cleaned)

    # 7. Normalize intra-line horizontal spaces
    lines = [
        _HORIZONTAL_WHITESPACE_PATTERN.sub(" ", line).strip()
        for line in cleaned.split("\n")
    ]
    cleaned = "\n".join(lines)

    # 8. Collapse excessive newlines (max 2 consecutive newlines, i.e., one blank line)
    cleaned = _EXCESSIVE_NEWLINES_PATTERN.sub("\n\n", cleaned)

    return cleaned.strip()
