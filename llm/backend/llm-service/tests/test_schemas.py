"""Comprehensive test suite for Phase 2 schemas, validation, contracts, and helpers."""

import json
from typing import Any

import pytest
from pydantic import ValidationError

from app.schemas.errors import ErrorCode, StructuredError, WarningCode
from app.schemas.llm_draft import (
    EducationDraft,
    ExperienceDraft,
    ProfileDraft,
    ResumeDraft,
    SkillDraft,
    SocialLinkDraft,
    get_provider_draft_schema,
)
from app.schemas.path_helpers import build_field_path, parse_field_path
from app.schemas.response import (
    Confidence,
    ExtractionMeta,
    ExtractionResponse,
    ExtractionStatus,
    ExtractionWarning,
    FieldMeta,
    FieldSource,
)
from app.schemas.resume import (
    Achievement,
    Education,
    Experience,
    Profile,
    Project,
    ResumeData,
    Skill,
    SocialLink,
)

# =====================================================================
# 1. FINAL RESUME CONTRACT TESTS (resume.py)
# =====================================================================


class TestFinalResumeSchema:
    """Test suite for the strict, validated final resume contract."""

    def test_valid_complete_resume(self):
        """Verify that a fully populated resume model instantiates and serializes."""
        resume = ResumeData(
            profile=Profile(
                name="Ada Lovelace",
                headline="Computing Pioneer",
                email="ada@analytical-engine.org",
                phone="+44 20 7946 0912",
                location="London, UK",
                summary="Mathematician and computer scientist.",
            ),
            education=[
                Education(
                    institution="University of London",
                    degree="Master of Science",
                    fieldOfStudy="Mathematics",
                    startDate="1832-09",
                    endDate="1834-06",
                    grade="First Class Honours",
                )
            ],
            experience=[
                Experience(
                    company="Babbage Analytical Lab",
                    title="Lead Computational Theorist",
                    location="London, UK",
                    startDate="1840-01",
                    endDate="1843-12",
                    isCurrent=False,
                    bullets=[
                        "Authored the first computer algorithm.",
                        "Analyzed Bernoulli numbers computation.",
                    ],
                )
            ],
            skills=[Skill(name="Mathematics"), Skill(name="Algorithm Design")],
            projects=[
                Project(
                    name="Bernoulli Sequence Generator",
                    description="Algorithmic translation for the Analytical Engine.",
                    technologies=["Algorithms", "Punched Cards"],
                    links=["https://archive.org/ada-notes"],
                )
            ],
            achievements=[
                Achievement(
                    title="First Computer Programmer",
                    description=(
                        "Recognized by history as author of first computer program."
                    ),
                )
            ],
            socialLinks=[
                SocialLink(
                    platform="Historical Archive",
                    url="https://en.wikipedia.org/wiki/Ada_Lovelace",
                )
            ],
        )

        assert resume.profile.name == "Ada Lovelace"
        assert len(resume.education) == 1
        assert len(resume.experience) == 1
        assert len(resume.skills) == 2
        assert len(resume.projects) == 1
        assert len(resume.achievements) == 1
        assert len(resume.socialLinks) == 1

        payload = resume.model_dump(mode="json")
        assert payload["profile"]["name"] == "Ada Lovelace"
        assert payload["education"][0]["degree"] == "Master of Science"
        assert payload["experience"][0]["isCurrent"] is False

    def test_minimal_resume_defaults(self):
        """Verify minimal instantiation with all defaults applied."""
        resume = ResumeData()
        assert resume.profile is not None
        assert resume.profile.name is None
        assert resume.profile.email is None
        assert resume.education == []
        assert resume.experience == []
        assert resume.skills == []
        assert resume.projects == []
        assert resume.achievements == []
        assert resume.socialLinks == []

    def test_optional_fields_serialize_as_null(self):
        """Verify optional factual string fields serialize as JSON null."""
        resume = ResumeData(
            profile=Profile(name="Alan Turing"),
            education=[Education(institution="Cambridge")],
            experience=[Experience(company="Bletchley Park", isCurrent=True)],
        )
        serialized_json = resume.model_dump_json()
        data = json.loads(serialized_json)

        # Profile optional factual fields must be null
        assert data["profile"]["headline"] is None
        assert data["profile"]["email"] is None
        assert data["profile"]["phone"] is None
        assert data["profile"]["location"] is None
        assert data["profile"]["summary"] is None

        # Education optional factual fields must be null
        assert data["education"][0]["degree"] is None
        assert data["education"][0]["fieldOfStudy"] is None
        assert data["education"][0]["startDate"] is None
        assert data["education"][0]["endDate"] is None
        assert data["education"][0]["grade"] is None

        # Experience optional factual fields must be null
        assert data["experience"][0]["title"] is None
        assert data["experience"][0]["location"] is None
        assert data["experience"][0]["startDate"] is None
        assert data["experience"][0]["endDate"] is None

    def test_collections_are_independent_between_instances(self):
        """Verify collection fields do not share mutable defaults."""
        r1 = ResumeData()
        r2 = ResumeData()

        r1.education.append(Education(institution="MIT"))
        r1.experience.append(Experience(company="Acme Corp"))
        r1.skills.append(Skill(name="Python"))
        r1.projects.append(Project(name="OpenSource Project"))
        r1.achievements.append(Achievement(title="Award"))
        r1.socialLinks.append(SocialLink(platform="GitHub", url="https://github.com"))

        assert len(r2.education) == 0
        assert len(r2.experience) == 0
        assert len(r2.skills) == 0
        assert len(r2.projects) == 0
        assert len(r2.achievements) == 0
        assert len(r2.socialLinks) == 0

    @pytest.mark.parametrize(
        "valid_date",
        ["1990", "2020", "2022-01", "2022-12", "2025-06", "2030", "2040-08"],
    )
    def test_valid_dates(self, valid_date: str):
        """Verify acceptance of valid YYYY and YYYY-MM dates including future dates."""
        edu = Education(institution="Tech Institute", startDate=valid_date)
        assert edu.startDate == valid_date

        exp = Experience(company="Tech Corp", startDate=valid_date)
        assert exp.startDate == valid_date

    @pytest.mark.parametrize(
        "invalid_date",
        [
            "2022-00",  # month 00 is invalid
            "2022-13",  # month 13 is invalid
            "2022-1",  # month must be two digits
            "2022-0",
            "22-01",  # year must be four digits
            "2022/01",  # wrong separator
            "Jan 2022",  # natural language not allowed in strict contract
            "January 2022",
            "2022-01-01",  # day not allowed
            "Present",
            "2021 - 2025",
            "",
            "invalid",
        ],
    )
    def test_invalid_dates_rejected(self, invalid_date: str):
        """Verify rejection of malformed, natural language, and out-of-range dates."""
        with pytest.raises(ValidationError):
            Education(institution="Tech Institute", startDate=invalid_date)

        with pytest.raises(ValidationError):
            Experience(company="Tech Corp", endDate=invalid_date)

    @pytest.mark.parametrize(
        ("start", "end"),
        [
            ("2022", "2021"),
            ("2022-05", "2022-04"),
            ("2022-10", "2021-12"),
            ("2025", "2024"),
        ],
    )
    def test_end_date_earlier_than_start_date_rejected(self, start: str, end: str):
        """Verify endDate earlier than startDate raises ValidationError."""
        with pytest.raises(ValidationError):
            Education(institution="MIT", startDate=start, endDate=end)

        with pytest.raises(ValidationError):
            Experience(company="Google", startDate=start, endDate=end)

    @pytest.mark.parametrize(
        ("start", "end"),
        [
            ("2022", "2022"),  # identical year
            ("2022-05", "2022-05"),  # identical year-month
            ("2022", "2022-01"),  # year-only start with start-of-year month end
            ("2022", "2022-12"),  # year-only start with end-of-year month end
            ("2022-01", "2022"),  # year-month start with year-only end
            ("2022-12", "2022"),  # year-month start with year-only end
            ("2020", "2025"),  # year-only ascending
            ("2020-03", "2025-09"),  # year-month ascending
            ("2020", "2025-06"),  # year-only start, future year-month end
            ("2020-06", "2025"),  # year-month start, future year-only end
        ],
    )
    def test_valid_year_and_year_month_combinations(self, start: str, end: str):
        """Verify correct comparison between year-only and year-month values."""
        edu = Education(institution="Stanford", startDate=start, endDate=end)
        assert edu.startDate == start
        assert edu.endDate == end

        exp = Experience(company="DeepMind", startDate=start, endDate=end)
        assert exp.startDate == start
        assert exp.endDate == end

    @pytest.mark.parametrize(
        ("start", "end"),
        [
            ("2023-01", "2022"),  # end year earlier than start year
            ("2022", "2021-12"),  # end year earlier than start year
            ("2025-06", "2024"),  # end year earlier than start year
        ],
    )
    def test_invalid_year_and_year_month_comparisons_rejected(
        self, start: str, end: str
    ):
        """Verify comparisons detect inverted dates between years and months."""
        with pytest.raises(ValidationError):
            Education(institution="Stanford", startDate=start, endDate=end)

    def test_current_experience_requires_null_end_date(self):
        """Verify Experience.isCurrent=True rejects non-null endDate."""
        with pytest.raises(ValidationError, match="endDate must be None"):
            Experience(company="Acme", isCurrent=True, endDate="2024")

        with pytest.raises(ValidationError, match="endDate must be None"):
            Experience(company="Acme", isCurrent=True, endDate="2024-05")

        # Must succeed when endDate is None
        exp = Experience(company="Acme", isCurrent=True, endDate=None)
        assert exp.isCurrent is True
        assert exp.endDate is None

    @pytest.mark.parametrize("empty_val", ["", "   ", "\t\n  "])
    def test_skill_name_rejects_empty_and_whitespace(self, empty_val: str):
        """Verify Skill.name rejects empty and whitespace-only values."""
        with pytest.raises(ValidationError):
            Skill(name=empty_val)

    def test_skill_name_trims_surrounding_whitespace(self):
        """Verify Skill.name trims whitespace."""
        skill = Skill(name="  FastAPI  ")
        assert skill.name == "FastAPI"

    @pytest.mark.parametrize("empty_val", ["", "   ", "\t"])
    def test_social_link_rejects_empty_and_whitespace(self, empty_val: str):
        """Verify SocialLink platform and url reject empty or whitespace strings."""
        with pytest.raises(ValidationError):
            SocialLink(platform=empty_val, url="https://example.com")

        with pytest.raises(ValidationError):
            SocialLink(platform="LinkedIn", url=empty_val)

    def test_social_link_trims_surrounding_whitespace(self):
        """Verify SocialLink platform and url trim whitespace."""
        link = SocialLink(
            platform="  GitHub  ",
            url="  https://github.com/onevue  ",
        )
        assert link.platform == "GitHub"
        assert link.url == "https://github.com/onevue"

    def test_unknown_fields_rejected_extra_forbid(self):
        """Verify extra='forbid' rejects unexpected fields."""
        with pytest.raises(ValidationError):
            Profile(name="Ada", unknown_attr="value")

        with pytest.raises(ValidationError):
            Education(institution="MIT", gpa=4.0)

        with pytest.raises(ValidationError):
            Experience(company="Acme", salary=100000)

        with pytest.raises(ValidationError):
            Skill(name="Python", level="Expert")

        with pytest.raises(ValidationError):
            Project(name="App", stars=150)

        with pytest.raises(ValidationError):
            Achievement(title="Award", year="2022")

        with pytest.raises(ValidationError):
            SocialLink(platform="X", url="https://x.com", handle="@user")

        with pytest.raises(ValidationError):
            ResumeData(custom_field="not allowed")


