"""Tests for Phase 11: Second-Opinion Evaluation and Arbitration Policy."""

import socket
from unittest.mock import AsyncMock, patch

import pytest

from app.evaluation.harness import EvaluationHarness
from app.evaluation.models import SecondOpinionComparison
from app.evaluation.second_opinion_cases import (
    build_second_opinion_scenarios,
)
from app.extraction.rules import extract_rule_based_fields
from app.orchestration.guards import RequestCallGuard
from app.orchestration.second_opinion import (
    SecondOpinionTriggerReason,
    arbitrate_second_opinion,
    execute_second_opinion_flow,
    identify_second_opinion_targets,
    is_important_field,
    should_request_second_opinion,
)
from app.providers.base import LLMProvider, ProviderResult, ProviderTimeoutError
from app.schemas.errors import WarningCode
from app.schemas.llm_draft import (
    EducationDraft,
    ExperienceDraft,
    ProfileDraft,
    ResumeDraft,
)
from app.schemas.response import (
    Confidence,
    ExtractionWarning,
    FieldMeta,
    FieldSource,
    GroundingStatus,
)
from app.schemas.resume import Education, Experience, Profile, ResumeData


class MockProvider(LLMProvider):
    """Deterministic mock provider for second-opinion test isolation."""

    name = "mock"
    model = "mock-model"

    async def extract(self, prompt: str) -> ProviderResult:
        return ProviderResult(
            provider="mock",
            model="mock-model",
            draft=ResumeDraft(profile=ProfileDraft(name="Mock User")),
            latency_ms=100.0,
        )


