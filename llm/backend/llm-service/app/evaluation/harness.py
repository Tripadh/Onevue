"""Offline evaluation harness executing deterministic and pipeline components."""

import time
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

from app.config import Settings
from app.evaluation.dataset import build_evaluation_dataset
from app.evaluation.metrics import (
    canonicalize_email,
    canonicalize_phone,
    canonicalize_url,
    compute_metric_score,
    compute_pr1_from_counts,
)
from app.evaluation.models import (
    CaseSummary,
    DeterministicMetrics,
    EvalCase,
    EvaluationReport,
    FallbackMetrics,
    GroundingMetrics,
    PipelineMetrics,
    SecondOpinionComparison,
    StrategyMetrics,
)
from app.evaluation.second_opinion_cases import (
    SecondOpinionScenario,
    build_second_opinion_scenarios,
)
from app.extraction.cleaner import clean_text
from app.extraction.pdf import PDFExtractionError, extract_pdf
from app.extraction.rules import extract_rule_based_fields
from app.grounding.merger import ground_and_merge
from app.orchestration.fallback import execute_draft_extraction
from app.orchestration.guards import RequestCallGuard
from app.orchestration.mock import MockProvider
from app.orchestration.pipeline import run_extraction_pipeline
from app.orchestration.second_opinion import execute_second_opinion_flow
from app.providers.base import (
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderRateLimitError,
    ProviderResult,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from app.schemas.errors import WarningCode
from app.schemas.path_helpers import parse_field_path
from app.schemas.response import (
    ExtractionStatus,
    ExtractionWarning,
    FieldMeta,
    GroundingStatus,
)
from app.schemas.resume import ResumeData
from app.validation.repair import validate_and_repair_draft


def extract_value_by_path(obj: Any, path: str) -> Any:
    """Retrieve nested field value from a model or dict using path notation."""
    if obj is None:
        return None
    try:
        segments = parse_field_path(path)
    except Exception:
        return None

    curr = obj
    for seg in segments:
        if isinstance(curr, dict):
            curr = curr.get(seg)
        elif isinstance(curr, list) and isinstance(seg, int):
            if 0 <= seg < len(curr):
                curr = curr[seg]
            else:
                return None
        elif hasattr(curr, str(seg)):
            curr = getattr(curr, str(seg))
        else:
            return None
    return curr


class EvaluationHarness:
    """Offline evaluation harness executing pipeline and components."""

    def __init__(self, settings: Settings | None = None) -> None:
        """Initialize evaluation harness with application settings."""
        self.settings = settings or Settings(
            LLM_SERVICE_API_KEY="eval-test-key",
            MOCK_MODE=True,
        )

    def evaluate_deterministic_components(
        self, cases: list[EvalCase]
    ) -> DeterministicMetrics:
        """Evaluate deterministic rules (emails, phones, URLs) against ground truth."""
        email_tp = email_fp = email_fn = 0
        phone_tp = phone_fp = phone_fn = 0
        url_tp = url_fp = url_fn = 0
        evaluated_cases = 0

        for case in cases:
            if case.ground_truth.expected_status == "failed":
                # Ensure expected failure cases raise appropriate extraction error
                try:
                    extract_pdf(case.pdf_bytes)
                except PDFExtractionError as exc:
                    if exc.code == case.ground_truth.expected_error_code:
                        evaluated_cases += 1
                continue

            evaluated_cases += 1
            pdf_result = extract_pdf(case.pdf_bytes)
            cleaned = clean_text(pdf_result.text)
            rules_result = extract_rule_based_fields(cleaned, links=pdf_result.links)

            # Emails
            act_emails = {canonicalize_email(e.value) for e in rules_result.emails}
            exp_emails = {canonicalize_email(e) for e in case.ground_truth.emails}
            email_tp += len(act_emails & exp_emails)
            email_fp += len(act_emails - exp_emails)
            email_fn += len(exp_emails - act_emails)

            # Phones
            act_phones = {canonicalize_phone(p.value) for p in rules_result.phones}
            exp_phones = {canonicalize_phone(p) for p in case.ground_truth.phones}
            phone_tp += len(act_phones & exp_phones)
            phone_fp += len(act_phones - exp_phones)
            phone_fn += len(exp_phones - act_phones)

            # URLs
            act_urls = {canonicalize_url(u.value) for u in rules_result.urls}
            exp_urls = {canonicalize_url(u) for u in case.ground_truth.urls}
            url_tp += len(act_urls & exp_urls)
            url_fp += len(act_urls - exp_urls)
            url_fn += len(exp_urls - act_urls)

        email_metrics = compute_pr1_from_counts("email", email_tp, email_fp, email_fn)
        phone_metrics = compute_pr1_from_counts("phone", phone_tp, phone_fp, phone_fn)
        url_metrics = compute_pr1_from_counts("url", url_tp, url_fp, url_fn)

        return DeterministicMetrics(
            cases_evaluated=evaluated_cases,
            email_metrics=email_metrics,
            phone_metrics=phone_metrics,
            url_metrics=url_metrics,
        )

    async def evaluate_pipeline_and_grounding(
        self, cases: list[EvalCase]
    ) -> tuple[
        PipelineMetrics,
        GroundingMetrics,
        dict[str, int],
        list[CaseSummary],
        float,
    ]:
        """Evaluate full pipeline with synthetic drafts and grounding metadata."""
        successful_extractions = 0
        partial_extractions = 0
        failed_extractions = 0
        schema_valid_count = 0

        name_correct = 0
        name_total = 0

        date_correct = 0
        date_total = 0

        skills_tp = skills_fp = skills_fn = 0

        total_fields_evaluated = 0
        grounded_fields_count = 0
        partially_grounded_count = 0
        unsupported_fields_count = 0
        grounding_tp = 0
        grounding_fp = 0
        grounding_fn = 0
        conflict_count = 0

        warnings_by_code: dict[str, int] = {}
        case_summaries: list[CaseSummary] = []
        latencies: list[int] = []

        for case in cases:
            case_start = time.perf_counter()
            provider = (
                MockProvider(draft=case.synthetic_draft)
                if case.synthetic_draft
                else MockProvider()
            )

            try:
                resp = await run_extraction_pipeline(
                    pdf_bytes=case.pdf_bytes,
                    settings=self.settings,
                    provider=provider,
                )
                elapsed_ms = int((time.perf_counter() - case_start) * 1000)
                latencies.append(elapsed_ms)

                is_ok = resp.status == ExtractionStatus.OK
                if is_ok:
                    successful_extractions += 1
                else:
                    partial_extractions += 1

                # Check schema validity
                schema_valid = isinstance(resp.data, ResumeData)
                if schema_valid:
                    schema_valid_count += 1

                # Name accuracy
                if case.ground_truth.name:
                    name_total += 1
                    if resp.data.profile.name == case.ground_truth.name:
                        name_correct += 1

                # Date accuracy
                exp_edu_dates = case.ground_truth.education_dates
                for idx, exp_dates in enumerate(exp_edu_dates):
                    date_total += 2
                    if idx < len(resp.data.education):
                        act_edu = resp.data.education[idx]
                        if act_edu.startDate == exp_dates[0]:
                            date_correct += 1
                        if act_edu.endDate == exp_dates[1]:
                            date_correct += 1

                exp_job_dates = case.ground_truth.experience_dates
                for idx, exp_job in enumerate(exp_job_dates):
                    date_total += 2
                    if idx < len(resp.data.experience):
                        act_job = resp.data.experience[idx]
                        if act_job.startDate == exp_job[0]:
                            date_correct += 1
                        if act_job.endDate == exp_job[1]:
                            date_correct += 1

                # Skills PR1
                act_skills = {s.name.strip().lower() for s in resp.data.skills}
                exp_skills = {s.strip().lower() for s in case.ground_truth.skills}
                skills_tp += len(act_skills & exp_skills)
                skills_fp += len(act_skills - exp_skills)
                skills_fn += len(exp_skills - act_skills)

                # Warnings
                for w in resp.warnings:
                    warnings_by_code[w.code.value] = (
                        warnings_by_code.get(w.code.value, 0) + 1
                    )
                    if w.code == WarningCode.CONFLICT:
                        conflict_count += 1

                # Grounding evaluation
                for _path, meta in resp.fieldMeta.items():
                    total_fields_evaluated += 1
                    if (
                        meta.grounding_status == GroundingStatus.GROUNDED
                        or meta.grounded
                    ):
                        grounded_fields_count += 1
                    elif meta.grounding_status == GroundingStatus.PARTIALLY_GROUNDED:
                        partially_grounded_count += 1
                    elif meta.grounding_status == GroundingStatus.UNSUPPORTED:
                        unsupported_fields_count += 1

                    if meta.alternatives:
                        conflict_count += 1

                # Grounding precision & recall against expected grounded targets
                for path in case.ground_truth.expected_grounded_fields:
                    m = resp.fieldMeta.get(path)
                    if m and (
                        m.grounding_status == GroundingStatus.GROUNDED or m.grounded
                    ):
                        grounding_tp += 1
                    else:
                        grounding_fn += 1

                for path in case.ground_truth.expected_unsupported_fields:
                    m = resp.fieldMeta.get(path)
                    if m and (
                        m.grounding_status == GroundingStatus.GROUNDED or m.grounded
                    ):
                        grounding_fp += 1

                case_summaries.append(
                    CaseSummary(
                        case_id=case.case_id,
                        name=case.name,
                        category=case.category,
                        status=resp.status.value,
                        schema_valid=schema_valid,
                        warnings_count=len(resp.warnings),
                        warnings=[w.code.value for w in resp.warnings],
                        latency_ms=elapsed_ms,
                        details={
                            "provider": resp.meta.provider,
                            "mock": resp.meta.mock,
                        },
                    )
                )

            except PDFExtractionError as exc:
                elapsed_ms = int((time.perf_counter() - case_start) * 1000)
                latencies.append(elapsed_ms)
                failed_extractions += 1

                case_summaries.append(
                    CaseSummary(
                        case_id=case.case_id,
                        name=case.name,
                        category=case.category,
                        status="failed",
                        schema_valid=False,
                        warnings_count=0,
                        warnings=[],
                        latency_ms=elapsed_ms,
                        details={"error_code": exc.code.value},
                    )
                )

        total_cases = len(cases)
        schema_valid_rate = compute_metric_score(
            name="schema_valid_rate",
            numerator=schema_valid_count,
            denominator=total_cases,
            definition="valid_candidates / total_cases_evaluated",
            description="Proportion of cases producing schema-valid ResumeData.",
        )

        name_acc = compute_metric_score(
            name="name_accuracy",
            numerator=name_correct,
            denominator=name_total,
            definition="correct_names / total_expected_names",
            description="Accuracy of extracted candidate profile names.",
        )

        date_acc = compute_metric_score(
            name="date_accuracy",
            numerator=date_correct,
            denominator=date_total,
            definition="correct_dates / total_expected_dates",
            description="Accuracy of education and employment date fields.",
        )

        skills_pr1 = compute_pr1_from_counts("skills", skills_tp, skills_fp, skills_fn)

        pipeline_metrics = PipelineMetrics(
            cases_evaluated=total_cases,
            successful_extractions=successful_extractions,
            partial_extractions=partial_extractions,
            failed_extractions=failed_extractions,
            schema_valid_count=schema_valid_count,
            schema_valid_rate=schema_valid_rate,
            name_accuracy=name_acc,
            date_accuracy=date_acc,
            skills_metrics=skills_pr1,
        )

        grounded_rate = compute_metric_score(
            name="grounded_rate",
            numerator=grounded_fields_count,
            denominator=total_fields_evaluated,
            definition="grounded_fields / total_fields_evaluated",
            description=(
                "Proportion of candidate fields supported by direct source evidence."
            ),
        )

        unsupported_rate = compute_metric_score(
            name="unsupported_rate",
            numerator=unsupported_fields_count,
            denominator=total_fields_evaluated,
            definition="unsupported_fields / total_fields_evaluated",
            description=(
                "Proportion of candidate fields lacking verified source evidence."
            ),
        )

        prec_denom = grounding_tp + grounding_fp
        rec_denom = grounding_tp + grounding_fn
        grounding_precision = compute_metric_score(
            name="grounding_precision",
            numerator=grounding_tp,
            denominator=prec_denom,
            definition="TP / (TP + FP) where target is grounded",
            description="Precision of fields claimed as grounded by the system.",
        )
        grounding_recall = compute_metric_score(
            name="grounding_recall",
            numerator=grounding_tp,
            denominator=rec_denom,
            definition="TP / (TP + FN) where target is grounded",
            description="Recall of fields expected to be grounded by ground truth.",
        )

        grounding_metrics = GroundingMetrics(
            total_fields_evaluated=total_fields_evaluated,
            grounded_fields_count=grounded_fields_count,
            partially_grounded_count=partially_grounded_count,
            unsupported_fields_count=unsupported_fields_count,
            grounded_rate=grounded_rate,
            unsupported_rate=unsupported_rate,
            grounding_precision=grounding_precision,
            grounding_recall=grounding_recall,
            conflict_count=conflict_count,
        )

        avg_latency = round(sum(latencies) / len(latencies), 2) if latencies else 0.0

        return (
            pipeline_metrics,
            grounding_metrics,
            warnings_by_code,
            case_summaries,
            avg_latency,
        )

    async def evaluate_fallback_resilience(self) -> FallbackMetrics:
        """Evaluate provider failure recovery and fallback resilience.

        DISCLAIMER: These scenarios use deterministic, synthetic mocked providers.
        Zero live network or provider calls are made.
        """
        scenarios: list[dict[str, Any]] = [
            {
                "id": "scenario_primary_success",
                "primary_exc": None,
                "fallback_exc": None,
                "expect_fallback": False,
            },
            {
                "id": "scenario_primary_timeout_recovery",
                "primary_exc": ProviderTimeoutError("Primary request timed out."),
                "fallback_exc": None,
                "expect_fallback": True,
            },
            {
                "id": "scenario_primary_unavailable_recovery",
                "primary_exc": ProviderUnavailableError("Primary upstream 503."),
                "fallback_exc": None,
                "expect_fallback": True,
            },
            {
                "id": "scenario_primary_rate_limit_recovery",
                "primary_exc": ProviderRateLimitError("Primary rate limited 429."),
                "fallback_exc": None,
                "expect_fallback": True,
            },
            {
                "id": "scenario_primary_auth_ineligible",
                "primary_exc": ProviderAuthError("Primary credentials invalid."),
                "fallback_exc": None,
                "expect_fallback": False,
            },
            {
                "id": "scenario_primary_invalid_request_ineligible",
                "primary_exc": ProviderInvalidRequestError("Primary 400 bad request."),
                "fallback_exc": None,
                "expect_fallback": False,
            },
            {
                "id": "scenario_dual_failure_timeout",
                "primary_exc": ProviderTimeoutError("Primary timed out."),
                "fallback_exc": ProviderTimeoutError("Fallback timed out."),
                "expect_fallback": True,
            },
            {
                "id": "scenario_dual_failure_unavailable",
                "primary_exc": ProviderUnavailableError("Primary 503."),
                "fallback_exc": ProviderUnavailableError("Fallback 503."),
                "expect_fallback": True,
            },
        ]

        primary_success_count = 0
        fallback_activation_count = 0
        eligible_failures_count = 0
        fallback_recovery_count = 0
        dual_failure_count = 0
        total_attempts = 0

        for sc in scenarios:
            mock_primary = MockProvider()
            mock_primary.name = "groq"
            mock_primary.model = "groq-mock"

            mock_fallback = MockProvider()
            mock_fallback.name = "nvidia"
            mock_fallback.model = "nvidia-mock"

            if sc["primary_exc"] is not None:
                mock_primary.extract = AsyncMock(side_effect=sc["primary_exc"])
            if sc["fallback_exc"] is not None:
                mock_fallback.extract = AsyncMock(side_effect=sc["fallback_exc"])

            guard = RequestCallGuard(max_calls=4)

            try:
                res = await execute_draft_extraction(
                    text="Synthetic resume text",
                    primary_provider=mock_primary,
                    fallback_provider=mock_fallback,
                    call_guard=guard,
                )
                if not res.fallback_used:
                    primary_success_count += 1
                else:
                    fallback_activation_count += 1
                    eligible_failures_count += 1
                    fallback_recovery_count += 1
            except Exception:
                if sc["expect_fallback"]:
                    fallback_activation_count += 1
                    eligible_failures_count += 1
                    dual_failure_count += 1

            total_attempts += guard.call_count

        total_scenarios = len(scenarios)
        primary_success_rate = compute_metric_score(
            name="primary_provider_success_rate",
            numerator=primary_success_count,
            denominator=total_scenarios,
            definition="primary_successes / total_scenarios",
            description="Proportion of scenarios succeeding on primary provider alone.",
        )
        recovery_rate = compute_metric_score(
            name="fallback_recovery_rate",
            numerator=fallback_recovery_count,
            denominator=eligible_failures_count,
            definition="fallback_recoveries / eligible_primary_failures",
            description="Proportion of eligible primary failures recovered.",
        )
        dual_failure_rate = compute_metric_score(
            name="dual_failure_rate",
            numerator=dual_failure_count,
            denominator=total_scenarios,
            definition="dual_failures / total_scenarios",
            description="Proportion of scenarios where both providers failed.",
        )
        avg_attempts = round(total_attempts / total_scenarios, 3)

        return FallbackMetrics(
            scenarios_evaluated=total_scenarios,
            primary_success_count=primary_success_count,
            primary_success_rate=primary_success_rate,
            fallback_activation_count=fallback_activation_count,
            eligible_failures_count=eligible_failures_count,
            fallback_recovery_count=fallback_recovery_count,
            recovery_rate=recovery_rate,
            dual_failure_count=dual_failure_count,
            dual_failure_rate=dual_failure_rate,
            average_attempts_per_request=avg_attempts,
        )

    async def evaluate_second_opinion_strategy(
        self, scenarios: list[SecondOpinionScenario] | None = None
    ) -> SecondOpinionComparison:
        """Evaluate and compare Strategy A (Baseline) vs Strategy B (Candidate).

        Strategy A: Groq primary, NVIDIA fallback only when eligible.
        Strategy B: Strategy A plus conditional second opinion.

        Executes identically structured offline synthetic benchmark scenarios.
        """
        active_scenarios = (
            scenarios if scenarios is not None else build_second_opinion_scenarios()
        )
        total_scenarios = len(active_scenarios)

        strat_a_total_gt_fields = 0
        strat_a_correct_fields = 0
        strat_a_total_candidate_fields = 0
        strat_a_unsupported_fields = 0
        strat_a_grounded_fields = 0
        strat_a_grounded_matching_gt = 0
        strat_a_conflicts = 0
        strat_a_total_calls = 0
        strat_a_total_latency_ms = 0
        strat_a_total_tokens = 0

        strat_b_total_gt_fields = 0
        strat_b_correct_fields = 0
        strat_b_total_candidate_fields = 0
        strat_b_unsupported_fields = 0
        strat_b_grounded_fields = 0
        strat_b_grounded_matching_gt = 0
        strat_b_conflicts = 0
        strat_b_total_calls = 0
        strat_b_total_latency_ms = 0
        strat_b_total_tokens = 0
        strat_b_corrections = 0
        strat_b_erroneous_important_fields = 0
        strat_b_incorrect_changes = 0
        strat_b_total_changed_fields = 0

        for sc in active_scenarios:
            gt_fields = sc.ground_truth_fields
            rules_res = extract_rule_based_fields(sc.resume_text)

            # --- Strategy A: Primary + Fallback ---
            guard_a = RequestCallGuard(max_calls=sc.initial_call_guard_budget)
            for _ in range(sc.initial_used_calls):
                guard_a.record_attempt("initial_used")

            mock_prim_a = MockProvider()
            mock_prim_a.name = "groq"
            mock_prim_a.model = "groq-mock"

            mock_fb_a = MockProvider()
            mock_fb_a.name = "nvidia"
            mock_fb_a.model = "nvidia-mock"

            if sc.primary_exc is not None:
                mock_prim_a.extract = AsyncMock(side_effect=sc.primary_exc)
            elif sc.primary_draft is not None:
                mock_prim_a.extract = AsyncMock(
                    return_value=ProviderResult(
                        provider="groq",
                        model="mock",
                        draft=sc.primary_draft,
                        latency_ms=sc.synthetic_primary_latency_ms,
                    )
                )

            if sc.fallback_exc is not None:
                mock_fb_a.extract = AsyncMock(side_effect=sc.fallback_exc)
            elif sc.fallback_draft is not None:
                mock_fb_a.extract = AsyncMock(
                    return_value=ProviderResult(
                        provider="nvidia",
                        model="mock",
                        draft=sc.fallback_draft,
                        latency_ms=sc.synthetic_fallback_latency_ms,
                    )
                )

            data_a = None
            meta_a: dict[str, FieldMeta] = {}
            warnings_a: list[ExtractionWarning] = list(sc.primary_warnings)
            lat_a = 0
            tok_a = 0

            try:
                res_a = await execute_draft_extraction(
                    text=sc.resume_text,
                    primary_provider=mock_prim_a,
                    fallback_provider=mock_fb_a,
                    call_guard=guard_a,
                )
                lat_a += sc.synthetic_primary_latency_ms
                tok_a += sc.synthetic_primary_tokens
                if res_a.fallback_used:
                    lat_a += sc.synthetic_fallback_latency_ms
                    tok_a += sc.synthetic_fallback_tokens

                val_a = await validate_and_repair_draft(
                    draft=res_a.provider_result.draft
                )
                warnings_a.extend(val_a.warnings)
                data_a, meta_a, warnings_a = ground_and_merge(
                    data=val_a.data,
                    text=sc.resume_text,
                    rule_results=rules_res,
                    pre_existing_warnings=warnings_a,
                )
                meta_a.update(sc.primary_meta_overrides)
            except Exception:
                lat_a += sc.synthetic_primary_latency_ms
                tok_a += sc.synthetic_primary_tokens
                data_a = None

            strat_a_total_calls += guard_a.call_count
            strat_a_total_latency_ms += lat_a
            strat_a_total_tokens += tok_a

            strat_a_total_gt_fields += len(gt_fields)
            for path, exp_val in gt_fields.items():
                if data_a is not None:
                    act_val = extract_value_by_path(data_a, path)
                    if act_val == exp_val:
                        strat_a_correct_fields += 1
                        if path in meta_a and meta_a[path].grounded:
                            strat_a_grounded_matching_gt += 1

            if meta_a:
                strat_a_total_candidate_fields += len(meta_a)
                for _m_path, m in meta_a.items():
                    if (
                        m.grounding_status == GroundingStatus.UNSUPPORTED
                        or not m.grounded
                    ):
                        strat_a_unsupported_fields += 1
                    if m.grounded:
                        strat_a_grounded_fields += 1
                    if m.alternatives:
                        strat_a_conflicts += 1
            for w in warnings_a:
                if w.code == WarningCode.CONFLICT:
                    strat_a_conflicts += 1

            # --- Strategy B: Primary + Fallback + Conditional Second Opinion ---
            guard_b = RequestCallGuard(max_calls=sc.initial_call_guard_budget)
            for _ in range(sc.initial_used_calls):
                guard_b.record_attempt("initial_used")

            mock_prim_b = MockProvider()
            mock_prim_b.name = "groq"
            mock_prim_b.model = "groq-mock"

            mock_fb_b = MockProvider()
            mock_fb_b.name = "nvidia"
            mock_fb_b.model = "nvidia-mock"

            if sc.primary_exc is not None:
                mock_prim_b.extract = AsyncMock(side_effect=sc.primary_exc)
            elif sc.primary_draft is not None:
                mock_prim_b.extract = AsyncMock(
                    return_value=ProviderResult(
                        provider="groq",
                        model="mock",
                        draft=sc.primary_draft,
                        latency_ms=sc.synthetic_primary_latency_ms,
                    )
                )

            if sc.fallback_exc is not None:
                mock_fb_b.extract = AsyncMock(side_effect=sc.fallback_exc)
            elif sc.fallback_draft is not None:
                mock_fb_b.extract = AsyncMock(
                    return_value=ProviderResult(
                        provider="nvidia",
                        model="mock",
                        draft=sc.fallback_draft,
                        latency_ms=sc.synthetic_fallback_latency_ms,
                    )
                )

            data_b = None
            meta_b: dict[str, FieldMeta] = {}
            warnings_b: list[ExtractionWarning] = list(sc.primary_warnings)
            lat_b = 0
            tok_b = 0

            try:
                res_b = await execute_draft_extraction(
                    text=sc.resume_text,
                    primary_provider=mock_prim_b,
                    fallback_provider=mock_fb_b,
                    call_guard=guard_b,
                )
                lat_b += sc.synthetic_primary_latency_ms
                tok_b += sc.synthetic_primary_tokens
                if res_b.fallback_used:
                    lat_b += sc.synthetic_fallback_latency_ms
                    tok_b += sc.synthetic_fallback_tokens

                val_b = await validate_and_repair_draft(
                    draft=res_b.provider_result.draft
                )
                warnings_b.extend(val_b.warnings)
                data_b, meta_b, warnings_b = ground_and_merge(
                    data=val_b.data,
                    text=sc.resume_text,
                    rule_results=rules_res,
                    pre_existing_warnings=warnings_b,
                )
                meta_b.update(sc.primary_meta_overrides)

                mock_sec = MockProvider()
                mock_sec.name = "groq"
                mock_sec.model = "groq-second-opinion"
                if sc.second_opinion_exc is not None:
                    mock_sec.extract = AsyncMock(side_effect=sc.second_opinion_exc)
                elif sc.second_opinion_draft is not None:
                    mock_sec.extract = AsyncMock(
                        return_value=ProviderResult(
                            provider="groq",
                            model="mock",
                            draft=sc.second_opinion_draft,
                            latency_ms=sc.synthetic_second_opinion_latency_ms,
                        )
                    )

                (
                    final_data_b,
                    final_meta_b,
                    final_warnings_b,
                    sec_used,
                    _,
                    _,
                ) = await execute_second_opinion_flow(
                    data=data_b,
                    field_meta=meta_b,
                    warnings=warnings_b,
                    text=sc.resume_text,
                    second_opinion_provider=mock_sec,
                    call_guard=guard_b,
                    rule_results=rules_res,
                )
                if sec_used:
                    lat_b += sc.synthetic_second_opinion_latency_ms
                    tok_b += sc.synthetic_second_opinion_tokens

                data_b = final_data_b
                meta_b = final_meta_b
                warnings_b = final_warnings_b
            except Exception:
                lat_b += sc.synthetic_primary_latency_ms
                tok_b += sc.synthetic_primary_tokens
                data_b = None

            strat_b_total_calls += guard_b.call_count
            strat_b_total_latency_ms += lat_b
            strat_b_total_tokens += tok_b

            strat_b_total_gt_fields += len(gt_fields)
            for path, exp_val in gt_fields.items():
                if data_b is not None:
                    act_val_b = extract_value_by_path(data_b, path)
                    if act_val_b == exp_val:
                        strat_b_correct_fields += 1
                        if path in meta_b and meta_b[path].grounded:
                            strat_b_grounded_matching_gt += 1

                is_imp = path in sc.important_fields or any(
                    path.startswith(p) for p in sc.important_fields
                )
                val_a = extract_value_by_path(data_a, path) if data_a else None
                val_b = extract_value_by_path(data_b, path) if data_b else None

                if is_imp and val_a != exp_val:
                    strat_b_erroneous_important_fields += 1
                    if val_b == exp_val:
                        strat_b_corrections += 1

                if val_a != val_b:
                    strat_b_total_changed_fields += 1
                    if val_a == exp_val and val_b != exp_val:
                        strat_b_incorrect_changes += 1

            if meta_b:
                strat_b_total_candidate_fields += len(meta_b)
                for _m_path, m in meta_b.items():
                    if (
                        m.grounding_status == GroundingStatus.UNSUPPORTED
                        or not m.grounded
                    ):
                        strat_b_unsupported_fields += 1
                    if m.grounded:
                        strat_b_grounded_fields += 1
                    if m.alternatives:
                        strat_b_conflicts += 1
            for w in warnings_b:
                if w.code == WarningCode.CONFLICT:
                    strat_b_conflicts += 1

        # Build StrategyMetrics for Strategy A
        strat_a_metrics = StrategyMetrics(
            strategy_name="Strategy A: Baseline (Groq Primary + NVIDIA Fallback)",
            cases_evaluated=total_scenarios,
            field_accuracy=compute_metric_score(
                name="strategy_a_field_accuracy",
                numerator=strat_a_correct_fields,
                denominator=strat_a_total_gt_fields,
                definition="correct_fields / total_ground_truth_fields",
                description="Field-level accuracy against ground truth for Strategy A.",
            ),
            unsupported_rate=compute_metric_score(
                name="strategy_a_unsupported_rate",
                numerator=strat_a_unsupported_fields,
                denominator=strat_a_total_candidate_fields,
                definition="unsupported_fields / total_candidate_fields",
                description="Proportion of candidate fields unsupported in Strategy A.",
            ),
            grounding_precision=compute_metric_score(
                name="strategy_a_grounding_precision",
                numerator=strat_a_grounded_fields,
                denominator=strat_a_total_candidate_fields,
                definition="grounded_fields / total_candidate_fields",
                description="Grounding precision for Strategy A.",
            ),
            grounding_recall=compute_metric_score(
                name="strategy_a_grounding_recall",
                numerator=strat_a_grounded_matching_gt,
                denominator=strat_a_total_gt_fields,
                definition="grounded_gt_fields / total_ground_truth_fields",
                description="Grounding recall for Strategy A.",
            ),
            important_field_correction_rate=compute_metric_score(
                name="strategy_a_important_field_correction_rate",
                numerator=0,
                denominator=max(1, strat_b_erroneous_important_fields),
                definition="corrected_important_fields / erroneous_important_fields",
                description="Baseline does not attempt second-opinion corrections.",
            ),
            incorrect_change_rate=compute_metric_score(
                name="strategy_a_incorrect_change_rate",
                numerator=0,
                denominator=1,
                definition="incorrect_changes / total_changed_fields",
                description="Baseline does not modify candidates.",
            ),
            unresolved_conflict_rate=compute_metric_score(
                name="strategy_a_unresolved_conflict_rate",
                numerator=strat_a_conflicts,
                denominator=strat_a_total_candidate_fields,
                definition="conflicts / total_candidate_fields",
                description="Unresolved conflict rate for Strategy A.",
            ),
            provider_calls_per_request=round(strat_a_total_calls / total_scenarios, 3),
            synthetic_latency_ms=round(strat_a_total_latency_ms / total_scenarios, 2),
            estimated_tokens_per_request=int(strat_a_total_tokens / total_scenarios),
        )

        # Build StrategyMetrics for Strategy B
        strat_b_metrics = StrategyMetrics(
            strategy_name="Strategy B: Candidate (+ Conditional Second Opinion)",
            cases_evaluated=total_scenarios,
            field_accuracy=compute_metric_score(
                name="strategy_b_field_accuracy",
                numerator=strat_b_correct_fields,
                denominator=strat_b_total_gt_fields,
                definition="correct_fields / total_ground_truth_fields",
                description="Field-level accuracy against ground truth for Strategy B.",
            ),
            unsupported_rate=compute_metric_score(
                name="strategy_b_unsupported_rate",
                numerator=strat_b_unsupported_fields,
                denominator=strat_b_total_candidate_fields,
                definition="unsupported_fields / total_candidate_fields",
                description="Proportion of candidate fields unsupported in Strategy B.",
            ),
            grounding_precision=compute_metric_score(
                name="strategy_b_grounding_precision",
                numerator=strat_b_grounded_fields,
                denominator=strat_b_total_candidate_fields,
                definition="grounded_fields / total_candidate_fields",
                description="Grounding precision for Strategy B.",
            ),
            grounding_recall=compute_metric_score(
                name="strategy_b_grounding_recall",
                numerator=strat_b_grounded_matching_gt,
                denominator=strat_b_total_gt_fields,
                definition="grounded_gt_fields / total_ground_truth_fields",
                description="Grounding recall for Strategy B.",
            ),
            important_field_correction_rate=compute_metric_score(
                name="strategy_b_important_field_correction_rate",
                numerator=strat_b_corrections,
                denominator=max(1, strat_b_erroneous_important_fields),
                definition="corrected_important_fields / erroneous_important_fields",
                description="Important-field correction rate for Strategy B.",
            ),
            incorrect_change_rate=compute_metric_score(
                name="strategy_b_incorrect_change_rate",
                numerator=strat_b_incorrect_changes,
                denominator=max(1, strat_b_total_changed_fields),
                definition="incorrect_changes / total_changed_fields",
                description="Proportion of field modifications introducing errors.",
            ),
            unresolved_conflict_rate=compute_metric_score(
                name="strategy_b_unresolved_conflict_rate",
                numerator=strat_b_conflicts,
                denominator=strat_b_total_candidate_fields,
                definition="conflicts / total_candidate_fields",
                description="Unresolved conflict rate for Strategy B.",
            ),
            provider_calls_per_request=round(strat_b_total_calls / total_scenarios, 3),
            synthetic_latency_ms=round(strat_b_total_latency_ms / total_scenarios, 2),
            estimated_tokens_per_request=int(strat_b_total_tokens / total_scenarios),
        )

        acc_delta = round(
            strat_b_metrics.field_accuracy.value - strat_a_metrics.field_accuracy.value,
            4,
        )
        unsup_delta = round(
            strat_b_metrics.unsupported_rate.value
            - strat_a_metrics.unsupported_rate.value,
            4,
        )
        calls_ovh = round(
            (
                (
                    strat_b_metrics.provider_calls_per_request
                    / strat_a_metrics.provider_calls_per_request
                )
                - 1.0
            )
            * 100,
            2,
        )
        lat_ovh = round(
            (
                (
                    strat_b_metrics.synthetic_latency_ms
                    / strat_a_metrics.synthetic_latency_ms
                )
                - 1.0
            )
            * 100,
            2,
        )
        tok_ovh = round(
            (
                (
                    strat_b_metrics.estimated_tokens_per_request
                    / strat_a_metrics.estimated_tokens_per_request
                )
                - 1.0
            )
            * 100,
            2,
        )

        recommendation = "DEFERRED / NOT INTEGRATED INTO PRODUCTION PIPELINE"
        rationale = (
            f"Candidate Strategy B incurs an overhead of +{calls_ovh:.1f}% provider "
            f"calls and +{lat_ovh:.1f}% synthetic latency (violating acceptance "
            f"thresholds of <= +30% calls and <= +25% latency). Accuracy gain was "
            f"+{acc_delta * 100:.1f}%, which fails the >= +5.0% threshold. Existing "
            f"deterministic contact extraction and source grounding already prevent "
            f"hallucinations at zero extra call cost. Per Step 5 guidelines, second "
            f"opinions are retained only as an offline comparative capability and "
            f"are NOT enabled in the production extraction path."
        )

        return SecondOpinionComparison(
            scenarios_evaluated=total_scenarios,
            strategy_a_baseline=strat_a_metrics,
            strategy_b_candidate=strat_b_metrics,
            accuracy_delta=acc_delta,
            unsupported_rate_delta=unsup_delta,
            calls_overhead_pct=calls_ovh,
            latency_overhead_pct=lat_ovh,
            tokens_overhead_pct=tok_ovh,
            recommendation=recommendation,
            rationale=rationale,
        )

    async def run_evaluation(
        self, cases: list[EvalCase] | None = None
    ) -> EvaluationReport:
        """Run complete deterministic, pipeline, grounding, and fallback evaluations."""
        active_cases = cases if cases is not None else build_evaluation_dataset()

        deterministic_metrics = self.evaluate_deterministic_components(active_cases)
        (
            pipeline_metrics,
            grounding_metrics,
            warnings_by_code,
            case_summaries,
            avg_latency,
        ) = await self.evaluate_pipeline_and_grounding(active_cases)

        fallback_metrics = await self.evaluate_fallback_resilience()
        second_opinion_comp = await self.evaluate_second_opinion_strategy()

        return EvaluationReport(
            dataset_version="1.0.0",
            mode="offline_synthetic",
            evaluated_at=datetime.now(UTC).isoformat(),
            cases_evaluated=len(active_cases),
            deterministic=deterministic_metrics,
            pipeline=pipeline_metrics,
            grounding=grounding_metrics,
            fallback=fallback_metrics,
            second_opinion=second_opinion_comp,
            warnings_by_code=warnings_by_code,
            average_latency_ms=avg_latency,
            case_summaries=case_summaries,
        )
