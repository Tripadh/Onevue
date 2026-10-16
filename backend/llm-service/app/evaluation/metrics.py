"""Metrics calculations and statistical aggregation helpers for ONEVUE evaluation."""

import re
from urllib.parse import urlparse

from app.evaluation.models import FieldPR1, MetricScore


def canonicalize_email(email: str) -> str:
    """Normalize email address for case-insensitive comparison."""
    return email.strip().lower()


def canonicalize_phone(phone: str) -> str:
    """Normalize phone number to digits with optional leading plus sign."""
    cleaned = re.sub(r"[\s\(\)\-\.]", "", phone.strip())
    return cleaned


def canonicalize_url(url: str) -> str:
    """Normalize URL by standardizing scheme and removing trailing slashes."""
    u = url.strip()
    if not (u.startswith("http://") or u.startswith("https://")):
        u = f"https://{u}"
    parsed = urlparse(u)
    scheme = "https" if parsed.scheme in ("http", "https") else parsed.scheme
    netloc = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path.rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{scheme}://{netloc}{path}{query}"


def compute_metric_score(
    name: str,
    numerator: float,
    denominator: int,
    definition: str,
    description: str,
    zero_denominator_value: float = 1.0,
) -> MetricScore:
    """Compute a single MetricScore with explicit zero-denominator handling."""
    if denominator == 0:
        val = zero_denominator_value if numerator == 0 else 0.0
    else:
        val = numerator / denominator

    return MetricScore(
        name=name,
        value=round(val, 4),
        numerator=float(numerator),
        denominator=denominator,
        definition=definition,
        description=description,
    )


def compute_pr1_from_counts(
    field_name: str,
    tp: int,
    fp: int,
    fn: int,
) -> FieldPR1:
    """Compute precision, recall, and F1 from aggregated counts."""
    prec_denom = tp + fp
    rec_denom = tp + fn

    if prec_denom == 0:
        # If no predictions were made and none were expected, precision is 1.0
        prec_val = 1.0 if rec_denom == 0 else 0.0
    else:
        prec_val = tp / prec_denom

    if rec_denom == 0:
        # If no items were expected and none were predicted, recall is 1.0
        rec_val = 1.0 if prec_denom == 0 else 0.0
    else:
        rec_val = tp / rec_denom

    if prec_val + rec_val > 0:
        f1_val = (2 * prec_val * rec_val) / (prec_val + rec_val)
    else:
        f1_val = 0.0

    precision_score = MetricScore(
        name=f"{field_name}_precision",
        value=round(prec_val, 4),
        numerator=float(tp),
        denominator=prec_denom,
        definition="TP / (TP + FP)",
        description=(
            f"Precision for {field_name}. Denominator is total predicted"
            f" {field_name} count."
        ),
    )

    recall_score = MetricScore(
        name=f"{field_name}_recall",
        value=round(rec_val, 4),
        numerator=float(tp),
        denominator=rec_denom,
        definition="TP / (TP + FN)",
        description=(
            f"Recall for {field_name}. Denominator is total expected"
            f" {field_name} count."
        ),
    )

    f1_score = MetricScore(
        name=f"{field_name}_f1",
        value=round(f1_val, 4),
        numerator=float(round(f1_val * (prec_denom + rec_denom), 2)),
        denominator=prec_denom + rec_denom,
        definition="2 * (Precision * Recall) / (Precision + Recall)",
        description=f"Harmonic mean of precision and recall for {field_name}.",
    )

    return FieldPR1(
        field_name=field_name,
        true_positives=tp,
        false_positives=fp,
        false_negatives=fn,
        precision=precision_score,
        recall=recall_score,
        f1=f1_score,
    )


def compute_set_pr1(
    field_name: str,
    actual: set[str],
    expected: set[str],
) -> FieldPR1:
    """Compute Precision, Recall, and F1 for a predicted set against expected set."""
    tp = len(actual & expected)
    fp = len(actual - expected)
    fn = len(expected - actual)
    return compute_pr1_from_counts(field_name, tp, fp, fn)
