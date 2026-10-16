"""Deterministic extraction of emails, phone numbers, URLs, and social links.

This module provides rule-based extractors operating on cleaned resume text
and optional PDF hyperlink annotations. All extractors retain structured
source evidence (character offsets for text, page/anchor for annotations).

No LLM providers, network requests, or heavy third-party phone libraries are used.
"""

import re
from collections.abc import Sequence
from enum import StrEnum
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

from app.extraction.pdf import PDFLink

# ---------------------------------------------------------------------------
# Reserved routes and classification constants
# ---------------------------------------------------------------------------

RESERVED_GITHUB_ROUTES: frozenset[str] = frozenset(
    {
        "about",
        "apps",
        "blog",
        "collections",
        "community",
        "contact",
        "customer-stories",
        "dashboard",
        "discussions",
        "enterprise",
        "events",
        "explore",
        "features",
        "git-guides",
        "help",
        "issues",
        "join",
        "login",
        "marketplace",
        "new",
        "notifications",
        "organizations",
        "orgs",
        "password_reset",
        "premium-support",
        "pricing",
        "pulls",
        "readme",
        "search",
        "security",
        "session",
        "settings",
        "signup",
        "site",
        "sponsors",
        "stars",
        "status",
        "topics",
        "trending",
    }
)

# Common top-level domains for scheme-less web URLs
_COMMON_TLDS = (
    "com",
    "org",
    "net",
    "edu",
    "gov",
    "io",
    "dev",
    "ai",
    "app",
    "me",
    "co",
    "in",
    "tech",
    "info",
)

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class URLCategory(StrEnum):
    """Classification of extracted URLs."""

    GITHUB_PROFILE = "github_profile"
    GITHUB_REPO = "github_repo"
    LINKEDIN_PROFILE = "linkedin_profile"
    LINKEDIN_COMPANY = "linkedin_company"
    PROJECT_REPO = "project_repo"
    GENERAL = "general"


class SourceEvidence(BaseModel):
    """Provenance tracking for an extracted candidate value."""

    model_config = ConfigDict(extra="forbid")

    extracted_value: str = Field(description="Exact string extracted at the source.")
    source_type: Literal["text", "annotation"] = Field(
        description="Origin of the candidate: visible resume text or PDF annotation."
    )
    start_offset: int | None = Field(
        default=None,
        description="0-based character start index in cleaned text.",
    )
    end_offset: int | None = Field(
        default=None,
        description="0-based character end index in cleaned text.",
    )
    page: int | None = Field(
        default=None,
        description="1-based page number where the annotation is located.",
    )
    anchor_text: str | None = Field(
        default=None,
        description="Visible anchor text associated with the annotation, if recovered.",
    )


class EmailCandidate(BaseModel):
    """Extracted email address candidate with source evidence."""

    model_config = ConfigDict(extra="forbid")

    value: str = Field(description="First-seen extracted email address.")
    evidence: list[SourceEvidence] = Field(default_factory=list)


class PhoneCandidate(BaseModel):
    """Extracted phone number candidate with source evidence."""

    model_config = ConfigDict(extra="forbid")

    value: str = Field(description="First-seen phone number as found in the source.")
    normalized: str = Field(
        description=(
            "Digit-based comparison form with leading '+' preserved if present in"
            " source."
        )
    )
    evidence: list[SourceEvidence] = Field(default_factory=list)


class URLCandidate(BaseModel):
    """Extracted web URL candidate with classification and source evidence."""

    model_config = ConfigDict(extra="forbid")

    value: str = Field(description="First-seen raw URL as found in the source.")
    url: str = Field(description="Normalized URL with scheme (defaults to https).")
    category: URLCategory = Field(
        default=URLCategory.GENERAL,
        description="Deterministic classification of the URL.",
    )
    evidence: list[SourceEvidence] = Field(default_factory=list)