class TestSecondOpinionPolicy:
    """Tests for target identification, eligibility rules, and call budget guards."""

    def test_important_field_check(self) -> None:
        """Verify only core biographical, credential, and role fields are important.

        Note: Contact emails and phone numbers are deterministically extracted and
        are strictly immutable, thus not subject to second-opinion LLM arbitration.
        """
        # Important fields eligible for second-opinion arbitration
        assert is_important_field("profile.name") is True
        assert is_important_field("education[0].degree") is True
        assert is_important_field("education[0].institution") is True
        assert is_important_field("education[0].startDate") is True
        assert is_important_field("education[0].endDate") is True
        assert is_important_field("experience[0].title") is True
        assert is_important_field("experience[0].company") is True
        assert is_important_field("experience[0].startDate") is True
        assert is_important_field("experience[0].endDate") is True

        # Immutable contact fields and non-important fields are excluded
        assert is_important_field("profile.email") is False
        assert is_important_field("profile.phone") is False
        assert is_important_field("profile.summary") is False
        assert is_important_field("skills[0].name") is False
        assert is_important_field("skills[1].category") is False
        assert is_important_field("certifications[0].name") is False
        assert is_important_field("custom_section[0].title") is False

    def test_identify_targets_low_confidence(self) -> None:
        """Verify low-confidence important fields trigger a second opinion target."""
        data = ResumeData(
            profile=Profile(name="Alice Walker"),
            education=[Education(degree="B.S. Physics")],
        )
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            ),
            "education[0].degree": FieldMeta(
                confidence=Confidence.LOW,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            ),
        }
        targets = identify_second_opinion_targets(data, field_meta, warnings=[])

        assert len(targets) == 1
        assert targets[0].path == "education[0].degree"
        assert targets[0].reason == SecondOpinionTriggerReason.LOW_CONFIDENCE

    def test_identify_targets_unsupported_important_field(self) -> None:
        """Verify ungrounded important fields trigger a second opinion target."""
        data = ResumeData(
            profile=Profile(name="Bob Martin"),
            experience=[Experience(title="Senior Architect")],
        )
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            ),
            "experience[0].title": FieldMeta(
                confidence=Confidence.MEDIUM,
                grounded=False,
                grounding_status=GroundingStatus.UNSUPPORTED,
                source=FieldSource.LLM_CHECK,
            ),
        }
        targets = identify_second_opinion_targets(data, field_meta, warnings=[])

        assert len(targets) == 1
        assert targets[0].path == "experience[0].title"
        assert (
            targets[0].reason == SecondOpinionTriggerReason.UNSUPPORTED_IMPORTANT_FIELD
        )

    def test_identify_targets_candidate_conflict(self) -> None:
        """Verify extraction conflict warnings trigger a candidate conflict target."""
        data = ResumeData(
            profile=Profile(name="Charlie Brown"),
        )
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            )
        }
        warnings = [
            ExtractionWarning(
                path="profile.name",
                code=WarningCode.CONFLICT,
                message="Disagreement between primary and extracted candidates.",
            )
        ]
        targets = identify_second_opinion_targets(data, field_meta, warnings)

        assert len(targets) == 1
        assert targets[0].path == "profile.name"
        assert targets[0].reason == SecondOpinionTriggerReason.CANDIDATE_CONFLICT

    def test_identify_targets_date_ambiguity(self) -> None:
        """Verify ambiguous dates on important fields trigger a date target."""
        data = ResumeData(
            education=[Education(startDate="2020-01")],
        )
        field_meta = {
            "education[0].startDate": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            )
        }
        warnings = [
            ExtractionWarning(
                path="education[0].startDate",
                code=WarningCode.AMBIGUOUS_DATE,
                message="Unspecified date format normalized.",
            )
        ]
        targets = identify_second_opinion_targets(data, field_meta, warnings)

        assert len(targets) == 1
        assert targets[0].path == "education[0].startDate"
        assert targets[0].reason == SecondOpinionTriggerReason.DATE_AMBIGUITY

    def test_should_request_second_opinion_clean_case(self) -> None:
        """Verify clean extraction with high confidence requires no second opinion."""
        data = ResumeData(profile=Profile(name="David Miller"))
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            )
        }
        eval_result = should_request_second_opinion(data, field_meta, warnings=[])

        assert eval_result.should_request is False
        assert len(eval_result.targets) == 0
        assert eval_result.budget_exhausted is False

    def test_should_request_second_opinion_budget_exhaustion(self) -> None:
        """Verify budget exhaustion disallows second opinions even with ambiguities."""
        data = ResumeData(profile=Profile(name="Eve Online"))
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.LOW,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            )
        }
        guard = RequestCallGuard(max_calls=2)
        guard.record_attempt("groq")
        guard.record_attempt("nvidia")

        eval_result = should_request_second_opinion(
            data, field_meta, warnings=[], call_guard=guard
        )

        assert eval_result.should_request is False
        assert len(eval_result.targets) == 1
        assert eval_result.budget_exhausted is True


