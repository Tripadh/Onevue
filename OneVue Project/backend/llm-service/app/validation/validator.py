"""Validation checks and issue detection for normalized resume drafts."""

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.schemas.errors import ErrorCode, WarningCode
from app.schemas.llm_draft import ResumeDraft
from app.schemas.resume import ResumeData, is_end_date_before_start_date


class ValidationIssue(BaseModel):
    """Specific error or contradiction identified during draft validation."""

    model_config = ConfigDict(extra="forbid")

    path: str
    code: ErrorCode | WarningCode
    message: str
    correctable: bool = Field(
        default=True,
        description="Whether this issue can potentially be resolved by LLM repair.",
    )


def validate_draft(draft: ResumeDraft) -> list[ValidationIssue]:
    """Validate a normalized ResumeDraft against strict schema constraints.

    Identifies date ordering violations, current role contradictions,
    missing required fields on child items, and general schema incompatibilities.

    Args:
        draft: Normalized ResumeDraft to validate.

    Returns:
        List of ValidationIssue items (empty if completely valid).
    """
    issues: list[ValidationIssue] = []

    # 1. Education date ordering
    for idx, edu in enumerate(draft.education):
        if edu.startDate and edu.endDate:
            if is_end_date_before_start_date(edu.startDate, edu.endDate):
                issues.append(
                    ValidationIssue(
                        path=f"education[{idx}].endDate",
                        code=ErrorCode.INVALID_OUTPUT,
                        message=(
                            f"education[{idx}].endDate cannot be chronologically "
                            "earlier than startDate."
                        ),
                        correctable=True,
                    )
                )

    # 2. Experience date ordering and current role constraints
    for idx, exp in enumerate(draft.experience):
        if exp.isCurrent and exp.endDate is not None:
            issues.append(
                ValidationIssue(
                    path=f"experience[{idx}].endDate",
                    code=ErrorCode.INVALID_OUTPUT,
                    message=(
                        f"experience[{idx}] is marked as current (isCurrent=True) "
                        "but specifies an endDate."
                    ),
                    correctable=True,
                )
            )

        if exp.startDate and exp.endDate:
            if is_end_date_before_start_date(exp.startDate, exp.endDate):
                issues.append(
                    ValidationIssue(
                        path=f"experience[{idx}].endDate",
                        code=ErrorCode.INVALID_OUTPUT,
                        message=(
                            f"experience[{idx}].endDate cannot be chronologically "
                            "earlier than startDate."
                        ),
                        correctable=True,
                    )
                )

    # 3. Required fields on list items
    for idx, skill in enumerate(draft.skills):
        if not skill.name or not skill.name.strip():
            issues.append(
                ValidationIssue(
                    path=f"skills[{idx}].name",
                    code=ErrorCode.INVALID_OUTPUT,
                    message=f"skills[{idx}].name is required and cannot be empty.",
                    correctable=True,
                )
            )

    for idx, sl in enumerate(draft.socialLinks):
        if not sl.platform or not sl.platform.strip():
            issues.append(
                ValidationIssue(
                    path=f"socialLinks[{idx}].platform",
                    code=ErrorCode.INVALID_OUTPUT,
                    message=f"socialLinks[{idx}].platform cannot be empty.",
                    correctable=True,
                )
            )
        if not sl.url or not sl.url.strip():
            issues.append(
                ValidationIssue(
                    path=f"socialLinks[{idx}].url",
                    code=ErrorCode.INVALID_OUTPUT,
                    message=f"socialLinks[{idx}].url cannot be empty.",
                    correctable=True,
                )
            )

    # 4. Strict ResumeData model instantiation check
    try:
        ResumeData.model_validate(draft.model_dump())
    except ValidationError as exc:
        for err in exc.errors():
            loc_parts = err.get("loc", ())
            loc_str = ".".join(str(p) for p in loc_parts)
            # Avoid duplicate reporting of already flagged issues
            if not any(iss.path == loc_str for iss in issues):
                issues.append(
                    ValidationIssue(
                        path=loc_str,
                        code=ErrorCode.INVALID_OUTPUT,
                        message="Field failed strict schema validation.",
                        correctable=True,
                    )
                )

    return issues