class RuleExtractionResult(BaseModel):
    """Typed result of deterministic rule-based candidate extraction."""

    model_config = ConfigDict(extra="forbid")

    emails: list[EmailCandidate] = Field(default_factory=list)
    phones: list[PhoneCandidate] = Field(default_factory=list)
    urls: list[URLCandidate] = Field(default_factory=list)
    github_profiles: list[URLCandidate] = Field(default_factory=list)
    linkedin_profiles: list[URLCandidate] = Field(default_factory=list)
    project_links: list[URLCandidate] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

# Conservative email pattern: boundary check, local part, domain with dot and TLD
_EMAIL_PATTERN = re.compile(
    r"(?<![a-zA-Z0-9_.+-])"
    r"([a-zA-Z0-9][a-zA-Z0-9_.+-]*@[a-zA-Z0-9.-]+)"
    r"(?![a-zA-Z0-9_.+-])"
)

# Phone candidate pattern: boundary checks, optional leading +, paren area code or digit
_PHONE_CANDIDATE_PATTERN = re.compile(
    r"(?<![a-zA-Z0-9+])"
    r"(\+?(?:[0-9]|\([0-9]{1,5}\))[\d\s().-]{6,26}[0-9])"
    r"(?![a-zA-Z0-9])"
)

# Web URL pattern: handles http(s)://, www., and well-known/common domain roots
_URL_PATTERN = re.compile(
    r"(?<![@a-zA-Z0-9_.-])"
    r"("
    r"https?://[^\s<>\"']+"
    r"|"
    r"www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:/[^\s<>\"']*)?"
    r"|"
    r"(?:[a-zA-Z0-9-]+\.)*(?:github\.com|linkedin\.com|gitlab\.com|bitbucket\.org)(?:/[^\s<>\"']*)?"
    r"|"
    rf"[a-zA-Z0-9][a-zA-Z0-9-]*\.(?:{'|'.join(_COMMON_TLDS)})(?:/[^\s<>\"']*)?"
    r")",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Helper functions for validation & trimming
# ---------------------------------------------------------------------------


def _validate_email(email: str) -> bool:
    """Validate email syntax conservatively without making network calls.

    Rejects:
    - Missing local part or missing domain
    - Multiple '@' characters
    - Consecutive dots anywhere in local part or domain
    - Leading or trailing dots or hyphens
    - Domain without at least one dot
    - TLD shorter than 2 characters or containing non-alphabetics
    """
    if not email or "@" not in email:
        return False

    parts = email.split("@")
    if len(parts) != 2:
        return False

    local, domain = parts
    if not local or not domain:
        return False

    if ".." in local or ".." in domain:
        return False

    if (
        local.startswith(".")
        or local.endswith(".")
        or domain.startswith(".")
        or domain.endswith(".")
    ):
        return False

    if domain.startswith("-") or domain.endswith("-"):
        return False

    if "." not in domain:
        return False

    labels = domain.split(".")
    for label in labels:
        if not label or label.startswith("-") or label.endswith("-"):
            return False

    tld = labels[-1]
    if len(tld) < 2 or not tld.isalpha():
        return False

    return True


def _trim_punctuation_and_brackets(
    text: str, start: int, end: int
) -> tuple[str, int, int]:
    """Trim surrounding punctuation and unmatched closing brackets from match."""
    val = text
    trailing_punct = {".", ",", ";", "!", "?", ":", "'", '"'}
    bracket_pairs = {")": "(", "]": "[", "}": "{"}

    changed = True
    while changed and val:
        changed = False

        while val and val[-1] in trailing_punct:
            val = val[:-1]
            end -= 1
            changed = True

        if val and val[-1] in bracket_pairs:
            closing = val[-1]
            opening = bracket_pairs[closing]
            if val.count(closing) > val.count(opening):
                val = val[:-1]
                end -= 1
                changed = True

    return val, start, end


def _validate_phone_candidate(
    candidate: str,
    text: str,
    start: int,
    end: int,
) -> tuple[str, str] | None:
    """Validate a candidate phone string conservatively.

    Returns (value, normalized) or None if invalid.

    Limitations:
    Deterministic regex detection cannot verify if a number is currently assigned
    or reachable by a carrier, nor can it know all local dialing plans without
    heavy external libraries. It enforces standard digit lengths (10-15 digits),
    separators, and context exclusions (years, dates, CGPA).
    """
    # Reject if in fraction/grade context, email context, or URL path context
    if start > 0 and text[start - 1] in "/%@":
        return None
    if start >= 3 and text[start - 3 : start] == "://":
        return None
    if start > 0 and text[start - 1] == "." and start > 1 and text[start - 2].isdigit():
        return None
    if end < len(text) and text[end] in "/%@":
        return None

    # Check parens balance
    if candidate.count("(") != candidate.count(")"):
        return None
    if "(" in candidate:
        if candidate.index("(") > candidate.index(")"):
            return None

    # Check for invalid characters
    valid_chars = set("0123456789 +()-.")
    if any(c not in valid_chars for c in candidate):
        return None

    # Check for consecutive separators
    if "--" in candidate or ".." in candidate or "  " in candidate:
        return None

    # Extract pure digits
    digits = re.sub(r"\D", "", candidate)
    if len(digits) < 10 or len(digits) > 15:
        return None

    # Reject if all identical digits (e.g. 0000000000)
    if len(set(digits)) == 1:
        return None

    # Reject date-like patterns such as YYYY-MM-DD or DD-MM-YYYY
    if re.match(r"^\d{4}[-./]\d{2}[-./]\d{2}", candidate):
        return None
    if re.match(r"^\d{2}[-./]\d{2}[-./]\d{4}", candidate):
        return None

    # Build normalized representation
    is_plus = candidate.startswith("+")
    normalized = ("+" if is_plus else "") + digits

    return candidate, normalized


def _validate_and_canonicalize_url(raw_url: str) -> str | None:
    """Validate URL structure with urllib.parse and return canonical URL with scheme.

    Returns canonical URL (e.g. 'https://github.com/user') or None if invalid.
    """
    candidate = raw_url.strip()
    if not candidate:
        return None

    # mailto: is an email annotation, not a web URL
    if candidate.lower().startswith("mailto:"):
        return None

    # Add scheme if scheme-less
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", candidate):
        candidate_with_scheme = "https://" + candidate
    else:
        candidate_with_scheme = candidate

    try:
        parsed = urlparse(candidate_with_scheme)
    except Exception:
        return None

    # Scheme must be http or https
    if parsed.scheme.lower() not in ("http", "https"):
        return None

    netloc = parsed.netloc.strip()
    if not netloc:
        return None

    # Extract hostname without port
    host = netloc.split(":")[0].strip().lower()
    if not host or "." not in host:
        return None

    if ".." in host or host.startswith(".") or host.endswith("."):
        return None
    if host.startswith("-") or host.endswith("-"):
        return None

    labels = host.split(".")
    for label in labels:
        if not label or label.startswith("-") or label.endswith("-"):
            return None
        if not re.match(r"^[a-zA-Z0-9-]+$", label):
            return None

    tld = labels[-1]
    if len(tld) < 2 or not tld.isalpha():
        return None

    return candidate_with_scheme


def _normalize_url_for_comparison(canonical_url: str) -> str:
    """Generate a normalized comparison key for deduplicating URLs.

    Accounts for scheme (defaults to https), hostname casing, www prefix,
    and trailing slashes without merging genuinely distinct paths.
    """
    parsed = urlparse(canonical_url)
    host = parsed.netloc.split(":")[0].lower()
    if host.startswith("www."):
        host = host[4:]

    path = parsed.path.rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{host}{path}{query}"


def classify_url(canonical_url: str) -> URLCategory:
    """Classify a validated URL into a specific URLCategory.

    Rules:
    - GitHub profile: github.com/<username> (excludes reserved routes).
    - GitHub repo: github.com/<username>/<repo> (excludes reserved routes).
    - LinkedIn profile: linkedin.com/in/<username> (with www and subdomains).
    - LinkedIn company: linkedin.com/company/<name> (organization).
    - Project repo: gitlab.com or bitbucket.org repo paths.
    - General: any other valid URL or unrecognized route.
    """
    parsed = urlparse(canonical_url)
    host = parsed.netloc.split(":")[0].lower()
    if host.startswith("www."):
        clean_host = host[4:]
    else:
        clean_host = host

    path_segments = [s for s in parsed.path.strip("/").split("/") if s]

    # GitHub classification
    if clean_host == "github.com":
        if not path_segments:
            return URLCategory.GENERAL

        first_segment = path_segments[0].lower()
        if first_segment in RESERVED_GITHUB_ROUTES:
            return URLCategory.GENERAL

        if len(path_segments) == 1:
            return URLCategory.GITHUB_PROFILE

        return URLCategory.GITHUB_REPO

    # GitLab / Bitbucket repository classification
    if clean_host in ("gitlab.com", "bitbucket.org"):
        if len(path_segments) >= 2:
            return URLCategory.PROJECT_REPO
        return URLCategory.GENERAL

    # LinkedIn classification
    if re.match(r"^(?:[a-z]{2,3}\.)?linkedin\.com$", clean_host):
        if not path_segments:
            return URLCategory.GENERAL

        first_segment = path_segments[0].lower()
        if first_segment == "in" and len(path_segments) >= 2 and path_segments[1]:
            return URLCategory.LINKEDIN_PROFILE

        if (
            first_segment in ("company", "school")
            and len(path_segments) >= 2
            and path_segments[1]
        ):
            return URLCategory.LINKEDIN_COMPANY

        return URLCategory.GENERAL

    return URLCategory.GENERAL


# ---------------------------------------------------------------------------
# Main Public Function
# ---------------------------------------------------------------------------


def extract_rule_based_fields(
    text: str,
    links: Sequence[PDFLink] | None = None,
) -> RuleExtractionResult:
    """Extract emails, phone numbers, and URLs deterministically.

    Args:
        text: Cleaned resume text string.
        links: Optional sequence of hyperlink annotations from PDF extraction.

    Returns:
        RuleExtractionResult containing typed candidates and source evidence.
    """
    safe_text = text or ""

    # Dictionaries mapping deduplication keys to candidates
    emails_by_key: dict[str, EmailCandidate] = {}
    phones_by_key: dict[str, PhoneCandidate] = {}
    urls_by_key: dict[str, URLCandidate] = {}

    # 1. Extract emails from text
    for match in _EMAIL_PATTERN.finditer(safe_text):
        raw_val = match.group(1)
        start, end = match.start(1), match.end(1)
        trimmed_val, start, end = _trim_punctuation_and_brackets(raw_val, start, end)

        if not _validate_email(trimmed_val):
            continue

        email_key = trimmed_val.lower()
        evidence = SourceEvidence(
            extracted_value=trimmed_val,
            source_type="text",
            start_offset=start,
            end_offset=end,
        )

        if email_key in emails_by_key:
            emails_by_key[email_key].evidence.append(evidence)
        else:
            emails_by_key[email_key] = EmailCandidate(
                value=trimmed_val,
                evidence=[evidence],
            )

    # 2. Extract phone numbers from text
    for match in _PHONE_CANDIDATE_PATTERN.finditer(safe_text):
        raw_val = match.group(1)
        start, end = match.start(1), match.end(1)
        trimmed_val, start, end = _trim_punctuation_and_brackets(raw_val, start, end)

        validated = _validate_phone_candidate(trimmed_val, safe_text, start, end)
        if validated is None:
            continue

        phone_val, normalized = validated
        evidence = SourceEvidence(
            extracted_value=phone_val,
            source_type="text",
            start_offset=start,
            end_offset=end,
        )

        if normalized in phones_by_key:
            phones_by_key[normalized].evidence.append(evidence)
        else:
            phones_by_key[normalized] = PhoneCandidate(
                value=phone_val,
                normalized=normalized,
                evidence=[evidence],
            )

    # 3. Extract web URLs from text
    for match in _URL_PATTERN.finditer(safe_text):
        raw_val = match.group(1)
        start, end = match.start(1), match.end(1)
        trimmed_val, start, end = _trim_punctuation_and_brackets(raw_val, start, end)

        canonical = _validate_and_canonicalize_url(trimmed_val)
        if canonical is None:
            continue

        url_key = _normalize_url_for_comparison(canonical)
        category = classify_url(canonical)
        evidence = SourceEvidence(
            extracted_value=trimmed_val,
            source_type="text",
            start_offset=start,
            end_offset=end,
        )

        if url_key in urls_by_key:
            urls_by_key[url_key].evidence.append(evidence)
        else:
            urls_by_key[url_key] = URLCandidate(
                value=trimmed_val,
                url=canonical,
                category=category,
                evidence=[evidence],
            )

    # 4. Integrate PDF hyperlink annotations
    if links:
        for link in links:
            raw_target = link.url.strip()
            if not raw_target:
                continue

            # Support mailto: annotations for email extraction
            if raw_target.lower().startswith("mailto:"):
                email_target = raw_target[7:].split("?")[0].strip()
                if _validate_email(email_target):
                    email_key = email_target.lower()
                    evidence = SourceEvidence(
                        extracted_value=email_target,
                        source_type="annotation",
                        page=link.page,
                        anchor_text=link.anchor_text,
                    )
                    if email_key in emails_by_key:
                        emails_by_key[email_key].evidence.append(evidence)
                    else:
                        emails_by_key[email_key] = EmailCandidate(
                            value=email_target,
                            evidence=[evidence],
                        )
                continue

            # Support tel: annotations for phone extraction
            if raw_target.lower().startswith("tel:"):
                phone_target = raw_target[4:].split("?")[0].strip()
                digits = re.sub(r"\D", "", phone_target)
                if 10 <= len(digits) <= 15:
                    normalized = ("+" if phone_target.startswith("+") else "") + digits
                    evidence = SourceEvidence(
                        extracted_value=phone_target,
                        source_type="annotation",
                        page=link.page,
                        anchor_text=link.anchor_text,
                    )
                    if normalized in phones_by_key:
                        phones_by_key[normalized].evidence.append(evidence)
                    else:
                        phones_by_key[normalized] = PhoneCandidate(
                            value=phone_target,
                            normalized=normalized,
                            evidence=[evidence],
                        )
                continue

            # Web URL annotations
            canonical = _validate_and_canonicalize_url(raw_target)
            if canonical is None:
                continue

            url_key = _normalize_url_for_comparison(canonical)
            category = classify_url(canonical)
            evidence = SourceEvidence(
                extracted_value=raw_target,
                source_type="annotation",
                page=link.page,
                anchor_text=link.anchor_text,
            )

            if url_key in urls_by_key:
                urls_by_key[url_key].evidence.append(evidence)
            else:
                urls_by_key[url_key] = URLCandidate(
                    value=raw_target,
                    url=canonical,
                    category=category,
                    evidence=[evidence],
                )

    # 5. Build final lists preserving first-seen insertion order
    all_urls = list(urls_by_key.values())
    github_profiles = [u for u in all_urls if u.category == URLCategory.GITHUB_PROFILE]
    linkedin_profiles = [
        u for u in all_urls if u.category == URLCategory.LINKEDIN_PROFILE
    ]
    project_links = [
        u
        for u in all_urls
        if u.category in (URLCategory.GITHUB_REPO, URLCategory.PROJECT_REPO)
    ]

    return RuleExtractionResult(
        emails=list(emails_by_key.values()),
        phones=list(phones_by_key.values()),
        urls=all_urls,
        github_profiles=github_profiles,
        linkedin_profiles=linkedin_profiles,
        project_links=project_links,
    )