class TestSecondOpinionArbitration:
    """Tests for arbitration precedence, contact invariance, and grounding rules."""

    def test_deterministic_contact_invariance(self) -> None:
        """Verify deterministic rule emails and phones are never altered by opinion."""
        primary_data = ResumeData(
            profile=Profile(
                name="Fiona Gallagher",
                email="fiona@chicago.edu",
                phone="+1 (312) 555-0199",
            )
        )
        # Second opinion attempts to overwrite with a different email/phone
        second_draft = ResumeDraft(
            profile=ProfileDraft(
                name="Fiona Gallagher",
                email="hallucinated@example.com",
                phone="+18005559999",
            )
        )
        rules_res = extract_rule_based_fields(
            "Fiona Gallagher\nfiona@chicago.edu\n+1 (312) 555-0199"
        )

        arbitrated, _, warnings, corrections, incorrect_changes = (
            arbitrate_second_opinion(
                primary_data=primary_data,
                second_opinion_draft=second_draft,
                text="Fiona Gallagher\nfiona@chicago.edu\n+1 (312) 555-0199",
                rule_results=rules_res,
            )
        )

        assert arbitrated.profile.email == "fiona@chicago.edu"
        assert arbitrated.profile.phone == rules_res.phones[0].value
        assert arbitrated.profile.phone != "+18005559999"
        assert arbitrated.profile.email != "hallucinated@example.com"
        assert incorrect_changes == 0

    def test_grounded_precedence_rejects_hallucination(self) -> None:
        """Verify second-opinion hallucinations cannot overwrite grounded values."""
        resume_text = "George Washington\nLead Surveyor at Mount Vernon"
        primary_data = ResumeData(
            profile=Profile(name="George Washington"),
            experience=[Experience(title="Lead Surveyor", company="Mount Vernon")],
        )
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            ),
            "experience[0].title": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            ),
        }
        # Second opinion suggests an ungrounded hallucination
        second_draft = ResumeDraft(
            profile=ProfileDraft(name="George Washington"),
            experience=[
                ExperienceDraft(title="Chief Executive Officer", company="Mount Vernon")
            ],
        )

        arbitrated, meta, warnings, corrections, incorrect_changes = (
            arbitrate_second_opinion(
                primary_data=primary_data,
                second_opinion_draft=second_draft,
                text=resume_text,
                pre_existing_field_meta=field_meta,
            )
        )

        assert arbitrated.experience[0].title == "Lead Surveyor"
        assert corrections == 0
        assert incorrect_changes == 0
        assert any(
            w.code == WarningCode.UNSUPPORTED_VALUE
            and "experience[0].title" in (w.path or "")
            for w in warnings
        )

    def test_supported_correction_applied(self) -> None:
        """Verify grounded second opinion corrects ungrounded primary field."""
        resume_text = (
            "Hannah Abbott\nEducation: M.S. in Herbal Chemistry\nGraduated: May 2021"
        )
        primary_data = ResumeData(
            profile=Profile(name="Hannah Abbott"),
            education=[Education(degree="B.A. Arts", startDate=None, endDate=None)],
        )
        field_meta = {
            "education[0].degree": FieldMeta(
                confidence=Confidence.LOW,
                grounded=False,
                grounding_status=GroundingStatus.UNSUPPORTED,
                source=FieldSource.LLM_CHECK,
            ),
        }
        # Second opinion correctly identifies M.S. degree present in text
        second_draft = ResumeDraft(
            profile=ProfileDraft(name="Hannah Abbott"),
            education=[
                EducationDraft(
                    degree="M.S. in Herbal Chemistry",
                    endDate="2021-05",
                )
            ],
        )

        arbitrated, meta, warnings, corrections, incorrect_changes = (
            arbitrate_second_opinion(
                primary_data=primary_data,
                second_opinion_draft=second_draft,
                text=resume_text,
                pre_existing_field_meta=field_meta,
            )
        )

        assert arbitrated.education[0].degree == "M.S. in Herbal Chemistry"
        assert corrections >= 1
        assert incorrect_changes == 0
        assert meta["education[0].degree"].grounded is True

    def test_disagreement_preserves_conflict(self) -> None:
        """Verify when both opinions are grounded, conflict is preserved."""
        resume_text = (
            "Ian Malcolm\nKnown as: Dr. Ian Malcolm\nMathematician and Consultant"
        )
        primary_data = ResumeData(
            profile=Profile(name="Ian Malcolm"),
        )
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            ),
        }
        # Second opinion provides another grounded alternative
        second_draft = ResumeDraft(
            profile=ProfileDraft(name="Dr. Ian Malcolm"),
        )

        arbitrated, meta, warnings, corrections, _ = arbitrate_second_opinion(
            primary_data=primary_data,
            second_opinion_draft=second_draft,
            text=resume_text,
            pre_existing_field_meta=field_meta,
        )

        # Primary value is retained, alternative is recorded, conflict warning generated
        assert arbitrated.profile.name == "Ian Malcolm"
        assert "Dr. Ian Malcolm" in meta["profile.name"].alternatives
        assert any(w.code == WarningCode.CONFLICT for w in warnings)


