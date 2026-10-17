"""Unit tests for source grounding, deterministic confidence policy, and field merging.

All tests operate offline with synthetic test fixtures and deterministic assertions.
No live provider calls, network access, or credentials are used.
"""

import logging

from app.extraction.pdf import PDFLink
from app.extraction.rules import (
    EmailCandidate,
    PhoneCandidate,
    RuleExtractionResult,
    SourceEvidence,
    URLCandidate,
    URLCategory,
)
from app.grounding.confidence import (
    evaluate_field_confidence,
    evaluate_field_source,
)
from app.grounding.matcher import (
    match_date_value,
    match_long_text,
    match_text_value,
    match_url_value,
)
from app.grounding.merger import ground_and_merge
from app.schemas.errors import WarningCode
from app.schemas.response import (
    Confidence,
    ExtractionMeta,
    ExtractionResponse,
    ExtractionStatus,
    ExtractionWarning,
    FieldSource,
    GroundingStatus,
)
from app.schemas.resume import (
    Education,
    Experience,
    Profile,
    Project,
    ResumeData,
    Skill,
    SocialLink,
)

# ---------------------------------------------------------------------------
# Synthetic Test Fixtures
# ---------------------------------------------------------------------------

_SUMMARY = (
    "Experienced backend software engineer building distributed cloud services "
    "and high-throughput APIs."
)
_BULLET1 = (
    "Designed and maintained distributed microservices handling over 50k "
    "requests per second."
)

SYNTHETIC_CLEANED_TEXT = f"""
Jane Doe
Senior Backend Engineer
San Francisco, CA
jane.doe@example.com
+1 (415) 555-0199
https://linkedin.com/in/janedoe
https://github.com/janedoe

SUMMARY
{_SUMMARY}

EXPERIENCE
CloudScale Systems - Staff Software Engineer
San Francisco, CA
January 2021 - Present
- {_BULLET1}
- Reduced database p99 latency by 45 percent through cache tier optimizations.

DataCore Inc - Backend Engineer
Austin, TX
2018 - 2020
- Built event-driven ingestion pipelines using Kafka and Python.

EDUCATION
University of California, Berkeley
B.S. Computer Science
2014 - 2018
GPA: 3.85

SKILLS
Python, Go, PostgreSQL, Docker, Kubernetes, Kafka

PROJECTS
MiniCache
https://github.com/janedoe/minicache
A high-performance in-memory cache written in Go.
"""

SYNTHETIC_LINKS = [
    PDFLink(
        url="https://linkedin.com/in/janedoe",
        page=1,
        anchor_text="LinkedIn",
    ),
    PDFLink(
        url="https://github.com/janedoe",
        page=1,
        anchor_text="GitHub",
    ),
    PDFLink(
        url="https://github.com/janedoe/minicache",
        page=1,
        anchor_text="MiniCache Repo",
    ),
    PDFLink(
        url="https://janedoe.dev/portfolio",
        page=1,
        anchor_text="Portfolio",
    ),
]


def make_synthetic_resume_data(**overrides) -> ResumeData:
    base = {
        "profile": Profile(
            name="Jane Doe",
            headline="Senior Backend Engineer",
            email="jane.doe@example.com",
            phone="+1 415-555-0199",
            location="San Francisco, CA",
            summary=(
                "Experienced backend software engineer building distributed "
                "cloud services and high-throughput APIs."
            ),
        ),
        "education": [
            Education(
                institution="University of California, Berkeley",
                degree="B.S. Computer Science",
                fieldOfStudy="Computer Science",
                startDate="2014",
                endDate="2018",
                grade="3.85",
            )
        ],
        "experience": [
            Experience(
                company="CloudScale Systems",
                title="Staff Software Engineer",
                location="San Francisco, CA",
                startDate="2021-01",
                endDate=None,
                isCurrent=True,
                bullets=[
                    (
                        "Designed and maintained distributed microservices "
                        "handling over 50k requests per second."
                    ),
                    (
                        "Reduced database p99 latency by 45 percent through "
                        "cache tier optimizations."
                    ),
                ],
            )
        ],
        "skills": [
            Skill(name="Python"),
            Skill(name="Go"),
            Skill(name="PostgreSQL"),
        ],
        "projects": [
            Project(
                name="MiniCache",
                description="A high-performance in-memory cache written in Go.",
                links=["https://github.com/janedoe/minicache"],
            )
        ],
        "socialLinks": [
            SocialLink(
                platform="LinkedIn",
                url="https://linkedin.com/in/janedoe",
            ),
            SocialLink(
                platform="GitHub",
                url="https://github.com/janedoe",
            ),
        ],
        "achievements": [],
    }
    base.update(overrides)
    return ResumeData(**base)


