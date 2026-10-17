"""Deterministic confidence policy and source provenance attribution.

Confidence policy:
- HIGH: Direct, specific evidence supports the value with verified offsets/page.
- MEDIUM: Partial evidence (e.g. year matched for date, >=80% token overlap)
  or resolved conflict.
- LOW: Unsupported, weak, or unverified value.
"""

from app.schemas.response import Confidence, FieldSource, GroundingStatus


def evaluate_field_confidence(
    grounding_status: GroundingStatus,
    source: FieldSource,
    has_conflict: bool = False,
) -> Confidence:
    """Deterministically assign a Confidence tier based on evidence quality.

    Args:
        grounding_status: Verification outcome against source document.
        source: Provenance origin of the value.
        has_conflict: Whether conflicting alternative candidates were observed.

    Returns:
        Confidence tier (HIGH, MEDIUM, or LOW).
    """
    if has_conflict:
        # Conflicts reduce confidence to MEDIUM even if deterministic candidate selected
        return Confidence.MEDIUM

    if grounding_status == GroundingStatus.GROUNDED:
        return Confidence.HIGH

    if grounding_status == GroundingStatus.PARTIALLY_GROUNDED:
        return Confidence.MEDIUM

    # UNSUPPORTED, NOT_CHECKED, or unverified fields
    return Confidence.LOW


def evaluate_field_source(
    from_rules: bool,
    is_grounded: bool,
) -> FieldSource:
    """Determine FieldSource origin identifier.

    Args:
        from_rules: True if candidate originated from deterministic extraction.
        is_grounded: True if candidate has verified supporting evidence.

    Returns:
        FieldSource (RULES, LLM_CHECK, or LLM).
    """
    if from_rules:
        return FieldSource.RULES
    if is_grounded:
        return FieldSource.LLM_CHECK
    return FieldSource.LLM
