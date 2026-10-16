"""Deterministic field merging and source grounding orchestrator.

Implements explicit precedence:
1. Directly supported deterministic candidates for contact information and URLs.
2. Validated LLM draft values that pass validation and grounding.
3. Unverified values, which remain flagged for review rather than being silently
   promoted.
"""

from collections.abc import Sequence
from urllib.parse import urlparse

from app.extraction.pdf import PDFLink
from app.extraction.rules import (
    RuleExtractionResult,
    URLCandidate,
    URLCategory,
)
from app.grounding.confidence import (
    evaluate_field_confidence,
    evaluate_field_source,
)
from app.grounding.matcher import (
    _canonical_url,
    match_date_value,
    match_long_text,
    match_text_value,
    match_url_value,
)
from app.schemas.errors import WarningCode
from app.schemas.path_helpers import build_field_path
from app.schemas.response import (
    Confidence,
    ExtractionWarning,
    FieldMeta,
    FieldSource,
    GroundingStatus,
)
from app.schemas.resume import ResumeData


def _is_repo_url(url: str) -> bool:
    """Check if URL points to a repository rather than a personal profile."""
    cleaned = url.strip()
    if not (cleaned.startswith("http://") or cleaned.startswith("https://")):
        cleaned = f"https://{cleaned}"
    parsed = urlparse(cleaned)
    host = parsed.netloc.lower().removeprefix("www.")
    if host in ("github.com", "gitlab.com", "bitbucket.org"):
        parts = [p for p in parsed.path.strip("/").split("/") if p]
        return len(parts) >= 2
    return False


