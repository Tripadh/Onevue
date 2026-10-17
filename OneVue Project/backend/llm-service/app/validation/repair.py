"""Bounded repair orchestrator and validation recovery for ResumeDraft.

Coordinates normalization, schema constraint validation, and allows at most ONE
repair attempt to the upstream LLM provider. If repair fails or returns an invalid
draft, falls back to a deterministic, safe partial ResumeData instance.
"""

import logging
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.providers.base import LLMProvider
from app.schemas.errors import ErrorCode, StructuredError, WarningCode
from app.schemas.llm_draft import ResumeDraft
from app.schemas.response import ExtractionStatus, ExtractionWarning
from app.schemas.resume import ResumeData, is_end_date_before_start_date
from app.validation.normalizer import normalize_draft
from app.validation.validator import validate_draft

logger = logging.getLogger(__name__)


class ValidationResult(BaseModel):
    """Typed outcome of normalization, validation, and optional bounded repair."""

    model_config = ConfigDict(extra="forbid")

    success: bool
    status: ExtractionStatus
    data: ResumeData
    warnings: list[ExtractionWarning] = Field(default_factory=list)
    errors: list[StructuredError] = Field(default_factory=list)
    repaired: bool = False
    repair_attempted: bool = False


def _sanitize_to_valid_resume_data(
    draft: ResumeDraft,
) -> tuple[ResumeData, list[ExtractionWarning]]:
    """Resolve remaining schema violations to produce a safe partial ResumeData."""
    warnings: list[ExtractionWarning] = []
    draft_dict: dict[str, Any] = draft.model_dump()

    # 1. Resolve education date ordering
    for idx, edu in enumerate(draft_dict.get("education", [])):
        s_date, e_date = edu.get("startDate"), edu.get("endDate")
        if s_date and e_date and is_end_date_before_start_date(s_date, e_date):
            edu["endDate"] = None
            warnings.append(
                ExtractionWarning(
                    path=f"education[{idx}].endDate",
                    code=WarningCode.INVALID_DATE,
                    message="Education endDate earlier than startDate; omitted.",
                )
            )

    # 2. Resolve experience contradictions and date ordering
    for idx, exp in enumerate(draft_dict.get("experience", [])):
        if exp.get("isCurrent") and exp.get("endDate") is not None:
            exp["endDate"] = None
            warnings.append(
                ExtractionWarning(
                    path=f"experience[{idx}].endDate",
                    code=WarningCode.CONFLICT,
                    message="Contradictory current role endDate omitted.",
                )
            )
        s_date, e_date = exp.get("startDate"), exp.get("endDate")
        if s_date and e_date and is_end_date_before_start_date(s_date, e_date):
            exp["endDate"] = None
            warnings.append(
                ExtractionWarning(
                    path=f"experience[{idx}].endDate",
                    code=WarningCode.INVALID_DATE,
                    message=(
                        "Experience endDate earlier than startDate; endDate omitted."
                    ),
                )
            )

    # 3. Filter invalid skills with empty name
    valid_skills = [
        s for s in draft_dict.get("skills", []) if s.get("name") and s["name"].strip()
    ]
    draft_dict["skills"] = valid_skills

    # 4. Filter invalid social links with empty platform or url
    valid_links = [
        sl
        for sl in draft_dict.get("socialLinks", [])
        if sl.get("platform")
        and sl["platform"].strip()
        and sl.get("url")
        and sl["url"].strip()
    ]
    draft_dict["socialLinks"] = valid_links

    safe_data = ResumeData.model_validate(draft_dict)
    return safe_data, warnings


async def validate_and_repair_draft(
    draft: ResumeDraft,
    provider: LLMProvider | None = None,
) -> ValidationResult:
    """Normalize, validate, and optionally attempt ONE bounded repair request.

    Args:
        draft: Raw ResumeDraft returned by the LLM extraction provider.
        provider: Optional LLMProvider instance with repair capability.

    Returns:
        ValidationResult containing validated ResumeData, status, and warnings.
    """
    # 1. Normalization
    norm_draft, norm_warnings = normalize_draft(draft)

    # 2. Validation
    issues = validate_draft(norm_draft)

    # 3. Fast path: completely valid
    if not issues:
        resume_data = ResumeData.model_validate(norm_draft.model_dump())
        return ValidationResult(
            success=True,
            status=ExtractionStatus.OK,
            data=resume_data,
            warnings=norm_warnings,
            repaired=False,
            repair_attempted=False,
        )

    # 4. If invalid and provider is available: attempt at most ONE repair
    if provider is not None and hasattr(provider, "repair"):
        logger.info(
            "Validation identified %d issues; initiating bounded repair attempt",
            len(issues),
        )
        issue_messages = [f"{iss.path}: {iss.message}" for iss in issues]

        try:
            repair_result = await provider.repair(
                draft=norm_draft,
                issues=issue_messages,
            )
        except Exception as exc:
            logger.warning(
                "Provider repair attempt failed with exception: %s",
                type(exc).__name__,
            )
            safe_data, safe_warnings = _sanitize_to_valid_resume_data(norm_draft)
            error = StructuredError(
                code=ErrorCode.INVALID_OUTPUT,
                message=(
                    "Draft failed schema validation and repair could not complete."
                ),
            )
            return ValidationResult(
                success=False,
                status=ExtractionStatus.PARTIAL,
                data=safe_data,
                warnings=norm_warnings + safe_warnings,
                errors=[error],
                repaired=False,
                repair_attempted=True,
            )

        # 5. Normalize and validate repaired draft
        repaired_draft = repair_result.draft
        norm_rep, rep_warnings = normalize_draft(repaired_draft)
        rep_issues = validate_draft(norm_rep)

        if not rep_issues:
            logger.info("Draft repair succeeded and passed validation")
            repaired_data = ResumeData.model_validate(norm_rep.model_dump())
            return ValidationResult(
                success=True,
                status=ExtractionStatus.OK,
                data=repaired_data,
                warnings=norm_warnings + rep_warnings,
                repaired=True,
                repair_attempted=True,
            )

        # 6. Repaired draft is still invalid; DO NOT RETRY AGAIN
        logger.warning(
            "Repaired draft still contains %d issues; returning partial profile",
            len(rep_issues),
        )
        safe_data, safe_warnings = _sanitize_to_valid_resume_data(norm_rep)
        error = StructuredError(
            code=ErrorCode.INVALID_OUTPUT,
            message="Repaired draft failed schema validation constraints.",
        )
        return ValidationResult(
            success=False,
            status=ExtractionStatus.PARTIAL,
            data=safe_data,
            warnings=norm_warnings + rep_warnings + safe_warnings,
            errors=[error],
            repaired=False,
            repair_attempted=True,
        )

    # 7. No provider available for repair; resolve safely to partial
    safe_data, safe_warnings = _sanitize_to_valid_resume_data(norm_draft)
    error = StructuredError(
        code=ErrorCode.INVALID_OUTPUT,
        message="Draft contained validation errors and no provider for repair.",
    )
    return ValidationResult(
        success=False,
        status=ExtractionStatus.PARTIAL,
        data=safe_data,
        warnings=norm_warnings + safe_warnings,
        errors=[error],
        repaired=False,
        repair_attempted=False,
    )