# =====================================================================
# 2. LENIENT LLM DRAFT TESTS (llm_draft.py)
# =====================================================================


class TestLlmDraftSchema:
    """Test suite for lenient LLM drafts and provider-facing strict JSON Schema."""

    @pytest.mark.parametrize(
        "raw_date",
        [
            "Jan 2022",
            "January 2022",
            "01/2022",
            "2021 - 2025",
            "Present",
            "Expected 2026",
            "Fall 2023",
            "Summer '21",
        ],
    )
    def test_accepts_natural_language_dates(self, raw_date: str):
        """Verify LLM draft models accept natural language and non-standard dates."""
        edu = EducationDraft(institution="State Univ", startDate=raw_date)
        assert edu.startDate == raw_date

        exp = ExperienceDraft(company="Startup Inc", endDate=raw_date)
        assert exp.endDate == raw_date

    def test_draft_does_not_enforce_date_ordering_or_is_current(self):
        """Verify draft models do not enforce cross-field ordering or isCurrent."""
        # Start date after end date should NOT be rejected in draft
        exp = ExperienceDraft(
            company="Startup Inc",
            startDate="2026",
            endDate="2020",
            isCurrent=True,
        )
        assert exp.startDate == "2026"
        assert exp.endDate == "2020"
        assert exp.isCurrent is True

    def test_draft_accepts_nullable_fields_and_defaults(self):
        """Verify draft models allow null values for required string fields."""
        skill = SkillDraft(name=None)
        assert skill.name is None

        link = SocialLinkDraft(platform=None, url=None)
        assert link.platform is None
        assert link.url is None

        draft = ResumeDraft()
        assert draft.profile.name is None
        assert draft.education == []
        assert draft.experience == []
        assert draft.skills == []

    def test_draft_rejects_unknown_fields(self):
        """Verify draft models reject extra unexpected fields."""
        with pytest.raises(ValidationError):
            ProfileDraft(name="Test", unrecognized="leak")

        with pytest.raises(ValidationError):
            ResumeDraft(unrecognized="leak")

    def test_provider_facing_schema_recursively_valid(self):
        """Inspect generated provider-facing schema recursively for compliance."""
        schema = get_provider_draft_schema(ResumeDraft)
        forbidden_keywords = {
            "format",
            "pattern",
            "minLength",
            "maxLength",
            "minimum",
            "maximum",
            "exclusiveMinimum",
            "exclusiveMaximum",
            "multipleOf",
            "minItems",
            "maxItems",
            "uniqueItems",
            "default",
        }

        def check_node(node: Any, path: str = "root"):
            if isinstance(node, dict):
                # Forbidden keywords must not be present
                for kw in forbidden_keywords:
                    assert kw not in node, (
                        f"Forbidden keyword '{kw}' found at path '{path}'"
                    )

                # Objects must set additionalProperties: false and list all properties
                is_object = node.get("type") == "object" or "properties" in node
                if is_object:
                    assert node.get("additionalProperties") is False, (
                        f"additionalProperties must be False at '{path}'"
                    )
                    properties = node.get("properties", {})
                    assert isinstance(properties, dict)
                    required = node.get("required")
                    assert isinstance(required, list), (
                        f"'required' array must be present at '{path}'"
                    )
                    assert set(required) == set(properties.keys()), (
                        f"Every property must be in required at '{path}'. "
                        f"Expected {set(properties.keys())}, got {set(required)}"
                    )

                for key, val in node.items():
                    check_node(val, f"{path}.{key}")

            elif isinstance(node, list):
                for idx, item in enumerate(node):
                    check_node(item, f"{path}[{idx}]")

        check_node(schema)

    def test_provider_schema_top_level_and_defs(self):
        """Verify top-level and defs properties in provider draft schema."""
        schema = get_provider_draft_schema(ResumeDraft)

        assert schema["type"] == "object"
        assert schema["additionalProperties"] is False
        assert "$defs" in schema

        expected_top_properties = {
            "profile",
            "education",
            "experience",
            "skills",
            "projects",
            "achievements",
            "socialLinks",
        }
        assert set(schema["properties"].keys()) == expected_top_properties
        assert set(schema["required"]) == expected_top_properties

        # Check nested defs
        defs = schema["$defs"]
        for def_name in [
            "ProfileDraft",
            "EducationDraft",
            "ExperienceDraft",
            "SkillDraft",
            "ProjectDraft",
            "AchievementDraft",
            "SocialLinkDraft",
        ]:
            assert def_name in defs
            def_obj = defs[def_name]
            assert def_obj["type"] == "object"
            assert def_obj["additionalProperties"] is False
            assert set(def_obj["required"]) == set(def_obj["properties"].keys())


