"""Unit tests for draft normalization, schema validation, and bounded LLM repair.

All tests operate offline with synthetic test fixtures and mocked providers.
No live provider calls are permitted.
"""

from unittest.mock import AsyncMock

import pytest

from app.providers.base import (
    ProviderAuthError,
    ProviderMalformedOutputError,
    ProviderResult,
    ProviderUnavailableError,
    TokenUsage,
)
from app.schemas.errors import ErrorCode, WarningCode
from app.schemas.llm_draft import (
    EducationDraft,
    ExperienceDraft,
    ProfileDraft,
    ProjectDraft,
    ResumeDraft,
    SkillDraft,
    SocialLinkDraft,
)
from app.schemas.response import ExtractionStatus
from app.schemas.resume import ResumeData
from app.validation.dates import normalize_date
from app.validation.normalizer import normalize_draft
from app.validation.repair import (
    ValidationResult,
    validate_and_repair_draft,
)
from app.validation.validator import validate_draft

# ---------------------------------------------------------------------------
# Synthetic Test Fixtures
# ---------------------------------------------------------------------------

SYNTHETIC_VALID_DRAFT = ResumeDraft(
    profile=ProfileDraft(
        name="Alice Smith",
        headline="Senior Systems Engineer",
        email="alice.smith@example.com",
        phone="+1 202-555-0123",
        location="San Francisco, CA",
        summary="Experienced engineer specializing in cloud services.",
    ),
    education=[
        EducationDraft(
            institution="UC Berkeley",
            degree="B.S. in Computer Science",
            startDate="2018",
            endDate="2022",
            grade="3.8",
        )
    ],
    experience=[
        ExperienceDraft(
            company="Acme Corp",
            title="Senior Backend Engineer",
            startDate="2022-01",
            endDate=None,
            isCurrent=True,
            bullets=[
                "Maintained microservices processing 50M requests daily.",
                "Reduced p99 latency by 35% through caching optimization.",
            ],
        )
    ],
    skills=[
        SkillDraft(name="Python"),
        SkillDraft(name="FastAPI"),
        SkillDraft(name="PostgreSQL"),
    ],
    projects=[
        ProjectDraft(
            name="Distributed Cache",
            description="High performance distributed cache built in Go.",
            technologies=["Go", "Raft"],
            links=["https://github.com/alice/cache"],
        )
    ],
    socialLinks=[
        SocialLinkDraft(
            platform="GitHub",
            url="https://github.com/alice",
        )
    ],
)


# ---------------------------------------------------------------------------
# Test Suite: Valid Draft Conversion & Missing Optional Fields
# ---------------------------------------------------------------------------


class TestValidDraftConversion:
    """Verify conversion of valid drafts and handling of optional fields."""

    @pytest.mark.anyio
    async def test_valid_draft_conversion(self) -> None:
        """A valid draft converts cleanly into ResumeData without repair."""
        result = await validate_and_repair_draft(SYNTHETIC_VALID_DRAFT)

        assert isinstance(result, ValidationResult)
        assert result.success is True
        assert result.status == ExtractionStatus.OK
        assert isinstance(result.data, ResumeData)
        assert result.data.profile.name == "Alice Smith"
        assert result.data.profile.email == "alice.smith@example.com"
        assert len(result.data.education) == 1
        assert result.data.education[0].institution == "UC Berkeley"
        assert len(result.data.experience) == 1
        assert result.data.experience[0].company == "Acme Corp"
        assert result.repaired is False
        assert result.repair_attempted is False
        assert result.errors == []

    @pytest.mark.anyio
    async def test_missing_optional_fields_accepted(self) -> None:
        """Draft with missing optional fields converts cleanly without error."""
        minimal_draft = ResumeDraft(
            profile=ProfileDraft(name="Minimal Candidate"),
            education=[],
            experience=[],
            skills=[],
            projects=[],
            achievements=[],
            socialLinks=[],
        )

        result = await validate_and_repair_draft(minimal_draft)

        assert result.success is True
        assert result.status == ExtractionStatus.OK
        assert result.data.profile.name == "Minimal Candidate"
        assert result.data.profile.email is None
        assert result.data.profile.headline is None
        assert result.data.education == []
        assert result.data.experience == []
        assert result.data.skills == []
        assert result.repaired is False
        assert result.repair_attempted is False


# ---------------------------------------------------------------------------
# Test Suite: Safe Normalization
# ---------------------------------------------------------------------------


