"""Command-line interface for running ONEVUE offline evaluation harness."""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.evaluation.harness import EvaluationHarness
from app.evaluation.models import EvaluationReport


def format_report_text(report: EvaluationReport, verbose: bool = False) -> str:
    """Format EvaluationReport into a structured human-readable text presentation."""
    lines: list[str] = []
    w = 78
    sep = "=" * w
    sub_sep = "-" * w

    lines.append(sep)
    lines.append(" ONEVUE LLM SERVICE — OFFLINE EVALUATION BASELINE REPORT".center(w))
    lines.append(sep)
    lines.append(f" Dataset Version : {report.dataset_version}")
    lines.append(f" Evaluation Mode : {report.mode}")
    lines.append(f" Evaluated At    : {report.evaluated_at}")
    lines.append(f" Total Cases     : {report.cases_evaluated}")
    lines.append(f" Average Latency : {report.average_latency_ms:.2f} ms")
    lines.append(sub_sep)

    # 1. Pipeline Execution Status
    pm = report.pipeline
    lines.append(" 1. EXTRACTION PIPELINE OUTCOMES")
    lines.append(
        f"    Successful (OK)      : {pm.successful_extractions}/{pm.cases_evaluated} "
        f"({pm.successful_extractions / pm.cases_evaluated * 100:.1f}%)"
    )
    lines.append(
        f"    Partial Extractions  : {pm.partial_extractions}/{pm.cases_evaluated} "
        f"({pm.partial_extractions / pm.cases_evaluated * 100:.1f}%)"
    )
    lines.append(
        f"    Failed (Expected)    : {pm.failed_extractions}/{pm.cases_evaluated} "
        f"({pm.failed_extractions / pm.cases_evaluated * 100:.1f}%)"
    )
    lines.append(
        f"    Schema-Valid Rate    : {pm.schema_valid_rate.value * 100:.1f}% "
        f"({int(pm.schema_valid_rate.numerator)}/{pm.schema_valid_rate.denominator})"
    )
    lines.append(sub_sep)

    # 2. Deterministic Rule Extraction Metrics
    dm = report.deterministic
    lines.append(" 2. DETERMINISTIC RULE-BASED EXTRACTION (Emails, Phones, URLs)")
    lines.append(
        f"    {'Field':<10} | {'Precision':<18} | {'Recall':<18} | {'F1-Score':<10}"
    )
    lines.append(f"    {'-' * 10}-|-{'-' * 18}-|-{'-' * 18}-|-{'-' * 10}")
    for name, m in [
        ("Emails", dm.email_metrics),
        ("Phones", dm.phone_metrics),
        ("URLs", dm.url_metrics),
    ]:
        p_num = int(m.precision.numerator)
        p_den = m.precision.denominator
        p_str = f"{m.precision.value:.4f} ({p_num}/{p_den})"

        r_num = int(m.recall.numerator)
        r_den = m.recall.denominator
        r_str = f"{m.recall.value:.4f} ({r_num}/{r_den})"

        row = f"    {name:<10} | {p_str:<18} | {r_str:<18} | {m.f1.value:<10.4f}"
        lines.append(row)
    lines.append(sub_sep)

    # 3. Field Accuracy Metrics
    lines.append(" 3. FIELD-LEVEL ACCURACY (End-to-End Candidates)")
    lines.append(
        f"    Name Accuracy        : {pm.name_accuracy.value * 100:.1f}% "
        f"({int(pm.name_accuracy.numerator)}/{pm.name_accuracy.denominator})"
    )
    lines.append(
        f"    Date Accuracy        : {pm.date_accuracy.value * 100:.1f}% "
        f"({int(pm.date_accuracy.numerator)}/{pm.date_accuracy.denominator})"
    )
    sm = pm.skills_metrics
    sp_num = int(sm.precision.numerator)
    lines.append(
        f"    Skills Precision     : {sm.precision.value:.4f} "
        f"({sp_num}/{sm.precision.denominator})"
    )
    sr_num = int(sm.recall.numerator)
    lines.append(
        f"    Skills Recall        : {sm.recall.value:.4f} "
        f"({sr_num}/{sm.recall.denominator})"
    )
    lines.append(f"    Skills F1-Score      : {sm.f1.value:.4f}")
    lines.append(sub_sep)

    # 4. Source Grounding & Evidence Metrics
    gm = report.grounding
    lines.append(" 4. SOURCE GROUNDING & EVIDENCE")
    lines.append(f"    Total Evaluated Fields : {gm.total_fields_evaluated}")
    lines.append(
        f"    Grounded Fields        : {gm.grounded_fields_count} "
        f"({gm.grounded_rate.value * 100:.1f}%)"
    )
    lines.append(f"    Partially Grounded     : {gm.partially_grounded_count}")
    lines.append(
        f"    Unsupported Fields     : {gm.unsupported_fields_count} "
        f"({gm.unsupported_rate.value * 100:.1f}%)"
    )
    lines.append(
        f"    Grounding Precision    : {gm.grounding_precision.value:.4f} "
        f"({int(gm.grounding_precision.numerator)}/{gm.grounding_precision.denominator})"
    )
    lines.append(
        f"    Grounding Recall       : {gm.grounding_recall.value:.4f} "
        f"({int(gm.grounding_recall.numerator)}/{gm.grounding_recall.denominator})"
    )
    lines.append(f"    Candidate Conflicts    : {gm.conflict_count}")
    lines.append(sub_sep)

    # 5. Provider Fallback & Resilience (Mocked Offline Scenarios)
    if report.fallback:
        fb = report.fallback
        lines.append(" 5. PROVIDER FALLBACK & RESILIENCE (Mocked Offline Scenarios)")
        lines.append(f"    Scenarios Evaluated    : {fb.scenarios_evaluated}")
        lines.append(
            f"    Primary Success Rate   : {fb.primary_success_rate.value * 100:.1f}% "
            f"({int(fb.primary_success_rate.numerator)}/{fb.primary_success_rate.denominator})"
        )
        lines.append(f"    Fallback Activations   : {fb.fallback_activation_count}")
        lines.append(
            f"    Fallback Recovery Rate : {fb.recovery_rate.value * 100:.1f}% "
            f"({int(fb.recovery_rate.numerator)}/{fb.recovery_rate.denominator})"
        )
        lines.append(
            f"    Dual Failure Rate      : {fb.dual_failure_rate.value * 100:.1f}% "
            f"({int(fb.dual_failure_rate.numerator)}/{fb.dual_failure_rate.denominator})"
        )
        lines.append(
            f"    Avg Attempts / Request : {fb.average_attempts_per_request:.3f}"
        )
        lines.append(sub_sep)

    # 6. Second-Opinion Comparative Evaluation (Strategy A vs B)
    if report.second_opinion:
        so = report.second_opinion
        lines.append(" 6. SECOND-OPINION COMPARATIVE EVALUATION (Strategy A vs B)")
        lines.append(f"    Benchmark Scenarios    : {so.scenarios_evaluated}")
        lines.append(f"    {'Metric':<30} | {'Strategy A':<14} | {'Strategy B':<14}")
        lines.append(f"    {'-' * 30}-|-{'-' * 14}-|-{'-' * 14}")

        sa = so.strategy_a_baseline
        sb = so.strategy_b_candidate

        acc_a = (
            f"{sa.field_accuracy.value * 100:.1f}% "
            f"({int(sa.field_accuracy.numerator)}/{sa.field_accuracy.denominator})"
        )
        acc_b = (
            f"{sb.field_accuracy.value * 100:.1f}% "
            f"({int(sb.field_accuracy.numerator)}/{sb.field_accuracy.denominator})"
        )
        lines.append(f"    {'Field Accuracy':<30} | {acc_a:<18} | {acc_b:<18}")

        uns_a = (
            f"{sa.unsupported_rate.value * 100:.1f}% "
            f"({int(sa.unsupported_rate.numerator)}/{sa.unsupported_rate.denominator})"
        )
        uns_b = (
            f"{sb.unsupported_rate.value * 100:.1f}% "
            f"({int(sb.unsupported_rate.numerator)}/{sb.unsupported_rate.denominator})"
        )
        lines.append(f"    {'Unsupported Field Rate':<30} | {uns_a:<18} | {uns_b:<18}")

        gp_a = (
            f"{sa.grounding_precision.value:.4f} "
            f"({int(sa.grounding_precision.numerator)}/{sa.grounding_precision.denominator})"
        )
        gp_b = (
            f"{sb.grounding_precision.value:.4f} "
            f"({int(sb.grounding_precision.numerator)}/{sb.grounding_precision.denominator})"
        )
        lines.append(f"    {'Grounding Precision':<30} | {gp_a:<18} | {gp_b:<18}")

        gr_a = (
            f"{sa.grounding_recall.value:.4f} "
            f"({int(sa.grounding_recall.numerator)}/{sa.grounding_recall.denominator})"
        )
        gr_b = (
            f"{sb.grounding_recall.value:.4f} "
            f"({int(sb.grounding_recall.numerator)}/{sb.grounding_recall.denominator})"
        )
        lines.append(f"    {'Grounding Recall':<30} | {gr_a:<18} | {gr_b:<18}")

        cor_a = (
            f"{sa.important_field_correction_rate.value * 100:.1f}% "
            f"({int(sa.important_field_correction_rate.numerator)}/{sa.important_field_correction_rate.denominator})"
        )
        cor_b = (
            f"{sb.important_field_correction_rate.value * 100:.1f}% "
            f"({int(sb.important_field_correction_rate.numerator)}/{sb.important_field_correction_rate.denominator})"
        )
        lines.append(
            f"    {'Important Field Correction':<30} | {cor_a:<18} | {cor_b:<18}"
        )

        inc_a = (
            f"{sa.incorrect_change_rate.value * 100:.1f}% "
            f"({int(sa.incorrect_change_rate.numerator)}/{sa.incorrect_change_rate.denominator})"
        )
        inc_b = (
            f"{sb.incorrect_change_rate.value * 100:.1f}% "
            f"({int(sb.incorrect_change_rate.numerator)}/{sb.incorrect_change_rate.denominator})"
        )
        lines.append(f"    {'Incorrect Change Rate':<30} | {inc_a:<18} | {inc_b:<18}")

        cnf_a = (
            f"{sa.unresolved_conflict_rate.value * 100:.1f}% "
            f"({int(sa.unresolved_conflict_rate.numerator)}/{sa.unresolved_conflict_rate.denominator})"
        )
        cnf_b = (
            f"{sb.unresolved_conflict_rate.value * 100:.1f}% "
            f"({int(sb.unresolved_conflict_rate.numerator)}/{sb.unresolved_conflict_rate.denominator})"
        )
        lines.append(
            f"    {'Unresolved Conflict Rate':<30} | {cnf_a:<18} | {cnf_b:<18}"
        )

        call_a = f"{sa.provider_calls_per_request:.3f}"
        call_b = f"{sb.provider_calls_per_request:.3f} (+{so.calls_overhead_pct:.1f}%)"
        lines.append(
            f"    {'Provider Calls / Request':<30} | {call_a:<18} | {call_b:<18}"
        )

        lat_a = f"{sa.synthetic_latency_ms:.1f} ms"
        lat_b = f"{sb.synthetic_latency_ms:.1f} ms (+{so.latency_overhead_pct:.1f}%)"
        lines.append(f"    {'Synthetic Latency (Est)':<30} | {lat_a:<18} | {lat_b:<18}")

        tok_a = f"{sa.estimated_tokens_per_request} tokens"
        tok_b = (
            f"{sb.estimated_tokens_per_request} tokens (+{so.tokens_overhead_pct:.1f}%)"
        )
        lines.append(f"    {'Tokens / Request (Est)':<30} | {tok_a:<18} | {tok_b:<18}")

        lines.append(f"    Accuracy Delta         : {so.accuracy_delta * 100:+.1f}%")
        lines.append(f"    Recommendation         : {so.recommendation}")
        lines.append(f"    Rationale              : {so.rationale}")
        lines.append(sub_sep)

    # 7. Warning Distribution
    lines.append(" 7. WARNINGS DISTRIBUTION")
    if report.warnings_by_code:
        for code, count in sorted(report.warnings_by_code.items()):
            lines.append(f"    - {code:<24} : {count}")
    else:
        lines.append("    (No warnings emitted)")
    lines.append(sub_sep)

    # 8. Case Summaries (if verbose)
    if verbose:
        lines.append(" 8. CASE-BY-CASE BREAKDOWN")
        for cs in report.case_summaries:
            status_tag = f"[{cs.status.upper()}]"
            valid_tag = "VALID" if cs.schema_valid else "INVALID"
            lines.append(
                f"    {status_tag:<10} {cs.case_id:<32} "
                f"({valid_tag}, {cs.warnings_count} warnings, {cs.latency_ms}ms)"
            )
        lines.append(sub_sep)

    # Disclaimer
    lines.append(" DISCLAIMER & METHODOLOGY")
    lines.append(f" {report.disclaimer}")
    lines.append(sep)
    return "\n".join(lines)


async def async_main(args: argparse.Namespace) -> int:
    """Execute evaluation and handle reporting."""
    harness = EvaluationHarness()
    report = await harness.run_evaluation()

    text_summary = format_report_text(report, verbose=args.verbose)
    print(text_summary)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(report.model_dump(), f, indent=2)
        print(f"\n[+] Machine-readable report saved to: {out_path}")

    return 0


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="ONEVUE Offline Evaluation Harness & Baseline Generator"
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="Optional path to output machine-readable JSON report.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Display case-by-case evaluation details.",
    )
    parsed = parser.parse_args()
    exit_code = asyncio.run(async_main(parsed))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