# =====================================================================
# 3. RESPONSE AND ERRORS TESTS (response.py, errors.py)
# =====================================================================


class TestResponseAndErrors:
    """Test suite for response envelopes, metadata, and error reporting."""

    def test_successful_response_serialization(self):
        """Verify successful response envelope serialization with full payload."""
        response = ExtractionResponse(
            status=ExtractionStatus.OK,
            data=ResumeData(
                profile=Profile(name="Marie Curie", email="marie@radium.org")
            ),
            fieldMeta={
                "profile.email": FieldMeta(
                    confidence=Confidence.HIGH,
                    grounded=True,
                    source=FieldSource.LLM_CHECK,
                    alternatives=["marie.curie@sorbonne.fr"],
                )
            },
            warnings=[],
            meta=ExtractionMeta(
                schemaVersion="1.0.0",
                provider="groq-llama-3.3-70b",
                fallbackUsed=False,
                latencyMs=482,
                mock=False,
            ),
        )

        serialized = response.model_dump(mode="json")
        assert serialized["status"] == "ok"
        assert serialized["data"]["profile"]["name"] == "Marie Curie"
        assert serialized["fieldMeta"]["profile.email"]["confidence"] == "high"
        assert serialized["fieldMeta"]["profile.email"]["source"] == "llm+check"
        assert serialized["meta"]["latencyMs"] == 482
        assert serialized["meta"]["mock"] is False
        assert serialized["error"] is None

    def test_partial_response_with_warnings(self):
        """Verify partial response envelope serialization with warnings."""
        response = ExtractionResponse(
            status=ExtractionStatus.PARTIAL,
            data=ResumeData(profile=Profile(name="Nikola Tesla")),
            warnings=[
                ExtractionWarning(
                    path="experience[0].endDate",
                    code=WarningCode.INVALID_DATE,
                    message="Date 'Circa 1905' normalized to null.",
                ),
                ExtractionWarning(
                    path="",
                    code=WarningCode.INPUT_TRUNCATED,
                    message="Input document exceeded 10 pages; truncated.",
                ),
            ],
            meta=ExtractionMeta(
                provider="nvidia-llama-3.1-nemotron",
                latencyMs=1200,
            ),
        )

        assert response.status == ExtractionStatus.PARTIAL
        assert len(response.warnings) == 2
        assert response.warnings[0].code == WarningCode.INVALID_DATE
        assert response.warnings[1].path == ""

    def test_enum_validation(self):
        """Verify validation of all enum members and rejection of invalid values."""
        # Confidence
        assert Confidence("high") == Confidence.HIGH
        assert Confidence("medium") == Confidence.MEDIUM
        assert Confidence("low") == Confidence.LOW
        with pytest.raises(ValueError):
            Confidence("ultra")

        # FieldSource
        assert FieldSource("rules") == FieldSource.RULES
        assert FieldSource("llm") == FieldSource.LLM
        assert FieldSource("llm+check") == FieldSource.LLM_CHECK
        with pytest.raises(ValueError):
            FieldSource("manual")

        # ExtractionStatus
        assert ExtractionStatus("ok") == ExtractionStatus.OK
        assert ExtractionStatus("partial") == ExtractionStatus.PARTIAL
        with pytest.raises(ValueError):
            ExtractionStatus("failed")

        # ErrorCode
        for code in [
            "INVALID_FILE",
            "FILE_TOO_LARGE",
            "TOO_MANY_PAGES",
            "ENCRYPTED_PDF",
            "SCANNED_PDF",
            "INVALID_OUTPUT",
            "PROVIDER_AUTH",
            "PROVIDER_RATE_LIMITED",
            "PROVIDER_UNAVAILABLE",
            "UNAUTHORIZED",
            "INTERNAL",
        ]:
            assert ErrorCode(code) is not None
        with pytest.raises(ValueError):
            ErrorCode("UNKNOWN_ERROR")

        # WarningCode
        for code in [
            "UNSUPPORTED_VALUE",
            "INVALID_DATE",
            "AMBIGUOUS_DATE",
            "DROPPED_ITEM",
            "INPUT_TRUNCATED",
            "LIST_TRUNCATED",
            "CONFLICT",
            "MOCK_DATA",
        ]:
            assert WarningCode(code) is not None
        with pytest.raises(ValueError):
            WarningCode("UNKNOWN_WARNING")

    def test_structured_error_serialization(self):
        """Verify StructuredError serialization."""
        err = StructuredError(
            code=ErrorCode.PROVIDER_RATE_LIMITED,
            message="Upstream provider rate limit exceeded. Retry after 60s.",
        )
        data = err.model_dump(mode="json")
        assert data["code"] == "PROVIDER_RATE_LIMITED"
        assert "Retry after 60s" in data["message"]

    @pytest.mark.parametrize(
        "leaked_token",
        [
            "sk-1234567890abcdef1234567890",
            "gsk_abcdef1234567890abcdef1234",
            "nvapi-abcdef1234567890abcdef12",
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        ],
    )
    def test_structured_error_rejects_credentials_in_message(self, leaked_token: str):
        """Verify StructuredError blocks accidental emission of secrets."""
        with pytest.raises(
            ValidationError, match="Error message contains sensitive credential"
        ):
            StructuredError(
                code=ErrorCode.PROVIDER_AUTH,
                message=f"Authentication failed with key: {leaked_token}",
            )

    def test_default_lists_and_dicts_are_independent(self):
        """Verify defaults in response models are independent instances."""
        r1 = ExtractionResponse(
            status=ExtractionStatus.OK,
            data=ResumeData(),
            meta=ExtractionMeta(provider="test", latencyMs=10),
        )
        r2 = ExtractionResponse(
            status=ExtractionStatus.OK,
            data=ResumeData(),
            meta=ExtractionMeta(provider="test", latencyMs=10),
        )

        r1.warnings.append(
            ExtractionWarning(
                code=WarningCode.MOCK_DATA,
                message="Synthetic test warning",
            )
        )
        r1.fieldMeta["profile.name"] = FieldMeta(
            confidence=Confidence.HIGH,
            grounded=True,
            source=FieldSource.RULES,
        )

        assert len(r2.warnings) == 0
        assert len(r2.fieldMeta) == 0

        # FieldMeta alternatives independence
        m1 = FieldMeta(
            confidence=Confidence.HIGH, grounded=True, source=FieldSource.RULES
        )
        m2 = FieldMeta(
            confidence=Confidence.HIGH, grounded=True, source=FieldSource.RULES
        )
        m1.alternatives.append("alt1")
        assert len(m2.alternatives) == 0

    def test_response_rejects_extra_fields(self):
        """Verify response models reject extra fields."""
        with pytest.raises(ValidationError):
            ExtractionMeta(provider="groq", latencyMs=100, custom="extra")

        with pytest.raises(ValidationError):
            FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM,
                unknown="extra",
            )