class TestSafeNormalization:
    """Verify safe formatting, whitespace trimming, and unambiguous dates."""

    def test_safe_whitespace_normalization(self) -> None:
        """Whitespace is trimmed and collapsed without modifying substantive content."""
        draft = ResumeDraft(
            profile=ProfileDraft(
                name="   Bob   Jones   ",
                headline="  Staff   Engineer  ",
                summary="Paragraph 1 line 1.\nParagraph 1 line 2.\n\nParagraph 2.",
            ),
            skills=[SkillDraft(name="  Python   3  ")],
        )

        norm, warnings = normalize_draft(draft)
        assert norm.profile.name == "Bob Jones"
        assert norm.profile.headline == "Staff Engineer"
        # Summary lines are preserved without rewriting
        assert norm.profile.summary == (
            "Paragraph 1 line 1.\nParagraph 1 line 2.\n\nParagraph 2."
        )
        assert norm.skills[0].name == "Python 3"

    @pytest.mark.parametrize(
        ("input_date", "expected_normalized"),
        [
            ("2022", "2022"),
            ("2022-05", "2022-05"),
            ("Jan 2022", "2022-01"),
            ("January 2022", "2022-01"),
            ("Jan, 2022", "2022-01"),
            ("01/2022", "2022-01"),
            ("5/2022", "2022-05"),
            ("2022/01", "2022-01"),
            ("2022-01-15", "2022-01"),
            ("Jan 15, 2022", "2022-01"),
        ],
    )
    def test_unambiguous_date_normalization(
        self, input_date: str, expected_normalized: str
    ) -> None:
        """Unambiguous dates are correctly standardized to YYYY or YYYY-MM."""
        normalized, warning = normalize_date(input_date, path="test.date")
        assert normalized == expected_normalized
        assert warning is None

    def test_empty_bullets_dropped_with_warning(self) -> None:
        """Empty bullets are dropped with DROPPED_ITEM warning."""
        draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Tech Corp",
                    bullets=["Valid bullet", "   ", "", "Another valid bullet"],
                )
            ]
        )

        norm, warnings = normalize_draft(draft)
        assert len(norm.experience[0].bullets) == 2
        assert norm.experience[0].bullets == ["Valid bullet", "Another valid bullet"]
        dropped_warnings = [w for w in warnings if w.code == WarningCode.DROPPED_ITEM]
        assert len(dropped_warnings) == 2


# ---------------------------------------------------------------------------
# Test Suite: Ambiguous Dates
# ---------------------------------------------------------------------------


class TestAmbiguousDates:
    """Verify handling of ambiguous dates without invention or hallucination."""

    @pytest.mark.parametrize(
        "ambiguous_date",
        [
            "Fall 2023",
            "Summer '21",
            "Spring 2020",
            "Winter 2022",
            "Expected 2026",
            "Circa 1905",
            "Q3 2021",
            "Mid 2020",
            "2021 - 2025",
        ],
    )
    def test_ambiguous_dates_produce_warning_and_set_to_none(
        self, ambiguous_date: str
    ) -> None:
        """Ambiguous dates are omitted (set to None) and flagged with AMBIGUOUS_DATE."""
        normalized, warning = normalize_date(
            ambiguous_date, path="education[0].endDate"
        )
        assert normalized is None
        assert warning is not None
        assert warning.code in (WarningCode.AMBIGUOUS_DATE, WarningCode.INVALID_DATE)
        # Warning message must NOT expose raw resume text
        assert ambiguous_date not in warning.message

    @pytest.mark.anyio
    async def test_ambiguous_date_in_draft_converts_to_null_safely(self) -> None:
        """Ambiguous date in draft converts to ResumeData with null date."""
        draft = ResumeDraft(
            education=[
                EducationDraft(
                    institution="Stanford University",
                    degree="M.S.",
                    startDate="2020",
                    endDate="Fall 2023",
                )
            ]
        )

        result = await validate_and_repair_draft(draft)
        assert result.success is True
        assert result.data.education[0].endDate is None
        ambiguous_warnings = [
            w for w in result.warnings if w.code == WarningCode.AMBIGUOUS_DATE
        ]
        assert len(ambiguous_warnings) == 1


# ---------------------------------------------------------------------------
# Test Suite: Date Ranges & Contradictory Fields
# ---------------------------------------------------------------------------