# ---------------------------------------------------------------------------
# 1. Text Value Grounding Tests
# ---------------------------------------------------------------------------


class TestTextValueGrounding:
    """Tests for exact, normalized, missing, and repeated text matches."""

    def test_exact_text_match(self):
        status, evidence = match_text_value("Jane Doe", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        ev = evidence[0]
        assert ev.source_type == "text"
        assert ev.extracted_value == "Jane Doe"
        assert ev.start_offset is not None
        assert ev.end_offset is not None
        assert SYNTHETIC_CLEANED_TEXT[ev.start_offset : ev.end_offset] == "Jane Doe"

    def test_case_and_whitespace_normalization(self):
        # Case variation and extra whitespace
        status, evidence = match_text_value("JANE    DOE", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        ev = evidence[0]
        assert ev.source_type == "text"
        assert ev.extracted_value == "Jane Doe"
        assert SYNTHETIC_CLEANED_TEXT[ev.start_offset : ev.end_offset] == "Jane Doe"

    def test_missing_source_evidence(self):
        status, evidence = match_text_value(
            "Nonexistent Executive", SYNTHETIC_CLEANED_TEXT
        )
        assert status == GroundingStatus.UNSUPPORTED
        assert evidence == []

    def test_none_or_empty_text_value(self):
        status, evidence = match_text_value("", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.NOT_CHECKED
        assert evidence == []

        status, evidence = match_text_value(None, SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.NOT_CHECKED
        assert evidence == []

    def test_repeated_values_finds_actual_offsets_without_invention(self):
        text = "Python is great. In 2020 I used Python for backend."
        status, evidence = match_text_value("Python", text)
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        # Offsets must correspond to real text location
        ev = evidence[0]
        assert text[ev.start_offset : ev.end_offset] == "Python"
        assert ev.page is None  # Never invent page number for text matches


# ---------------------------------------------------------------------------
# 2. Date Value Grounding Tests
# ---------------------------------------------------------------------------


class TestDateValueGrounding:
    """Tests for full date, year-only, partial, and unsupported date matching."""

    def test_year_only_grounded(self):
        status, evidence = match_date_value("2018", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        ev = evidence[0]
        assert SYNTHETIC_CLEANED_TEXT[ev.start_offset : ev.end_offset] == "2018"

    def test_month_year_exact_grounded(self):
        # In text: "January 2021"
        status, evidence = match_date_value("2021-01", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        ev = evidence[0]
        assert (
            SYNTHETIC_CLEANED_TEXT[ev.start_offset : ev.end_offset].lower()
            == "january 2021"
        )

    def test_partial_date_year_found_month_missing(self):
        # 2018 is in text ("2014 - 2018"), but "May" / "05" is not associated with 2018
        status, evidence = match_date_value("2018-05", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.PARTIALLY_GROUNDED
        assert len(evidence) == 1
        ev = evidence[0]
        assert ev.extracted_value == "2018"
        assert SYNTHETIC_CLEANED_TEXT[ev.start_offset : ev.end_offset] == "2018"

    def test_unsupported_date(self):
        status, evidence = match_date_value("1995-12", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.UNSUPPORTED
        assert evidence == []

    def test_empty_date(self):
        status, evidence = match_date_value(None, SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.NOT_CHECKED
        assert evidence == []


# ---------------------------------------------------------------------------
# 3. URL Value Grounding Tests
# ---------------------------------------------------------------------------


class TestURLValueGrounding:
    """Tests for URL grounding against PDF annotations and visible text."""

    def test_url_grounded_via_pdf_annotation(self):
        status, evidence = match_url_value(
            "https://janedoe.dev/portfolio",
            SYNTHETIC_LINKS,
            "No visible url here",
        )
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        ev = evidence[0]
        assert ev.source_type == "annotation"
        assert ev.page == 1
        assert ev.anchor_text == "Portfolio"
        assert ev.extracted_value == "https://janedoe.dev/portfolio"

    def test_url_grounded_via_text(self):
        status, evidence = match_url_value(
            "https://github.com/janedoe",
            [],  # No links
            SYNTHETIC_CLEANED_TEXT,
        )
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        ev = evidence[0]
        assert ev.source_type == "text"
        assert "github.com/janedoe" in ev.extracted_value.lower()

    def test_canonical_url_normalization(self):
        # Schema and www normalization
        status, evidence = match_url_value(
            "http://www.linkedin.com/in/janedoe/",
            SYNTHETIC_LINKS,
            SYNTHETIC_CLEANED_TEXT,
        )
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) >= 1

    def test_unsupported_url(self):
        status, evidence = match_url_value(
            "https://unsupported-site.example.com",
            SYNTHETIC_LINKS,
            SYNTHETIC_CLEANED_TEXT,
        )
        assert status == GroundingStatus.UNSUPPORTED
        assert evidence == []

    def test_empty_url(self):
        status, evidence = match_url_value("", SYNTHETIC_LINKS, SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.NOT_CHECKED
        assert evidence == []


# ---------------------------------------------------------------------------
# 4. Long Text & Bullet Grounding Tests
# ---------------------------------------------------------------------------


class TestLongTextGrounding:
    """Tests for conservative grounding of bullets, descriptions, and summaries."""

    def test_exact_long_text_match(self):
        bullet = (
            "Designed and maintained distributed microservices handling over "
            "50k requests per second."
        )
        status, evidence = match_long_text(bullet, SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1
        assert evidence[0].extracted_value == bullet

    def test_whitespace_variation_match(self):
        bullet = (
            "Designed   and maintained   distributed microservices   "
            "handling over 50k requests per second."
        )
        status, evidence = match_long_text(bullet, SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.GROUNDED
        assert len(evidence) == 1

    def test_partial_overlap_above_threshold(self):
        # 80%+ words overlap with the Kafka ingestion bullet
        bullet = (
            "Built robust event-driven ingestion pipelines using Kafka "
            "and Python daily."
        )
        status, evidence = match_long_text(bullet, SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.PARTIALLY_GROUNDED
        assert len(evidence) == 1

    def test_substantially_rewritten_description_unsupported(self):
        # Substantially rewritten or hallucinated summary
        rewritten = (
            "Spearheaded enterprise blockchain architecture resulting in 10x ROI "
            "for international stakeholders and global partners."
        )
        status, evidence = match_long_text(rewritten, SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.UNSUPPORTED
        assert evidence == []

    def test_empty_long_text(self):
        status, evidence = match_long_text("", SYNTHETIC_CLEANED_TEXT)
        assert status == GroundingStatus.NOT_CHECKED
        assert evidence == []


# ---------------------------------------------------------------------------
# 5. Deterministic Confidence Policy Tests
# ---------------------------------------------------------------------------


class TestConfidencePolicy:
    """Tests for transparent deterministic confidence assignment."""

    def test_grounded_yields_high_confidence(self):
        conf = evaluate_field_confidence(
            GroundingStatus.GROUNDED, FieldSource.RULES, has_conflict=False
        )
        assert conf == Confidence.HIGH

        conf_llm = evaluate_field_confidence(
            GroundingStatus.GROUNDED, FieldSource.LLM_CHECK, has_conflict=False
        )
        assert conf_llm == Confidence.HIGH

    def test_partially_grounded_yields_medium_confidence(self):
        conf = evaluate_field_confidence(
            GroundingStatus.PARTIALLY_GROUNDED,
            FieldSource.LLM_CHECK,
            has_conflict=False,
        )
        assert conf == Confidence.MEDIUM

    def test_unsupported_yields_low_confidence(self):
        conf = evaluate_field_confidence(
            GroundingStatus.UNSUPPORTED, FieldSource.LLM, has_conflict=False
        )
        assert conf == Confidence.LOW

    def test_conflict_reduces_confidence_to_medium(self):
        conf = evaluate_field_confidence(
            GroundingStatus.GROUNDED, FieldSource.RULES, has_conflict=True
        )
        assert conf == Confidence.MEDIUM

    def test_field_source_attribution(self):
        assert (
            evaluate_field_source(from_rules=True, is_grounded=True)
            == FieldSource.RULES
        )
        assert (
            evaluate_field_source(from_rules=False, is_grounded=True)
            == FieldSource.LLM_CHECK
        )
        assert (
            evaluate_field_source(from_rules=False, is_grounded=False)
            == FieldSource.LLM
        )


# ---------------------------------------------------------------------------
# 6. Field Merging, Conflict Handling, and Precedence Tests
# ---------------------------------------------------------------------------


class TestFieldMergingAndPrecedence:
    """Tests for deterministic merging precedence and conflict handling."""

    def test_supported_deterministic_candidate_takes_precedence(self):
        resume = make_synthetic_resume_data()
        rule_results = RuleExtractionResult(
            emails=[
                EmailCandidate(
                    value="deterministic.jane@example.com",
                    evidence=[
                        SourceEvidence(
                            extracted_value="deterministic.jane@example.com",
                            source_type="text",
                            start_offset=10,
                            end_offset=41,
                        )
                    ],
                )
            ]
        )

        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=rule_results,
        )

        # Selected deterministic candidate
        assert merged.profile.email == "deterministic.jane@example.com"
        meta = field_meta["profile.email"]
        assert meta.source == FieldSource.RULES
        assert meta.grounded is True
        # Since LLM had "jane.doe@example.com", conflict is recorded
        assert "jane.doe@example.com" in meta.alternatives
        assert meta.confidence == Confidence.MEDIUM
        conflict_warns = [w for w in warnings if w.code == WarningCode.CONFLICT]
        assert any(w.path == "profile.email" for w in conflict_warns)

    def test_identical_deterministic_and_llm_email_yields_high_confidence(self):
        resume = make_synthetic_resume_data()
        rule_results = RuleExtractionResult(
            emails=[
                EmailCandidate(
                    value="jane.doe@example.com",
                    evidence=[
                        SourceEvidence(
                            extracted_value="jane.doe@example.com",
                            source_type="text",
                            start_offset=45,
                            end_offset=65,
                        )
                    ],
                )
            ]
        )

        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=rule_results,
        )

        assert merged.profile.email == "jane.doe@example.com"
        meta = field_meta["profile.email"]
        assert meta.source == FieldSource.RULES
        assert meta.confidence == Confidence.HIGH
        assert meta.alternatives == []
        assert not any(w.path == "profile.email" for w in warnings)

    def test_conflicting_phone_numbers(self):
        resume = make_synthetic_resume_data()
        rule_results = RuleExtractionResult(
            phones=[
                PhoneCandidate(
                    value="+1 (415) 555-0199",
                    normalized="+14155550199",
                    evidence=[
                        SourceEvidence(
                            extracted_value="+1 (415) 555-0199",
                            source_type="text",
                            start_offset=66,
                            end_offset=83,
                        )
                    ],
                )
            ]
        )
        # Give LLM a conflicting phone number
        resume.profile.phone = "+1 202-555-9999"

        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=rule_results,
        )

        assert merged.profile.phone == "+1 (415) 555-0199"
        meta = field_meta["profile.phone"]
        assert meta.source == FieldSource.RULES
        assert "+1 202-555-9999" in meta.alternatives
        assert meta.confidence == Confidence.MEDIUM
        assert any(
            w.path == "profile.phone" and w.code == WarningCode.CONFLICT
            for w in warnings
        )

    def test_unverified_llm_value_remains_flagged_for_review(self):
        # Create resume with a skill that does not exist anywhere in text
        resume = make_synthetic_resume_data()
        resume.skills.append(Skill(name="Solidity"))

        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=RuleExtractionResult(),
        )

        # Value is preserved in candidate profile for review
        skill_names = [s.name for s in merged.skills]
        assert "Solidity" in skill_names
        solidity_idx = skill_names.index("Solidity")

        meta = field_meta[f"skills[{solidity_idx}].name"]
        assert meta.grounded is False
        assert meta.confidence == Confidence.LOW
        assert meta.grounding_status == GroundingStatus.UNSUPPORTED
        assert meta.source == FieldSource.LLM

        # Warning emitted for review
        assert any(
            w.path == f"skills[{solidity_idx}].name"
            and w.code == WarningCode.UNSUPPORTED_VALUE
            for w in warnings
        )

    def test_never_assume_github_repo_belongs_to_profile(self):
        # In LLM output, someone put a repository URL into socialLinks
        resume = make_synthetic_resume_data()
        resume.socialLinks.append(
            SocialLink(
                platform="GitHub",
                url="https://github.com/torvalds/linux",
            )
        )

        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=RuleExtractionResult(),
        )

        # The repo URL must NOT be kept as personal profile social link
        urls = [sl.url for sl in merged.socialLinks]
        assert "https://github.com/torvalds/linux" not in urls

        # Conflict warning recorded
        assert any(
            w.code == WarningCode.CONFLICT and "Repository URL" in w.message
            for w in warnings
        )

    def test_multiple_legitimate_links_preserved_and_deduplicated(self):
        resume = make_synthetic_resume_data()
        rule_results = RuleExtractionResult(
            urls=[
                URLCandidate(
                    value="https://janedoe.dev/portfolio",
                    url="https://janedoe.dev/portfolio",
                    category=URLCategory.GENERAL,
                    evidence=[
                        SourceEvidence(
                            extracted_value="https://janedoe.dev/portfolio",
                            source_type="annotation",
                            page=1,
                            anchor_text="Portfolio",
                        )
                    ],
                )
            ]
        )

        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=rule_results,
        )

        urls = [sl.url for sl in merged.socialLinks]
        # Both GitHub, LinkedIn, and Portfolio are present
        assert "https://janedoe.dev/portfolio" in urls
        assert "https://github.com/janedoe" in urls
        assert "https://linkedin.com/in/janedoe" in urls

    def test_pre_existing_warnings_preserved(self):
        resume = make_synthetic_resume_data()
        pre_warnings = [
            ExtractionWarning(
                path="profile.headline",
                code=WarningCode.DROPPED_ITEM,
                message="Pre-existing validation notice.",
            )
        ]

        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=RuleExtractionResult(),
            pre_existing_warnings=pre_warnings,
        )

        assert any(
            w.path == "profile.headline" and w.code == WarningCode.DROPPED_ITEM
            for w in warnings
        )

    def test_full_response_serializability(self):
        resume = make_synthetic_resume_data()
        merged, field_meta, warnings = ground_and_merge(
            data=resume,
            text=SYNTHETIC_CLEANED_TEXT,
            links=SYNTHETIC_LINKS,
            rule_results=RuleExtractionResult(),
        )

        response = ExtractionResponse(
            status=ExtractionStatus.OK,
            data=merged,
            fieldMeta=field_meta,
            warnings=warnings,
            meta=ExtractionMeta(
                provider="mocked-groq",
                latencyMs=150,
            ),
        )

        dumped = response.model_dump()
        assert dumped["status"] == "ok"
        assert "profile" in dumped["data"]
        assert "profile.name" in dumped["fieldMeta"]
        # Ensure json serialization succeeds without error
        json_str = response.model_dump_json()
        assert isinstance(json_str, str)
        assert len(json_str) > 0


# ---------------------------------------------------------------------------
# 7. Privacy and Sanitization Tests
# ---------------------------------------------------------------------------


class TestPrivacyAndLogging:
    """Ensure grounding and merging operations never log PII, text, or credentials."""

    def test_no_logging_of_resume_text_or_pii(self, caplog):
        resume = make_synthetic_resume_data()
        with caplog.at_level(logging.DEBUG):
            ground_and_merge(
                data=resume,
                text=SYNTHETIC_CLEANED_TEXT,
                links=SYNTHETIC_LINKS,
                rule_results=RuleExtractionResult(),
            )

        log_content = caplog.text
        assert "jane.doe@example.com" not in log_content
        assert "Jane Doe" not in log_content
        assert "CloudScale Systems" not in log_content
        assert "gsk_" not in log_content
        assert "sk-" not in log_content