# =====================================================================
# 4. FIELD PATH HELPER TESTS (path_helpers.py)
# =====================================================================


class TestFieldPathHelper:
    """Test suite for field path formatting and parsing."""

    def test_specified_path_examples(self):
        """Verify exact paths specified in requirements are formatted accurately."""
        assert build_field_path("profile", "email") == "profile.email"
        assert (
            build_field_path("education", 0, "institution")
            == "education[0].institution"
        )
        assert (
            build_field_path("experience", 1, "bullets", 2)
            == "experience[1].bullets[2]"
        )
        assert build_field_path("skills", 4, "name") == "skills[4].name"
        assert (
            build_field_path("projects", 0, "technologies", 1)
            == "projects[0].technologies[1]"
        )

    def test_field_path_from_sequence(self):
        """Verify build_field_path accepts lists or tuples of segments."""
        assert (
            build_field_path(["education", 0, "institution"])
            == "education[0].institution"
        )
        assert (
            build_field_path(("experience", 1, "bullets", 2))
            == "experience[1].bullets[2]"
        )

    def test_field_path_edge_cases(self):
        """Verify edge cases such as empty path, negative indices, and invalid types."""
        assert build_field_path() == ""

        with pytest.raises(ValueError, match="List index cannot be negative"):
            build_field_path("experience", -1, "company")

        with pytest.raises(ValueError, match="Path segment cannot be empty"):
            build_field_path("profile", "")

        with pytest.raises(ValueError, match="Path segment cannot be empty"):
            build_field_path("profile", "   ")

        with pytest.raises(TypeError, match="Path segments must be str or int"):
            build_field_path("profile", 3.14)  # type: ignore[arg-type]

    def test_parse_and_roundtrip_field_paths(self):
        """Verify parse_field_path round-trips with build_field_path."""
        examples = [
            "profile.email",
            "education[0].institution",
            "experience[1].bullets[2]",
            "skills[4].name",
            "projects[0].technologies[1]",
        ]
        for original in examples:
            parsed = parse_field_path(original)
            rebuilt = build_field_path(parsed)
            assert rebuilt == original

        assert parse_field_path("") == []
        with pytest.raises(ValueError, match="Invalid field path syntax"):
            parse_field_path("profile..email")