class TestDateRangesAndContradictions:
    """Verify detection of invalid date ranges and employment contradictions."""

    def test_invalid_date_ranges_detected(self) -> None:
        """endDate earlier than startDate is flagged as an invalid issue."""
        draft = ResumeDraft(
            education=[
                EducationDraft(
                    institution="MIT",
                    startDate="2024",
                    endDate="2020",
                )
            ],
            experience=[
                ExperienceDraft(
                    company="Startup Inc",
                    startDate="2023-05",
                    endDate="2022-01",
                )
            ],
        )

        issues = validate_draft(draft)
        assert len(issues) >= 2
        assert any("education[0].endDate" in iss.path for iss in issues)
        assert any("experience[0].endDate" in iss.path for iss in issues)

    def test_current_employment_contradiction_detected(self) -> None:
        """isCurrent=True with concrete past endDate is flagged as contradictory."""
        draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Google",
                    startDate="2020-01",
                    endDate="2022-05",
                    isCurrent=True,
                )
            ]
        )

        issues = validate_draft(draft)
        contradiction = next(
            (iss for iss in issues if "experience[0].endDate" in iss.path), None
        )
        assert contradiction is not None
        assert "isCurrent=True" in contradiction.message

    def test_experience_with_present_normalized_to_current(self) -> None:
        """endDate='Present' normalized to isCurrent=True, endDate=None."""
        draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Apple",
                    startDate="2021-06",
                    endDate="Present",
                    isCurrent=False,
                )
            ]
        )

        norm, _ = normalize_draft(draft)
        assert norm.experience[0].isCurrent is True
        assert norm.experience[0].endDate is None


# ---------------------------------------------------------------------------
# Test Suite: URLs & Schema Violations
# ---------------------------------------------------------------------------


class TestUrlsAndSchemaViolations:
    """Verify URL sanitation and required item validation."""

    def test_schemeless_url_prepends_https(self) -> None:
        """Valid schemeless URL prepends https:// during normalization."""
        draft = ResumeDraft(
            socialLinks=[
                SocialLinkDraft(platform="GitHub", url="github.com/alice"),
            ],
            projects=[
                ProjectDraft(
                    name="Demo",
                    links=["gitlab.com/alice/demo"],
                )
            ],
        )

        norm, _ = normalize_draft(draft)
        assert norm.socialLinks[0].url == "https://github.com/alice"
        assert norm.projects[0].links[0] == "https://gitlab.com/alice/demo"

    def test_malformed_url_dropped_with_warning(self) -> None:
        """Invalid URLs with spaces or missing domain dropped with UNSUPPORTED_VALUE."""
        draft = ResumeDraft(
            projects=[
                ProjectDraft(
                    name="Demo",
                    links=["not a url at all", "https://valid.com"],
                )
            ]
        )

        norm, warnings = normalize_draft(draft)
        assert norm.projects[0].links == ["https://valid.com"]
        assert any(w.code == WarningCode.UNSUPPORTED_VALUE for w in warnings)

    def test_empty_skill_name_omitted_with_warning(self) -> None:
        """Skill entries with empty name are omitted with DROPPED_ITEM."""
        draft = ResumeDraft(
            skills=[
                SkillDraft(name="   "),
                SkillDraft(name="Python"),
                SkillDraft(name=None),
            ]
        )

        norm, warnings = normalize_draft(draft)
        assert len(norm.skills) == 1
        assert norm.skills[0].name == "Python"
        assert any(w.code == WarningCode.DROPPED_ITEM for w in warnings)


# ---------------------------------------------------------------------------
# Test Suite: Bounded Repair Orchestration
# ---------------------------------------------------------------------------


