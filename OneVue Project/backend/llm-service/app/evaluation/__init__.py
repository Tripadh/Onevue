"""Evaluation harness and dataset package for ONEVUE."""

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
from app.evaluation.models import (
    CaseSummary,
    DeterministicMetrics,
    EvalCase,
    EvaluationReport,
    FieldPR1,
    GroundingMetrics,
    GroundTruth,
    MetricScore,
    PipelineMetrics,
)

__all__ = [
    "CaseSummary",
    "DeterministicMetrics",
    "EvalCase",
    "EvaluationHarness",
    "EvaluationReport",
    "FieldPR1",
    "GroundTruth",
    "GroundingMetrics",
    "MetricScore",
    "PipelineMetrics",
    "build_evaluation_dataset",
    "canonicalize_email",
    "canonicalize_phone",
    "canonicalize_url",
    "compute_metric_score",
    "compute_pr1_from_counts",
    "compute_set_pr1",
]
