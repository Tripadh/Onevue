"""Evaluation data models and structured reporting schemas for ONEVUE."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.errors import ErrorCode, WarningCode
from app.schemas.llm_draft import ResumeDraft


class MetricScore(BaseModel):
    """Explicitly documented metric score with transparent numerator and denominator."""

    model_config = ConfigDict(extra="forbid")

    name: str
    value: float
    numerator: float
    denominator: int
    definition: str
    description: str


class FieldPR1(BaseModel):
    """Field-level Precision, Recall, and F1 with complete counts."""

    model_config = ConfigDict(extra="forbid")

    field_name: str
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: MetricScore
    recall: MetricScore
    f1: MetricScore


class GroundTruth(BaseModel):
    """Manually prepared expected results and baseline ground truth."""

    model_config = ConfigDict(extra="forbid")

    expected_status: str = "ok"  # "ok", "partial", or "failed"
    expected_error_code: ErrorCode | None = None
    name: str | None = None
    headline: str | None = None
    location: str | None = None
    summary: str | None = None
    emails: list[str] = Field(default_factory=list)
    phones: list[str] = Field(default_factory=list)
    urls: list[str] = Field(default_factory=list)
    social_links: list[tuple[str, str]] = Field(default_factory=list)
    project_links: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    expected_warnings: list[WarningCode] = Field(default_factory=list)
    expected_grounded_fields: list[str] = Field(default_factory=list)
    expected_unsupported_fields: list[str] = Field(default_factory=list)
    expected_conflicts: list[str] = Field(default_factory=list)
    education_dates: list[tuple[str | None, str | None]] = Field(default_factory=list)
    experience_dates: list[tuple[str | None, str | None, bool]] = Field(
        default_factory=list
    )


class EvalCase(BaseModel):
    """Single synthetic evaluation case with document bytes and expected truth."""

    model_config = ConfigDict(extra="forbid")

    case_id: str
    name: str
    category: str
    description: str
    assumptions: str
    pdf_bytes: bytes
    synthetic_draft: ResumeDraft | None = None
    ground_truth: GroundTruth


class DeterministicMetrics(BaseModel):
    """Metrics for deterministic extraction rules (emails, phones, URLs)."""

    model_config = ConfigDict(extra="forbid")

    cases_evaluated: int
    email_metrics: FieldPR1
    phone_metrics: FieldPR1
    url_metrics: FieldPR1


class PipelineMetrics(BaseModel):
    """End-to-end extraction outcomes and candidate validities."""

    model_config = ConfigDict(extra="forbid")

    cases_evaluated: int
    successful_extractions: int
    partial_extractions: int
    failed_extractions: int
    schema_valid_count: int
    schema_valid_rate: MetricScore
    name_accuracy: MetricScore
    date_accuracy: MetricScore
    skills_metrics: FieldPR1


class GroundingMetrics(BaseModel):
    """Source grounding evaluation and evidence alignment metrics."""

    model_config = ConfigDict(extra="forbid")

    total_fields_evaluated: int
    grounded_fields_count: int
    partially_grounded_count: int
    unsupported_fields_count: int
    grounded_rate: MetricScore
    unsupported_rate: MetricScore
    grounding_precision: MetricScore
    grounding_recall: MetricScore
    conflict_count: int


class CaseSummary(BaseModel):
    """Per-case evaluation outcome summary."""

    model_config = ConfigDict(extra="forbid")

    case_id: str
    name: str
    category: str
    status: str
    schema_valid: bool
    warnings_count: int
    warnings: list[str] = Field(default_factory=list)
    latency_ms: int
    details: dict[str, Any] = Field(default_factory=dict)


class FallbackMetrics(BaseModel):
    """Offline synthetic metrics measuring provider failure recovery and resilience.

    DISCLAIMER: These metrics evaluate synthetic mocked provider failure scenarios
    in an offline harness. They measure fallback state machine correctness and
    recovery logic, not live third-party network reliability.
    """

    model_config = ConfigDict(extra="forbid")

    scenarios_evaluated: int
    primary_success_count: int
    primary_success_rate: MetricScore
    fallback_activation_count: int
    eligible_failures_count: int
    fallback_recovery_count: int
    recovery_rate: MetricScore
    dual_failure_count: int
    dual_failure_rate: MetricScore
    average_attempts_per_request: float


class StrategyMetrics(BaseModel):
    """Metrics for an extraction strategy across synthetic comparative cases.

    Denominators are documented explicitly in each MetricScore.
    """

    model_config = ConfigDict(extra="forbid")

    strategy_name: str
    cases_evaluated: int
    field_accuracy: MetricScore
    unsupported_rate: MetricScore
    grounding_precision: MetricScore
    grounding_recall: MetricScore
    important_field_correction_rate: MetricScore
    incorrect_change_rate: MetricScore
    unresolved_conflict_rate: MetricScore
    provider_calls_per_request: float
    synthetic_latency_ms: float
    estimated_tokens_per_request: int


class SecondOpinionComparison(BaseModel):
    """Side-by-side comparative evaluation of Strategy A vs Strategy B.

    DISCLAIMER: Latency, call budgets, and token usage are derived from synthetic
    mock fixtures. They evaluate pipeline logic and trade-offs under deterministic
    conditions, not live network behavior.
    """

    model_config = ConfigDict(extra="forbid")

    scenarios_evaluated: int
    strategy_a_baseline: StrategyMetrics
    strategy_b_candidate: StrategyMetrics
    accuracy_delta: float
    unsupported_rate_delta: float
    calls_overhead_pct: float
    latency_overhead_pct: float
    tokens_overhead_pct: float
    recommendation: str
    rationale: str
    disclaimer: str = (
        "Synthetic comparative evaluation. Latency and token figures are synthetic "
        "mock estimates used for cost/benefit trade-off analysis."
    )


class EvaluationReport(BaseModel):
    """Top-level evaluation report encompassing all components and baselines."""

    model_config = ConfigDict(extra="forbid")

    dataset_version: str = "1.0.0"
    mode: str = "offline_synthetic"
    disclaimer: str = (
        "Synthetic offline evaluation baseline. High grounding scores measure "
        "evidence support in source text and annotations; they do not prove "
        "real-world factual correctness."
    )
    evaluated_at: str
    cases_evaluated: int
    deterministic: DeterministicMetrics
    pipeline: PipelineMetrics
    grounding: GroundingMetrics
    fallback: FallbackMetrics | None = None
    second_opinion: SecondOpinionComparison | None = None
    warnings_by_code: dict[str, int] = Field(default_factory=dict)
    average_latency_ms: float
    case_summaries: list[CaseSummary] = Field(default_factory=list)