class TestBoundedRepair:
    """Verify single bounded repair attempt, success, failure, and no infinite loop."""

    @pytest.mark.anyio
    async def test_one_successful_repair(self) -> None:
        """Draft with inverted date range triggers one repair call and validates."""
        invalid_draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Acme Corp",
                    startDate="2024",
                    endDate="2021",
                )
            ]
        )

        # Repaired draft with corrected dates
        repaired_draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Acme Corp",
                    startDate="2021",
                    endDate="2024",
                )
            ]
        )

        mock_provider = AsyncMock()
        mock_provider.repair = AsyncMock(
            return_value=ProviderResult(
                draft=repaired_draft,
                provider="groq",
                model="llama-3.3-70b-versatile",
                latency_ms=150,
                token_usage=TokenUsage(total_tokens=100),
            )
        )

        result = await validate_and_repair_draft(invalid_draft, provider=mock_provider)

        assert result.success is True
        assert result.status == ExtractionStatus.OK
        assert result.repaired is True
        assert result.repair_attempted is True
        assert result.data.experience[0].startDate == "2021"
        assert result.data.experience[0].endDate == "2024"
        assert mock_provider.repair.call_count == 1

    @pytest.mark.anyio
    async def test_failed_repair_due_to_provider_exception(self) -> None:
        """Provider repair failure returns safe partial response without retry."""
        invalid_draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Acme Corp",
                    startDate="2024",
                    endDate="2021",
                )
            ]
        )

        mock_provider = AsyncMock()
        mock_provider.repair = AsyncMock(
            side_effect=ProviderUnavailableError("Temporary server error.")
        )

        result = await validate_and_repair_draft(invalid_draft, provider=mock_provider)

        assert result.success is False
        assert result.status == ExtractionStatus.PARTIAL
        assert result.repaired is False
        assert result.repair_attempted is True
        assert len(result.errors) == 1
        assert result.errors[0].code == ErrorCode.INVALID_OUTPUT
        assert mock_provider.repair.call_count == 1
        # Inverted endDate omitted to guarantee valid partial ResumeData
        assert result.data.experience[0].endDate is None

    @pytest.mark.anyio
    async def test_invalid_result_after_repair_returns_partial_without_second_attempt(
        self,
    ) -> None:
        """Invalid repair output does NOT retry again and returns partial."""
        invalid_draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Acme Corp",
                    startDate="2024",
                    endDate="2021",
                )
            ]
        )

        # Repaired draft is STILL invalid (dates still inverted)
        still_invalid_draft = ResumeDraft(
            experience=[
                ExperienceDraft(
                    company="Acme Corp",
                    startDate="2024",
                    endDate="2021",
                )
            ]
        )

        mock_provider = AsyncMock()
        mock_provider.repair = AsyncMock(
            return_value=ProviderResult(
                draft=still_invalid_draft,
                provider="groq",
                model="llama-3.3-70b-versatile",
                latency_ms=120,
            )
        )

        result = await validate_and_repair_draft(invalid_draft, provider=mock_provider)

        assert result.success is False
        assert result.status == ExtractionStatus.PARTIAL
        assert result.repaired is False
        assert result.repair_attempted is True
        # Strictly at most 1 repair call!
        assert mock_provider.repair.call_count == 1
        # Broken endDate omitted to ensure valid partial data
        assert result.data.experience[0].endDate is None

    @pytest.mark.anyio
    async def test_malformed_response_or_auth_error_during_repair(self) -> None:
        """Auth and malformed output errors during repair are handled gracefully."""
        invalid_draft = ResumeDraft(
            education=[
                EducationDraft(
                    institution="MIT",
                    startDate="2024",
                    endDate="2020",
                )
            ]
        )

        mock_provider = AsyncMock()
        mock_provider.repair = AsyncMock(
            side_effect=ProviderAuthError("Authentication failure.")
        )

        result = await validate_and_repair_draft(invalid_draft, provider=mock_provider)

        assert result.status == ExtractionStatus.PARTIAL
        assert result.repair_attempted is True
        assert mock_provider.repair.call_count == 1
        assert isinstance(result.data, ResumeData)


# ---------------------------------------------------------------------------
# Test Suite: Privacy & Sanitization
# ---------------------------------------------------------------------------


class TestPrivacyAndSanitization:
    """Verify that resume content and credentials are never logged."""

    @pytest.mark.anyio
    async def test_no_logging_of_resume_content_or_credentials(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Personal data, sensitive strings, and credentials are absent from logs."""
        import logging

        caplog.set_level(logging.DEBUG)

        sensitive_candidate_name = "SecretCandidateJohnDoe"
        sensitive_company = "ConfidentialIntelligenceOrg"
        sensitive_summary = "Classified security clearances held since 2015."

        draft = ResumeDraft(
            profile=ProfileDraft(
                name=sensitive_candidate_name,
                summary=sensitive_summary,
            ),
            experience=[
                ExperienceDraft(
                    company=sensitive_company,
                    startDate="2024",
                    endDate="2021",  # triggers validation & repair
                )
            ],
        )

        mock_provider = AsyncMock()
        mock_provider.repair = AsyncMock(
            side_effect=ProviderMalformedOutputError(
                "Simulated repair malformed output."
            )
        )

        await validate_and_repair_draft(draft, provider=mock_provider)

        log_text = caplog.text
        assert sensitive_candidate_name not in log_text
        assert sensitive_company not in log_text
        assert sensitive_summary not in log_text
        assert "gsk_" not in log_text
        assert "sk-" not in log_text