class TestSecondOpinionFlow:
    """Tests for execute_second_opinion_flow error recovery and validation."""

    @pytest.mark.anyio
    async def test_flow_skips_when_not_eligible(self) -> None:
        """Verify execute_second_opinion_flow returns early when not eligible."""
        data = ResumeData(profile=Profile(name="Julia Child"))
        field_meta = {
            "profile.name": FieldMeta(
                confidence=Confidence.HIGH,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            )
        }
        guard = RequestCallGuard(max_calls=4)
        mock_provider = MockProvider()
        mock_provider.extract = AsyncMock()

        (
            final_data,
            final_meta,
            final_warnings,
            sec_used,
            corrections,
            incorrect_changes,
        ) = await execute_second_opinion_flow(
            data=data,
            field_meta=field_meta,
            warnings=[],
            text="Julia Child\nChef",
            second_opinion_provider=mock_provider,
            call_guard=guard,
        )

        assert sec_used is False
        assert mock_provider.extract.call_count == 0
        assert guard.call_count == 0

    @pytest.mark.anyio
    async def test_flow_provider_timeout_graceful_recovery(self) -> None:
        """Verify provider timeout retains primary extraction safely."""
        data = ResumeData(
            profile=Profile(name="Kevin Flynn"),
            education=[Education(degree="Unknown Degree")],
        )
        field_meta = {
            "education[0].degree": FieldMeta(
                confidence=Confidence.LOW,
                grounded=False,
                grounding_status=GroundingStatus.UNSUPPORTED,
                source=FieldSource.LLM_CHECK,
            )
        }
        guard = RequestCallGuard(max_calls=4)
        failing_provider = MockProvider()
        failing_provider.extract = AsyncMock(
            side_effect=ProviderTimeoutError("Second opinion timed out.")
        )

        (
            final_data,
            final_meta,
            final_warnings,
            sec_used,
            corrections,
            incorrect_changes,
        ) = await execute_second_opinion_flow(
            data=data,
            field_meta=field_meta,
            warnings=[],
            text="Kevin Flynn\nProgrammer",
            second_opinion_provider=failing_provider,
            call_guard=guard,
        )

        assert sec_used is False
        assert final_data.profile.name == "Kevin Flynn"
        assert corrections == 0

    @pytest.mark.anyio
    async def test_flow_discards_invalid_schema_draft(self) -> None:
        """Verify second opinion drafts with schema violations are discarded."""
        data = ResumeData(
            profile=Profile(name="Laura Croft"),
            education=[Education(degree="Archaeology")],
        )
        field_meta = {
            "education[0].degree": FieldMeta(
                confidence=Confidence.LOW,
                grounded=True,
                source=FieldSource.LLM_CHECK,
            )
        }
        guard = RequestCallGuard(max_calls=4)

        # Draft containing invalid date ranges
        malformed_draft = ResumeDraft(
            profile=ProfileDraft(name="Laura Croft"),
            education=[
                EducationDraft(
                    degree="Archaeology",
                    startDate="2025-01",
                    endDate="2020-01",  # Invalid date range
                )
            ],
            experience=[
                ExperienceDraft(
                    title="Adventurer",
                    startDate="2024-01",
                    endDate="2019-01",  # Invalid date range
                ),
                ExperienceDraft(
                    title="Explorer",
                    startDate="2023-01",
                    endDate="2018-01",  # Invalid date range
                ),
                ExperienceDraft(
                    title="Scholar",
                    startDate="2022-01",
                    endDate="2017-01",  # Invalid date range
                ),
            ],
        )
        mock_provider = MockProvider()
        mock_provider.extract = AsyncMock(
            return_value=ProviderResult(
                provider="mock",
                model="mock",
                draft=malformed_draft,
                latency_ms=120.0,
            )
        )

        (
            final_data,
            final_meta,
            final_warnings,
            sec_used,
            corrections,
            incorrect_changes,
        ) = await execute_second_opinion_flow(
            data=data,
            field_meta=field_meta,
            warnings=[],
            text="Laura Croft\nArchaeology",
            second_opinion_provider=mock_provider,
            call_guard=guard,
        )

        assert sec_used is True
        # Malformed draft discarded; primary data preserved
        assert final_data.profile.name == "Laura Croft"
        assert corrections == 0


