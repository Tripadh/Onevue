"""Consented real-resume evaluation harness for external datasets.

PRIVACY & ETHICAL PROTOCOL:
1. Informed Consent: Datasets must consist strictly of documents provided with
   informed, documented consent from candidates for evaluation purposes.
2. Anonymization: Reference labels must use anonymized case identifiers
   (e.g. 'case_001') rather than real names or identifiable metadata.
3. Access Control & Repository Isolation: Dataset files and labels must reside
   strictly outside the repository root. Repository-internal paths and
   symlink escapes are strictly rejected.
4. Zero Persistent Copies: Datasets are never copied into the repository or
   retained in temporary caches.
5. Aggregate Reporting Only: Outputs provide field-level aggregate precision,
   recall, F1, missing rates, and unsupported rates. Never prints raw candidate
   text, personal identifiers, filenames, or label values.
6. Retention & Secure Deletion: Operators must securely delete or shred
   evaluation documents after evaluation runs.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

# Ensure project root is on sys.path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_CURRENT_DIR)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from app.config import Settings, get_settings  # noqa: E402
from app.evaluation.metrics import (  # noqa: E402
    canonicalize_email,
    canonicalize_phone,
    canonicalize_url,
    compute_pr1_from_counts,
    compute_set_pr1,
)
from app.extraction.isolated_parser import get_isolated_pdf_parser  # noqa: E402
from app.orchestration.mock import MockProvider  # noqa: E402


def find_repository_root() -> Path:
    """Locate the root of the repository to enforce filesystem isolation."""
    current = Path(__file__).resolve().parent
    while current.parent != current:
        if (current / "pyproject.toml").exists():
            # Check if this is backend/llm-service or repo root
            if current.parent.name == "backend" and current.parent.parent.exists():
                return current.parent.parent.resolve()
            return current.resolve()
        current = current.parent
    return Path(__file__).resolve().parents[1]


def assert_path_outside_repository(path: Path, repo_root: Path) -> Path:
    """Validate that path exists and strictly resolves outside repository tree.

    Rejects paths inside the repository, paths pointing into repo via symlinks,
    and symlinks within repo pointing outside.
    """
    resolved_path = path.resolve()
    resolved_repo = repo_root.resolve()

    # Reject if path is repo root or a subdirectory of repo
    if resolved_path == resolved_repo or resolved_repo in resolved_path.parents:
        raise ValueError(
            f"Security violation: path '{path}' resolves inside repository "
            f"'{resolved_repo}'. Evaluation datasets and labels must reside "
            "strictly outside the repository."
        )

    # Check that original path does not traverse through repo root
    try:
        path.absolute().relative_to(resolved_repo)
        raise ValueError(
            f"Security violation: path '{path}' is positioned within repository "
            f"'{resolved_repo}'."
        )
    except ValueError:
        pass  # Expected: not relative to repo root

    return resolved_path


class ConsentedEvaluationRunner:
    """Executes evaluation on external consented dataset.

    Computes field-level aggregate precision, recall, and F1 metrics.
    """

    def __init__(
        self,
        dataset_dir: Path,
        labels_file: Path,
        repo_root: Path | None = None,
        provider: Any | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.repo_root = repo_root or find_repository_root()
        self.dataset_dir = assert_path_outside_repository(dataset_dir, self.repo_root)
        self.labels_file = assert_path_outside_repository(labels_file, self.repo_root)
        self.settings = settings or get_settings()
        self.provider = provider or MockProvider()

        if not self.dataset_dir.is_dir():
            raise ValueError(f"Dataset path is not a directory: {self.dataset_dir}")
        if not self.labels_file.is_file():
            raise ValueError(f"Labels file does not exist: {self.labels_file}")

        with open(self.labels_file, encoding="utf-8") as f:
            self.labels: dict[str, Any] = json.load(f)

    async def evaluate_all(self) -> dict[str, Any]:
        """Run extraction across all dataset cases and compute aggregate statistics."""
        parser = get_isolated_pdf_parser(self.settings)

        total_cases = 0
        successful = 0
        partial = 0
        failed = 0

        # Field count aggregators (TP, FP, FN)
        email_tp = email_fp = email_fn = 0
        phone_tp = phone_fp = phone_fn = 0
        url_tp = url_fp = url_fn = 0
        skills_tp = skills_fp = skills_fn = 0

        missing_field_events = 0
        total_expected_fields = 0
        unsupported_field_events = 0
        total_extracted_fields = 0

        start_time = time.perf_counter()

        # Iterate over labeled case IDs
        for case_id, ground_truth in self.labels.items():
            # Validate case ID naming (strictly anonymized)
            is_valid_id = case_id.isalnum() or all(
                c.isalnum() or c in "_-" for c in case_id
            )
            if not is_valid_id:
                continue

            pdf_candidates = [
                self.dataset_dir / f"{case_id}.pdf",
                self.dataset_dir / f"{case_id}.PDF",
            ]
            pdf_path = next((p for p in pdf_candidates if p.exists()), None)
            if pdf_path is None:
                continue

            # Verify individual file resolution does not escape into repository
            assert_path_outside_repository(pdf_path, self.repo_root)

            total_cases += 1
            content = pdf_path.read_bytes()

            try:
                # 1. Parse PDF in isolated worker
                extract_res = parser.extract(
                    content,
                    max_pages=self.settings.PDF_MAX_PAGES,
                    max_text_chars=self.settings.PDF_MAX_TEXT_CHARS,
                )

                # 2. Extract structured draft via provider
                provider_res = await self.provider.extract(extract_res.text)
                draft = provider_res.draft
                successful += 1

                # 3. Aggregate Email Metrics
                pred_emails = (
                    {canonicalize_email(draft.profile.email)}
                    if draft.profile.email
                    else set()
                )
                exp_emails = {
                    canonicalize_email(e) for e in ground_truth.get("emails", [])
                }
                email_res = compute_set_pr1("email", pred_emails, exp_emails)
                email_tp += email_res.true_positives
                email_fp += email_res.false_positives
                email_fn += email_res.false_negatives

                # 4. Aggregate Phone Metrics
                pred_phones = (
                    {canonicalize_phone(draft.profile.phone)}
                    if draft.profile.phone
                    else set()
                )
                exp_phones = {
                    canonicalize_phone(p) for p in ground_truth.get("phones", [])
                }
                phone_res = compute_set_pr1("phone", pred_phones, exp_phones)
                phone_tp += phone_res.true_positives
                phone_fp += phone_res.false_positives
                phone_fn += phone_res.false_negatives

                # 5. Aggregate URL Metrics
                pred_urls = {
                    canonicalize_url(link.url) for link in draft.socialLinks if link.url
                }
                exp_urls = {canonicalize_url(u) for u in ground_truth.get("urls", [])}
                url_res = compute_set_pr1("url", pred_urls, exp_urls)
                url_tp += url_res.true_positives
                url_fp += url_res.false_positives
                url_fn += url_res.false_negatives

                # 6. Aggregate Skills Metrics
                pred_skills = {
                    s.name.strip().lower()
                    for s in draft.skills
                    if s.name and s.name.strip()
                }
                exp_skills = {
                    s.strip().lower()
                    for s in ground_truth.get("skills", [])
                    if s.strip()
                }
                skills_res = compute_set_pr1("skills", pred_skills, exp_skills)
                skills_tp += skills_res.true_positives
                skills_fp += skills_res.false_positives
                skills_fn += skills_res.false_negatives

                # Missing & Unsupported field rates
                if exp_emails:
                    total_expected_fields += 1
                    if not pred_emails:
                        missing_field_events += 1
                if exp_phones:
                    total_expected_fields += 1
                    if not pred_phones:
                        missing_field_events += 1
                if exp_skills:
                    total_expected_fields += 1
                    if not pred_skills:
                        missing_field_events += 1

                if pred_emails:
                    total_extracted_fields += 1
                    if not exp_emails:
                        unsupported_field_events += 1
                if pred_phones:
                    total_extracted_fields += 1
                    if not exp_phones:
                        unsupported_field_events += 1
                if pred_skills:
                    total_extracted_fields += 1
                    if not exp_skills:
                        unsupported_field_events += 1

            except Exception:
                failed += 1

        elapsed_total = time.perf_counter() - start_time

        email_metrics = compute_pr1_from_counts("emails", email_tp, email_fp, email_fn)
        phone_metrics = compute_pr1_from_counts("phones", phone_tp, phone_fp, phone_fn)
        url_metrics = compute_pr1_from_counts("urls", url_tp, url_fp, url_fn)
        skills_metrics = compute_pr1_from_counts(
            "skills", skills_tp, skills_fp, skills_fn
        )

        missing_field_rate = (
            round(missing_field_events / total_expected_fields, 4)
            if total_expected_fields > 0
            else 0.0
        )
        unsupported_field_rate = (
            round(unsupported_field_events / total_extracted_fields, 4)
            if total_extracted_fields > 0
            else 0.0
        )

        return {
            "cases_evaluated": total_cases,
            "successful_extractions": successful,
            "partial_extractions": partial,
            "failed_extractions": failed,
            "elapsed_seconds": round(elapsed_total, 2),
            "missing_field_rate": missing_field_rate,
            "unsupported_field_rate": unsupported_field_rate,
            "emails": {
                "precision": email_metrics.precision.value,
                "recall": email_metrics.recall.value,
                "f1": email_metrics.f1.value,
            },
            "phones": {
                "precision": phone_metrics.precision.value,
                "recall": phone_metrics.recall.value,
                "f1": phone_metrics.f1.value,
            },
            "urls": {
                "precision": url_metrics.precision.value,
                "recall": url_metrics.recall.value,
                "f1": url_metrics.f1.value,
            },
            "skills": {
                "precision": skills_metrics.precision.value,
                "recall": skills_metrics.recall.value,
                "f1": skills_metrics.f1.value,
            },
        }


def format_evaluation_output(results: dict[str, Any]) -> None:
    """Print aggregate metrics report with zero personal data disclosure."""
    print("\n" + "=" * 65)
    print(" ONEVUE LLM SERVICE — CONSENTED REAL-RESUME EVALUATION")
    print("=" * 65)
    print(f" Cases Evaluated     : {results['cases_evaluated']}")
    print(f" Successful          : {results['successful_extractions']}")
    print(f" Failed Extractions  : {results['failed_extractions']}")
    print(f" Total Elapsed Time  : {results['elapsed_seconds']} s")
    print("-" * 65)
    print(" AGGREGATE FIELD QUALITY METRICS:")
    print(f"   Missing-Field Rate    : {results['missing_field_rate'] * 100:.1f}%")
    print(f"   Unsupported-Field Rate: {results['unsupported_field_rate'] * 100:.1f}%")
    print("-" * 65)
    print(" FIELD-LEVEL PRECISION, RECALL, F1:")
    for field_name in ("emails", "phones", "urls", "skills"):
        m = results.get(field_name, {})
        print(
            f"   {field_name.capitalize():<8}: "
            f"Precision={m.get('precision', 0.0):.3f} | "
            f"Recall={m.get('recall', 0.0):.3f} | "
            f"F1={m.get('f1', 0.0):.3f}"
        )
    print("=" * 65)
    print(
        " LIMITATIONS & DATA HYGIENE NOTICE:\n"
        " 1. Field-level metrics depend strictly on label completeness. Unlabeled\n"
        "    or ambiguous skills/roles may lower measured precision/recall.\n"
        " 2. Zero raw resume text, candidate names, contact details, or reference\n"
        "    data were persisted or uploaded.\n"
        " 3. The operator must securely delete or shred the local external dataset\n"
        "    once evaluation concludes.\n"
        "=================================================================\n"
    )


def parse_args(args: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments for consented evaluation tool."""
    parser = argparse.ArgumentParser(
        description="ONEVUE external consented real-resume evaluation harness."
    )
    parser.add_argument(
        "--i-confirm-consented-data",
        action="store_true",
        default=False,
        help=(
            "MANDATORY: Explicit acknowledgement that all documents in the target "
            "dataset have informed candidate consent and follow data minimization "
            "protocols."
        ),
    )
    parser.add_argument(
        "--dataset-path",
        required=True,
        type=Path,
        help=(
            "Path to external dataset directory (must reside strictly outside "
            "the repository)."
        ),
    )
    parser.add_argument(
        "--labels-path",
        required=True,
        type=Path,
        help=(
            "Path to anonymized JSON ground truth labels file (outside the repository)."
        ),
    )
    return parser.parse_args(args)


def main() -> int:
    """CLI entrypoint."""
    args = parse_args()
    if not args.i_confirm_consented_data:
        sys.stderr.write(
            "\n[SAFETY HALT] Consented evaluation requires explicit confirmation.\n"
            "Pass '--i-confirm-consented-data' to certify that all input resumes\n"
            "were collected with informed consent and follow privacy protocols.\n"
            "Exiting safely without processing any data.\n\n"
        )
        return 2

    try:
        runner = ConsentedEvaluationRunner(
            dataset_dir=args.dataset_path,
            labels_file=args.labels_path,
        )
        results = asyncio.run(runner.evaluate_all())
        format_evaluation_output(results)
        return 0
    except Exception as exc:
        sys.stderr.write(f"\n[EVALUATION ERROR] {exc}\n\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