def ground_and_merge(
    data: ResumeData,
    text: str,
    links: Sequence[PDFLink] | None = None,
    rule_results: RuleExtractionResult | None = None,
    pre_existing_warnings: Sequence[ExtractionWarning] | None = None,
) -> tuple[ResumeData, dict[str, FieldMeta], list[ExtractionWarning]]:
    """Ground candidate profile fields and merge deterministic candidate data.

    Args:
        data: Validated ResumeData candidate profile.
        text: Cleaned resume source text.
        links: Optional sequence of PDF hyperlink annotations.
        rule_results: Optional deterministic rule extraction results.
        pre_existing_warnings: Optional sequence of warnings from earlier phases.

    Returns:
        tuple of (merged_resume_data, field_meta_dict, consolidated_warnings).
    """
    warnings: list[ExtractionWarning] = (
        list(pre_existing_warnings) if pre_existing_warnings else []
    )
    field_meta: dict[str, FieldMeta] = {}
    data_dict = data.model_dump()

    # -----------------------------------------------------------------------
    # 1. Contact Information: Email
    # -----------------------------------------------------------------------
    email_path = build_field_path("profile", "email")
    llm_email = data.profile.email
    rule_email = (
        rule_results.emails[0].value if (rule_results and rule_results.emails) else None
    )
    rule_email_ev = (
        rule_results.emails[0].evidence
        if (rule_results and rule_results.emails)
        else []
    )

    if rule_email is not None:
        data_dict["profile"]["email"] = rule_email
        if llm_email and llm_email.strip().lower() != rule_email.strip().lower():
            # Conflict detected: deterministic candidate takes precedence
            warnings.append(
                ExtractionWarning(
                    path=email_path,
                    code=WarningCode.CONFLICT,
                    message=(
                        "Conflicting email candidates detected; "
                        "deterministic candidate selected."
                    ),
                )
            )
            field_meta[email_path] = FieldMeta(
                confidence=Confidence.MEDIUM,
                grounded=True,
                source=FieldSource.RULES,
                alternatives=[llm_email],
                grounding_status=GroundingStatus.GROUNDED,
                evidence=rule_email_ev,
            )
        else:
            field_meta[email_path] = FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.RULES,
                alternatives=[],
                grounding_status=GroundingStatus.GROUNDED,
                evidence=rule_email_ev,
            )
    elif llm_email:
        status, ev = match_text_value(llm_email, text)
        is_grounded = status == GroundingStatus.GROUNDED
        conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
        source = evaluate_field_source(from_rules=False, is_grounded=is_grounded)
        field_meta[email_path] = FieldMeta(
            confidence=conf,
            grounded=is_grounded,
            source=source,
            alternatives=[],
            grounding_status=status,
            evidence=ev,
        )
        if not is_grounded:
            warnings.append(
                ExtractionWarning(
                    path=email_path,
                    code=WarningCode.UNSUPPORTED_VALUE,
                    message=(
                        "Email address could not be grounded in source document text."
                    ),
                )
            )

    # -----------------------------------------------------------------------
    # 2. Contact Information: Phone
    # -----------------------------------------------------------------------
    phone_path = build_field_path("profile", "phone")
    llm_phone = data.profile.phone
    rule_phone = (
        rule_results.phones[0].value if (rule_results and rule_results.phones) else None
    )
    rule_phone_norm = (
        rule_results.phones[0].normalized
        if (rule_results and rule_results.phones)
        else None
    )
    rule_phone_ev = (
        rule_results.phones[0].evidence
        if (rule_results and rule_results.phones)
        else []
    )

    if rule_phone is not None:
        data_dict["profile"]["phone"] = rule_phone
        llm_norm = "".join(c for c in llm_phone if c.isdigit()) if llm_phone else ""
        rule_digits = "".join(c for c in rule_phone_norm if c.isdigit())
        if llm_phone and llm_norm and llm_norm != rule_digits:
            warnings.append(
                ExtractionWarning(
                    path=phone_path,
                    code=WarningCode.CONFLICT,
                    message=(
                        "Conflicting phone candidates detected; "
                        "deterministic candidate selected."
                    ),
                )
            )
            field_meta[phone_path] = FieldMeta(
                confidence=Confidence.MEDIUM,
                grounded=True,
                source=FieldSource.RULES,
                alternatives=[llm_phone],
                grounding_status=GroundingStatus.GROUNDED,
                evidence=rule_phone_ev,
            )
        else:
            field_meta[phone_path] = FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.RULES,
                alternatives=[],
                grounding_status=GroundingStatus.GROUNDED,
                evidence=rule_phone_ev,
            )
    elif llm_phone:
        status, ev = match_text_value(llm_phone, text)
        is_grounded = status == GroundingStatus.GROUNDED
        conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
        source = evaluate_field_source(from_rules=False, is_grounded=is_grounded)
        field_meta[phone_path] = FieldMeta(
            confidence=conf,
            grounded=is_grounded,
            source=source,
            alternatives=[],
            grounding_status=status,
            evidence=ev,
        )
        if not is_grounded:
            warnings.append(
                ExtractionWarning(
                    path=phone_path,
                    code=WarningCode.UNSUPPORTED_VALUE,
                    message=(
                        "Phone number could not be grounded in source document text."
                    ),
                )
            )

    # -----------------------------------------------------------------------
    # 3. Social Links & URL Merging
    # -----------------------------------------------------------------------
    merged_social_links: list[dict[str, str]] = []
    seen_canonical_urls: set[str] = set()

    # Collect deterministic profile candidates
    deterministic_urls: list[tuple[str, URLCandidate]] = []
    if rule_results:
        for gh in rule_results.github_profiles:
            deterministic_urls.append(("GitHub", gh))
        for li in rule_results.linkedin_profiles:
            deterministic_urls.append(("LinkedIn", li))
        for gen in rule_results.urls:
            if gen.category not in (
                URLCategory.GITHUB_REPO,
                URLCategory.PROJECT_REPO,
            ):
                deterministic_urls.append(("Portfolio", gen))

    # Add deterministic social candidates
    for platform_name, cand in deterministic_urls:
        c_canon = _canonical_url(cand.url)
        if c_canon not in seen_canonical_urls:
            seen_canonical_urls.add(c_canon)
            idx = len(merged_social_links)
            merged_social_links.append({"platform": platform_name, "url": cand.url})
            sl_path = build_field_path("socialLinks", idx, "url")
            field_meta[sl_path] = FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.RULES,
                alternatives=[],
                grounding_status=GroundingStatus.GROUNDED,
                evidence=cand.evidence,
            )

    # Reconcile LLM social links
    for sl in data.socialLinks:
        sl_url = sl.url.strip()
        sl_canon = _canonical_url(sl_url)

        # Do not allow GitHub repository URLs to falsely masquerade as personal profile
        if _is_repo_url(sl_url):
            warnings.append(
                ExtractionWarning(
                    path=build_field_path("socialLinks"),
                    code=WarningCode.CONFLICT,
                    message="Repository URL omitted from personal social profiles.",
                )
            )
            continue

        if sl_canon in seen_canonical_urls:
            continue

        seen_canonical_urls.add(sl_canon)
        idx = len(merged_social_links)
        merged_social_links.append({"platform": sl.platform, "url": sl_url})
        sl_path = build_field_path("socialLinks", idx, "url")

        status, ev = match_url_value(sl_url, links, text)
        is_grounded = status == GroundingStatus.GROUNDED
        conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
        source = evaluate_field_source(from_rules=False, is_grounded=is_grounded)
        field_meta[sl_path] = FieldMeta(
            confidence=conf,
            grounded=is_grounded,
            source=source,
            alternatives=[],
            grounding_status=status,
            evidence=ev,
        )
        if not is_grounded:
            warnings.append(
                ExtractionWarning(
                    path=sl_path,
                    code=WarningCode.UNSUPPORTED_VALUE,
                    message=(
                        "Social link URL could not be grounded in document "
                        "annotations or text."
                    ),
                )
            )

    data_dict["socialLinks"] = merged_social_links

    # -----------------------------------------------------------------------
    # 4. Grounding: Profile String Fields
    # -----------------------------------------------------------------------
    for field_name in ("name", "headline", "location"):
        val = data_dict["profile"].get(field_name)
        if val:
            f_path = build_field_path("profile", field_name)
            status, ev = match_text_value(val, text)
            is_grounded = status == GroundingStatus.GROUNDED
            conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
            field_meta[f_path] = FieldMeta(
                confidence=conf,
                grounded=is_grounded,
                source=evaluate_field_source(False, is_grounded),
                alternatives=[],
                grounding_status=status,
                evidence=ev,
            )
            if not is_grounded:
                warnings.append(
                    ExtractionWarning(
                        path=f_path,
                        code=WarningCode.UNSUPPORTED_VALUE,
                        message="Profile value could not be grounded in source text.",
                    )
                )

    if data_dict["profile"].get("summary"):
        f_path = build_field_path("profile", "summary")
        status, ev = match_long_text(data_dict["profile"]["summary"], text)
        is_grounded = status in (
            GroundingStatus.GROUNDED,
            GroundingStatus.PARTIALLY_GROUNDED,
        )
        conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
        field_meta[f_path] = FieldMeta(
            confidence=conf,
            grounded=is_grounded,
            source=evaluate_field_source(False, is_grounded),
            alternatives=[],
            grounding_status=status,
            evidence=ev,
        )
        if not is_grounded:
            warnings.append(
                ExtractionWarning(
                    path=f_path,
                    code=WarningCode.UNSUPPORTED_VALUE,
                    message="Profile summary could not be grounded in source text.",
                )
            )

    # -----------------------------------------------------------------------
    # 5. Grounding: Education Fields
    # -----------------------------------------------------------------------
    for e_idx, edu in enumerate(data_dict.get("education", [])):
        for f_name in ("institution", "degree", "fieldOfStudy", "grade"):
            val = edu.get(f_name)
            if val:
                f_path = build_field_path("education", e_idx, f_name)
                status, ev = match_text_value(val, text)
                is_grounded = status == GroundingStatus.GROUNDED
                conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
                field_meta[f_path] = FieldMeta(
                    confidence=conf,
                    grounded=is_grounded,
                    source=evaluate_field_source(False, is_grounded),
                    alternatives=[],
                    grounding_status=status,
                    evidence=ev,
                )
                if not is_grounded:
                    warnings.append(
                        ExtractionWarning(
                            path=f_path,
                            code=WarningCode.UNSUPPORTED_VALUE,
                            message=(
                                "Education field could not be grounded in source text."
                            ),
                        )
                    )

        for d_name in ("startDate", "endDate"):
            d_val = edu.get(d_name)
            if d_val:
                f_path = build_field_path("education", e_idx, d_name)
                status, ev = match_date_value(d_val, text)
                is_grounded = status in (
                    GroundingStatus.GROUNDED,
                    GroundingStatus.PARTIALLY_GROUNDED,
                )
                conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
                field_meta[f_path] = FieldMeta(
                    confidence=conf,
                    grounded=is_grounded,
                    source=evaluate_field_source(False, is_grounded),
                    alternatives=[],
                    grounding_status=status,
                    evidence=ev,
                )
                if not is_grounded:
                    warnings.append(
                        ExtractionWarning(
                            path=f_path,
                            code=WarningCode.UNSUPPORTED_VALUE,
                            message=(
                                "Education date could not be grounded in source text."
                            ),
                        )
                    )

    # -----------------------------------------------------------------------
    # 6. Grounding: Experience Fields & Bullets
    # -----------------------------------------------------------------------
    for exp_idx, exp in enumerate(data_dict.get("experience", [])):
        for f_name in ("company", "title", "location"):
            val = exp.get(f_name)
            if val:
                f_path = build_field_path("experience", exp_idx, f_name)
                status, ev = match_text_value(val, text)
                is_grounded = status == GroundingStatus.GROUNDED
                conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
                field_meta[f_path] = FieldMeta(
                    confidence=conf,
                    grounded=is_grounded,
                    source=evaluate_field_source(False, is_grounded),
                    alternatives=[],
                    grounding_status=status,
                    evidence=ev,
                )
                if not is_grounded:
                    warnings.append(
                        ExtractionWarning(
                            path=f_path,
                            code=WarningCode.UNSUPPORTED_VALUE,
                            message=(
                                "Experience field could not be grounded in source text."
                            ),
                        )
                    )

        for d_name in ("startDate", "endDate"):
            d_val = exp.get(d_name)
            if d_val:
                f_path = build_field_path("experience", exp_idx, d_name)
                status, ev = match_date_value(d_val, text)
                is_grounded = status in (
                    GroundingStatus.GROUNDED,
                    GroundingStatus.PARTIALLY_GROUNDED,
                )
                conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
                field_meta[f_path] = FieldMeta(
                    confidence=conf,
                    grounded=is_grounded,
                    source=evaluate_field_source(False, is_grounded),
                    alternatives=[],
                    grounding_status=status,
                    evidence=ev,
                )
                if not is_grounded:
                    warnings.append(
                        ExtractionWarning(
                            path=f_path,
                            code=WarningCode.UNSUPPORTED_VALUE,
                            message=(
                                "Experience date could not be grounded in source text."
                            ),
                        )
                    )

        for b_idx, bullet in enumerate(exp.get("bullets", [])):
            if bullet:
                f_path = build_field_path("experience", exp_idx, "bullets", b_idx)
                status, ev = match_long_text(bullet, text)
                is_grounded = status in (
                    GroundingStatus.GROUNDED,
                    GroundingStatus.PARTIALLY_GROUNDED,
                )
                conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
                field_meta[f_path] = FieldMeta(
                    confidence=conf,
                    grounded=is_grounded,
                    source=evaluate_field_source(False, is_grounded),
                    alternatives=[],
                    grounding_status=status,
                    evidence=ev,
                )
                if not is_grounded:
                    warnings.append(
                        ExtractionWarning(
                            path=f_path,
                            code=WarningCode.UNSUPPORTED_VALUE,
                            message=(
                                "Experience bullet could not be grounded in "
                                "source text."
                            ),
                        )
                    )

    # -----------------------------------------------------------------------
    # 7. Grounding: Skills
    # -----------------------------------------------------------------------
    for s_idx, skill in enumerate(data_dict.get("skills", [])):
        s_name = skill.get("name")
        if s_name:
            f_path = build_field_path("skills", s_idx, "name")
            status, ev = match_text_value(s_name, text)
            is_grounded = status == GroundingStatus.GROUNDED
            conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
            field_meta[f_path] = FieldMeta(
                confidence=conf,
                grounded=is_grounded,
                source=evaluate_field_source(False, is_grounded),
                alternatives=[],
                grounding_status=status,
                evidence=ev,
            )
            if not is_grounded:
                warnings.append(
                    ExtractionWarning(
                        path=f_path,
                        code=WarningCode.UNSUPPORTED_VALUE,
                        message="Skill could not be grounded in source document text.",
                    )
                )

    # -----------------------------------------------------------------------
    # 8. Grounding: Projects
    # -----------------------------------------------------------------------
    for p_idx, proj in enumerate(data_dict.get("projects", [])):
        if proj.get("name"):
            f_path = build_field_path("projects", p_idx, "name")
            status, ev = match_text_value(proj["name"], text)
            is_grounded = status == GroundingStatus.GROUNDED
            conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
            field_meta[f_path] = FieldMeta(
                confidence=conf,
                grounded=is_grounded,
                source=evaluate_field_source(False, is_grounded),
                alternatives=[],
                grounding_status=status,
                evidence=ev,
            )
            if not is_grounded:
                warnings.append(
                    ExtractionWarning(
                        path=f_path,
                        code=WarningCode.UNSUPPORTED_VALUE,
                        message="Project name could not be grounded in source text.",
                    )
                )

        if proj.get("description"):
            f_path = build_field_path("projects", p_idx, "description")
            status, ev = match_long_text(proj["description"], text)
            is_grounded = status in (
                GroundingStatus.GROUNDED,
                GroundingStatus.PARTIALLY_GROUNDED,
            )
            conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
            field_meta[f_path] = FieldMeta(
                confidence=conf,
                grounded=is_grounded,
                source=evaluate_field_source(False, is_grounded),
                alternatives=[],
                grounding_status=status,
                evidence=ev,
            )

        for l_idx, link_str in enumerate(proj.get("links", [])):
            if link_str:
                f_path = build_field_path("projects", p_idx, "links", l_idx)
                status, ev = match_url_value(link_str, links, text)
                is_grounded = status == GroundingStatus.GROUNDED
                conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
                field_meta[f_path] = FieldMeta(
                    confidence=conf,
                    grounded=is_grounded,
                    source=evaluate_field_source(False, is_grounded),
                    alternatives=[],
                    grounding_status=status,
                    evidence=ev,
                )

    # -----------------------------------------------------------------------
    # 9. Grounding: Achievements
    # -----------------------------------------------------------------------
    for a_idx, ach in enumerate(data_dict.get("achievements", [])):
        if ach.get("title"):
            f_path = build_field_path("achievements", a_idx, "title")
            status, ev = match_text_value(ach["title"], text)
            is_grounded = status == GroundingStatus.GROUNDED
            conf = evaluate_field_confidence(status, FieldSource.LLM_CHECK)
            field_meta[f_path] = FieldMeta(
                confidence=conf,
                grounded=is_grounded,
                source=evaluate_field_source(False, is_grounded),
                alternatives=[],
                grounding_status=status,
                evidence=ev,
            )

    merged_resume = ResumeData.model_validate(data_dict)
    return merged_resume, field_meta, warnings