class TestSecondOpinionComparativeEvaluation:
    """Offline comparative evaluation harness tests verifying metrics and math."""

    def test_scenarios_dataset_validity(self) -> None:
        """Verify all 9 synthetic scenarios are configured with unique IDs."""
        scenarios = build_second_opinion_scenarios()
        assert len(scenarios) == 9

        ids = [sc.case_id for sc in scenarios]
        assert len(ids) == len(set(ids))

        # Check expected scenarios exist
        assert any(sc.case_id == "scenario_1_clean_no_opinion" for sc in scenarios)
        assert any(sc.case_id == "scenario_2_supported_correction" for sc in scenarios)
        assert any(
            sc.case_id == "scenario_3_unsupported_hallucination" for sc in scenarios
        )
        assert any(sc.case_id == "scenario_4_provider_disagreement" for sc in scenarios)
        assert any(sc.case_id == "scenario_5_low_confidence_field" for sc in scenarios)
        assert any(
            sc.case_id == "scenario_6_provider_error_resilience" for sc in scenarios
        )
        assert any(sc.case_id == "scenario_7_invalid_schema_output" for sc in scenarios)
        assert any(sc.case_id == "scenario_8_budget_exhaustion" for sc in scenarios)
        assert any(sc.case_id == "scenario_9_no_useful_improvement" for sc in scenarios)

    @pytest.mark.anyio
    async def test_comparative_evaluation_execution(self) -> None:
        """Verify execution of comparison and documented denominators."""
        harness = EvaluationHarness()
        comparison = await harness.evaluate_second_opinion_strategy()

        assert isinstance(comparison, SecondOpinionComparison)
        assert comparison.scenarios_evaluated == 9

        strat_a = comparison.strategy_a_baseline
        strat_b = comparison.strategy_b_candidate

        # Verify documented denominators
        assert strat_a.field_accuracy.denominator > 0
        assert (
            strat_a.field_accuracy.definition
            == "correct_fields / total_ground_truth_fields"
        )
        assert strat_b.field_accuracy.denominator == strat_a.field_accuracy.denominator

        assert strat_a.unsupported_rate.denominator > 0
        assert (
            strat_a.unsupported_rate.definition
            == "unsupported_fields / total_candidate_fields"
        )

        assert strat_a.grounding_precision.denominator > 0
        assert (
            strat_a.grounding_precision.definition
            == "grounded_fields / total_candidate_fields"
        )

        assert strat_a.grounding_recall.denominator > 0
        assert (
            strat_a.grounding_recall.definition
            == "grounded_gt_fields / total_ground_truth_fields"
        )

        assert strat_b.important_field_correction_rate.denominator > 0
        assert (
            strat_b.important_field_correction_rate.definition
            == "corrected_important_fields / erroneous_important_fields"
        )

        # Baseline Strategy A should make fewer calls and have lower latency
        assert strat_a.provider_calls_per_request < strat_b.provider_calls_per_request
        assert strat_a.synthetic_latency_ms < strat_b.synthetic_latency_ms
        assert comparison.calls_overhead_pct > 0
        assert comparison.latency_overhead_pct > 0

        # Verify acceptance criteria decision
        assert (
            comparison.recommendation
            == "DEFERRED / NOT INTEGRATED INTO PRODUCTION PIPELINE"
        )
        assert "DEFERRED" in comparison.recommendation
        assert len(comparison.rationale) > 50

    @pytest.mark.anyio
    async def test_zero_network_calls_during_second_opinion_evaluation(self) -> None:
        """Ensure no live network calls occur during offline comparative evaluation."""

        def guarded_socket(*args: object, **kwargs: object) -> socket.socket:
            raise RuntimeError(
                "Network connection attempted during second opinion evaluation!"
            )

        with patch("socket.socket", side_effect=guarded_socket):
            harness = EvaluationHarness()
            comparison = await harness.evaluate_second_opinion_strategy()
            assert comparison.scenarios_evaluated == 9
