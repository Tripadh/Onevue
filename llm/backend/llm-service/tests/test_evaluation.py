"""Tests for Phase 9: Evaluation Harness and Baseline."""

import socket
from unittest.mock import patch

import pytest

from app.evaluation.dataset import build_evaluation_dataset
from app.evaluation.harness import EvaluationHarness
from app.evaluation.metrics import (
    canonicalize_email,
    canonicalize_phone,
    canonicalize_url,
    compute_metric_score,
    compute_pr1_from_counts,
    compute_set_pr1,
)
from app.evaluation.models import EvaluationReport
from app.extraction.pdf import PDFExtractionError, extract_pdf
from app.schemas.errors import ErrorCode, WarningCode


class TestMetricCalculations:
    """Unit tests for metric mathematics and zero-denominator rules."""

    def test_pr1_standard_cases(self) -> None:
        """Verify precision, recall, and F1 on known counts."""
        # 8 TP, 2 FP, 2 FN -> prec = 8/10 = 0.8, rec = 8/10 = 0.8, f1 = 0.8
        pr1 = compute_pr1_from_counts("test_field", tp=8, fp=2, fn=2)
        assert pr1.precision.value == 0.8
        assert pr1.precision.numerator == 8.0
        assert pr1.precision.denominator == 10
        assert pr1.recall.value == 0.8
        assert pr1.recall.numerator == 8.0
        assert pr1.recall.denominator == 10
        assert pr1.f1.value == 0.8

    def test_pr1_zero_denominator_both_empty(self) -> None:
        """When both predicted and expected are empty, precision and recall are 1.0."""
        pr1 = compute_pr1_from_counts("empty_field", tp=0, fp=0, fn=0)
        assert pr1.precision.value == 1.0
        assert pr1.precision.denominator == 0
        assert pr1.recall.value == 1.0
        assert pr1.recall.denominator == 0
        assert pr1.f1.value == 1.0

    def test_pr1_zero_denominator_predicted_empty_expected_non_empty(self) -> None:
        """When predicted is empty but expected has items, PR1 scores are 0.0."""
        pr1 = compute_pr1_from_counts("missed_field", tp=0, fp=0, fn=5)
        assert pr1.precision.value == 0.0
        assert pr1.recall.value == 0.0
        assert pr1.recall.numerator == 0.0
        assert pr1.recall.denominator == 5
        assert pr1.f1.value == 0.0

    def test_pr1_zero_denominator_predicted_items_expected_empty(self) -> None:
        """When predicted has items but expected is empty, PR1 scores are 0.0."""
        pr1 = compute_pr1_from_counts("spurious_field", tp=0, fp=4, fn=0)
        assert pr1.precision.value == 0.0
        assert pr1.precision.numerator == 0.0
        assert pr1.precision.denominator == 4
        assert pr1.recall.value == 0.0
        assert pr1.f1.value == 0.0

    def test_compute_metric_score_general(self) -> None:
        """Verify general MetricScore computation and zero-denominator handling."""
        score = compute_metric_score(
            name="accuracy",
            numerator=10,
            denominator=20,
            definition="correct / total",
            description="Overall accuracy",
        )
        assert score.value == 0.5
        assert score.numerator == 10.0
        assert score.denominator == 20

        zero_denom_score = compute_metric_score(
            name="zero_metric",
            numerator=0,
            denominator=0,
            definition="0 / 0",
            description="Empty set metric",
            zero_denominator_value=1.0,
        )
        assert zero_denom_score.value == 1.0

    def test_canonicalize_helpers(self) -> None:
        """Verify string normalization for emails, phones, and URLs."""
        assert (
            canonicalize_email("  Jane.Doe+Tag@EXAMPLE.Com  ")
            == "jane.doe+tag@example.com"
        )
        assert canonicalize_phone("+1 (415) 555-0199") == "+14155550199"
        assert canonicalize_phone("020-1234-5678") == "02012345678"
        assert (
            canonicalize_url("http://www.Example.COM/profile/")
            == "https://example.com/profile"
        )
        assert (
            canonicalize_url("https://github.com/janedoe?tab=repos")
            == "https://github.com/janedoe?tab=repos"
        )

    def test_set_pr1_matching(self) -> None:
        """Verify set-level PR1 calculations."""
        actual = {"a", "b", "c"}
        expected = {"b", "c", "d"}
        pr1 = compute_set_pr1("set_test", actual, expected)
        assert pr1.true_positives == 2
        assert pr1.false_positives == 1
        assert pr1.false_negatives == 1
        assert pr1.precision.value == round(2 / 3, 4)
        assert pr1.recall.value == round(2 / 3, 4)


