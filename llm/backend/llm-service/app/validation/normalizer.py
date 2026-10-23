"""Deterministic normalization pipeline for ResumeDraft instances.

Performs safe whitespace stripping, date standardization via normalize_date,
URL normalization, and removes unfixable empty items while preserving
all substantive descriptions and resume facts without paraphrasing.
"""

import re
from urllib.parse import urlparse

from app.schemas.errors import WarningCode
from app.schemas.llm_draft import (
    AchievementDraft,
    EducationDraft,
    ExperienceDraft,
    ProfileDraft,
    ProjectDraft,
    ResumeDraft,
    SkillDraft,
    SocialLinkDraft,
)
from app.schemas.response import ExtractionWarning
from app.validation.dates import normalize_date

_EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_DIGITS_REGEX = re.compile(r"\d{7,}")


def _collapse_spaces(val: str | None) -> str | None:
    """Trim and collapse internal whitespace sequences in single-line strings."""
    if val is None:
        return None
    trimmed = val.strip()
    if not trimmed:
        return None
    return re.sub(r"[ \t]+", " ", trimmed)


def _clean_text_preserve_lines(val: str | None) -> str | None:
    """Trim outer whitespace and normalize line breaks without changing content."""
    if val is None:
        return None
    trimmed = val.strip()
    if not trimmed:
        return None
    return trimmed.replace("\r\n", "\n").replace("\r", "\n")


def _normalize_url(raw: str) -> str | None:
    """Sanitize URL, prepending https scheme if missing, validating syntax."""
    cleaned = raw.strip()
    if not cleaned or " " in cleaned:
        return None
    if not (cleaned.startswith("http://") or cleaned.startswith("https://")):
        cleaned = f"https://{cleaned}"
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https"):
        return None
    if not parsed.netloc or "." not in parsed.netloc:
        return None
    return cleaned