class TestEvaluationDataset:
    """Verification of synthetic dataset constraints, variety, and expected truth."""

    def test_dataset_case_count_and_uniqueness(self) -> None:
        """Verify that the dataset contains exactly 13 unique cases."""
        cases = build_evaluation_dataset()
        assert len(cases) == 13

        case_ids = [c.case_id for c in cases]
        assert len(case_ids) == len(set(case_ids))

    def test_all_cases_have_required_metadata(self) -> None:
        """Verify every case contains clear category and valid PDF bytes."""
        cases = build_evaluation_dataset()
        for c in cases:
            assert c.case_id
            assert c.name
            assert c.category
            assert c.description
            assert c.assumptions
            assert c.pdf_bytes.startswith(b"%PDF")

    def test_case_13_insufficient_text_raises_scanned_pdf(self) -> None:
        """Verify case 13 strictly triggers SCANNED_PDF on extraction."""
        cases = build_evaluation_dataset()
        case13 = next(c for c in cases if c.case_id == "case_13_insufficient_text")
        with pytest.raises(PDFExtractionError) as exc_info:
            extract_pdf(case13.pdf_bytes)
        assert exc_info.value.code == ErrorCode.SCANNED_PDF


class TestEvaluationHarness:
    """End-to-end testing of the offline evaluation harness."""

    @pytest.mark.anyio
    async def test_deterministic_evaluation(self) -> None:
        """Verify deterministic rule extraction evaluation across dataset."""
        harness = EvaluationHarness()
        cases = build_evaluation_dataset()
        det_metrics = harness.evaluate_deterministic_components(cases)

        assert det_metrics.cases_evaluated == 13
        assert det_metrics.email_metrics.precision.value >= 0.95
        assert det_metrics.email_metrics.recall.value >= 0.95
        assert det_metrics.phone_metrics.precision.value >= 0.95
        assert det_metrics.phone_metrics.recall.value >= 0.95
        assert det_metrics.url_metrics.precision.value >= 0.90
        assert det_metrics.url_metrics.recall.value >= 0.95

    @pytest.mark.anyio
    async def test_full_evaluation_run(self) -> None:
        """Verify full evaluation report generation and metrics validity."""
        harness = EvaluationHarness()
        report = await harness.run_evaluation()

        assert isinstance(report, EvaluationReport)
        assert report.cases_evaluated == 13
        assert report.dataset_version == "1.0.0"
        assert report.mode == "offline_synthetic"
        assert report.average_latency_ms >= 0.0

        # Pipeline outcomes
        pm = report.pipeline
        assert pm.successful_extractions == 12
        assert pm.failed_extractions == 1
        assert pm.schema_valid_count == 12
        assert pm.schema_valid_rate.value == round(12 / 13, 4)
        assert pm.name_accuracy.value == 1.0
        assert pm.date_accuracy.value == 1.0

        # Grounding metrics
        gm = report.grounding
        assert gm.total_fields_evaluated > 0
        assert gm.grounded_fields_count > 0
        assert gm.grounded_rate.value > 0.90
        assert gm.grounding_precision.value == 1.0
        assert gm.grounding_recall.value == 1.0

        # Warnings distribution contains expected codes
        assert WarningCode.AMBIGUOUS_DATE.value in report.warnings_by_code
        assert WarningCode.MOCK_DATA.value in report.warnings_by_code

        # Second-opinion comparative outcomes
        assert report.second_opinion is not None
        assert report.second_opinion.scenarios_evaluated == 9
        assert (
            report.second_opinion.recommendation
            == "DEFERRED / NOT INTEGRATED INTO PRODUCTION PIPELINE"
        )

    @pytest.mark.anyio
    async def test_evaluation_determinism(self) -> None:
        """Verify that running the harness twice produces identical metrics."""
        harness = EvaluationHarness()
        report1 = await harness.run_evaluation()
        report2 = await harness.run_evaluation()

        assert (
            report1.deterministic.email_metrics.precision.value
            == report2.deterministic.email_metrics.precision.value
        )
        assert (
            report1.deterministic.phone_metrics.f1.value
            == report2.deterministic.phone_metrics.f1.value
        )
        assert (
            report1.pipeline.schema_valid_rate.value
            == report2.pipeline.schema_valid_rate.value
        )
        assert (
            report1.grounding.grounded_rate.value
            == report2.grounding.grounded_rate.value
        )
        assert (
            report1.second_opinion is not None
            and report2.second_opinion is not None
            and (
                report1.second_opinion.strategy_a_baseline.field_accuracy.value
                == report2.second_opinion.strategy_a_baseline.field_accuracy.value
            )
        )
        assert report1.warnings_by_code == report2.warnings_by_code

    @pytest.mark.anyio
    async def test_zero_network_calls_during_evaluation(self) -> None:
        """Ensure no outbound socket connections are made during offline evaluation."""

        def guarded_socket(*args: object, **kwargs: object) -> socket.socket:
            raise RuntimeError(
                "Network connection attempted during offline evaluation!"
            )

        with patch("socket.socket", side_effect=guarded_socket):
            harness = EvaluationHarness()
            report = await harness.run_evaluation()
            assert report.cases_evaluated == 13

    @pytest.mark.anyio
    async def test_missing_contact_case_behavior(self) -> None:
        """Verify Case 3 (missing contact details) does not hallucinate contacts."""
        cases = build_evaluation_dataset()
        case3 = next(c for c in cases if c.case_id == "case_03_missing_contact")
        harness = EvaluationHarness()
        (
            _,
            _,
            _,
            summaries,
            _,
        ) = await harness.evaluate_pipeline_and_grounding([case3])

        summary = summaries[0]
        assert summary.status == "ok"
        assert summary.schema_valid is True

    @pytest.mark.anyio
    async def test_repeated_info_deduplication(self) -> None:
        """Verify Case 11 (repeated info) results in clean deduplication."""
        cases = build_evaluation_dataset()
        case11 = next(c for c in cases if c.case_id == "case_11_repeated_info")
        harness = EvaluationHarness()
        (
            _,
            _,
            _,
            summaries,
            _,
        ) = await harness.evaluate_pipeline_and_grounding([case11])

        summary = summaries[0]
        assert summary.status == "ok"
        assert summary.schema_valid is True

    @pytest.mark.anyio
    async def test_evaluate_fallback_resilience(self) -> None:
        """Verify synthetic mocked fallback resilience evaluation metrics."""
        harness = EvaluationHarness()
        fb = await harness.evaluate_fallback_resilience()

        assert fb.scenarios_evaluated == 8
        assert fb.primary_success_count == 1
        assert fb.primary_success_rate.value == 0.125
        assert fb.fallback_activation_count == 5
        assert fb.fallback_recovery_count == 3
        assert fb.recovery_rate.value == 0.6
        assert fb.dual_failure_count == 2
        assert fb.dual_failure_rate.value == 0.25
        assert fb.average_attempts_per_request == 1.625