def normalize_draft(
    draft: ResumeDraft,
) -> tuple[ResumeDraft, list[ExtractionWarning]]:
    """Deterministically normalize ResumeDraft fields and extract non-fatal warnings.

    Args:
        draft: Candidate ResumeDraft to normalize.

    Returns:
        tuple of (normalized_draft, list_of_warnings)
    """
    warnings: list[ExtractionWarning] = []

    # 1. Profile
    p = draft.profile
    norm_name = _collapse_spaces(p.name)
    norm_headline = _collapse_spaces(p.headline)
    norm_location = _collapse_spaces(p.location)
    norm_summary = _clean_text_preserve_lines(p.summary)

    norm_email = _collapse_spaces(p.email)
    if norm_email is not None and not _EMAIL_REGEX.match(norm_email):
        warnings.append(
            ExtractionWarning(
                path="profile.email",
                code=WarningCode.UNSUPPORTED_VALUE,
                message="Malformed email address omitted from normalized profile.",
            )
        )
        norm_email = None

    norm_phone = _collapse_spaces(p.phone)
    if norm_phone is not None and not _PHONE_DIGITS_REGEX.search(norm_phone):
        warnings.append(
            ExtractionWarning(
                path="profile.phone",
                code=WarningCode.UNSUPPORTED_VALUE,
                message="Malformed phone number omitted from normalized profile.",
            )
        )
        norm_phone = None

    norm_profile = ProfileDraft(
        name=norm_name,
        headline=norm_headline,
        email=norm_email,
        phone=norm_phone,
        location=norm_location,
        summary=norm_summary,
    )

    # 2. Education
    norm_education: list[EducationDraft] = []
    for idx, edu in enumerate(draft.education):
        start_d, s_warn = normalize_date(
            edu.startDate, path=f"education[{idx}].startDate"
        )
        if s_warn is not None:
            warnings.append(s_warn)

        end_d, e_warn = normalize_date(edu.endDate, path=f"education[{idx}].endDate")
        if e_warn is not None:
            warnings.append(e_warn)

        norm_education.append(
            EducationDraft(
                institution=_collapse_spaces(edu.institution),
                degree=_collapse_spaces(edu.degree),
                fieldOfStudy=_collapse_spaces(edu.fieldOfStudy),
                startDate=start_d,
                endDate=end_d,
                grade=_collapse_spaces(edu.grade),
            )
        )

    # 3. Experience
    norm_experience: list[ExperienceDraft] = []
    for idx, exp in enumerate(draft.experience):
        is_current = bool(exp.isCurrent) if exp.isCurrent is not None else False
        raw_end = (exp.endDate or "").strip().lower()

        # Handle 'Present' / 'Current' in endDate
        if raw_end in ("present", "current", "now", "ongoing"):
            is_current = True
            end_d = None
        elif is_current and not exp.endDate:
            end_d = None
        else:
            end_d, e_warn = normalize_date(
                exp.endDate, path=f"experience[{idx}].endDate"
            )
            if e_warn is not None:
                warnings.append(e_warn)

        start_d, s_warn = normalize_date(
            exp.startDate, path=f"experience[{idx}].startDate"
        )
        if s_warn is not None:
            warnings.append(s_warn)

        # Bullets: filter empty items, preserve exact text
        clean_bullets: list[str] = []
        for b in exp.bullets:
            b_trimmed = _clean_text_preserve_lines(b)
            if b_trimmed:
                clean_bullets.append(b_trimmed)
            else:
                warnings.append(
                    ExtractionWarning(
                        path=f"experience[{idx}].bullets",
                        code=WarningCode.DROPPED_ITEM,
                        message="Empty experience bullet omitted.",
                    )
                )

        norm_experience.append(
            ExperienceDraft(
                company=_collapse_spaces(exp.company),
                title=_collapse_spaces(exp.title),
                location=_collapse_spaces(exp.location),
                startDate=start_d,
                endDate=end_d,
                isCurrent=is_current,
                bullets=clean_bullets,
            )
        )

    # 4. Skills
    norm_skills: list[SkillDraft] = []
    for idx, skill in enumerate(draft.skills):
        name_clean = _collapse_spaces(skill.name)
        if not name_clean:
            warnings.append(
                ExtractionWarning(
                    path=f"skills[{idx}]",
                    code=WarningCode.DROPPED_ITEM,
                    message="Skill item with empty name omitted.",
                )
            )
        else:
            norm_skills.append(SkillDraft(name=name_clean))

    # 5. Projects
    norm_projects: list[ProjectDraft] = []
    for idx, proj in enumerate(draft.projects):
        clean_tech = [t.strip() for t in proj.technologies if t and t.strip()]
        clean_links: list[str] = []
        for l_idx, link in enumerate(proj.links):
            norm_url = _normalize_url(link)
            if norm_url:
                clean_links.append(norm_url)
            else:
                warnings.append(
                    ExtractionWarning(
                        path=f"projects[{idx}].links[{l_idx}]",
                        code=WarningCode.UNSUPPORTED_VALUE,
                        message="Malformed project link URL omitted.",
                    )
                )

        norm_projects.append(
            ProjectDraft(
                name=_collapse_spaces(proj.name),
                description=_clean_text_preserve_lines(proj.description),
                technologies=clean_tech,
                links=clean_links,
            )
        )

    # 6. Achievements
    norm_achievements: list[AchievementDraft] = [
        AchievementDraft(
            title=_collapse_spaces(a.title),
            description=_clean_text_preserve_lines(a.description),
        )
        for a in draft.achievements
    ]

    # 7. Social Links
    norm_social_links: list[SocialLinkDraft] = []
    for idx, sl in enumerate(draft.socialLinks):
        platform_clean = _collapse_spaces(sl.platform)
        raw_url = (sl.url or "").strip()
        norm_url = _normalize_url(raw_url) if raw_url else None

        if not platform_clean and not norm_url:
            warnings.append(
                ExtractionWarning(
                    path=f"socialLinks[{idx}]",
                    code=WarningCode.DROPPED_ITEM,
                    message="Empty social link entry omitted.",
                )
            )
            continue

        if not norm_url and raw_url:
            warnings.append(
                ExtractionWarning(
                    path=f"socialLinks[{idx}].url",
                    code=WarningCode.UNSUPPORTED_VALUE,
                    message="Malformed social link URL omitted.",
                )
            )

        norm_social_links.append(
            SocialLinkDraft(
                platform=platform_clean,
                url=norm_url,
            )
        )

    normalized = ResumeDraft(
        profile=norm_profile,
        education=norm_education,
        experience=norm_experience,
        skills=norm_skills,
        projects=norm_projects,
        achievements=norm_achievements,
        socialLinks=norm_social_links,
    )
    return normalized, warnings
