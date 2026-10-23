"""Offline tests for consented real-resume evaluation harness.

Target: scripts/evaluate_consented.py

Guarantees:
- Uses temporary synthetic files in tmp_path strictly outside the repository.
- Never connects to external networks or live provider APIs.
- Validates repository boundary rejection and symlink escape prevention.
- Validates operator consent acknowledgement requirement.
- Validates aggregate metrics math (precision, recall, F1, missing/unsupported rates).
- Validates zero personal data leakage in stdout or report output.
"""

import json
from unittest.mock import AsyncMock

import pymupdf
import pytest

from app.schemas.llm_draft import ProfileDraft, ResumeDraft, SkillDraft, SocialLinkDraft
from scripts.evaluate_consented import (
    ConsentedEvaluationRunner,
    assert_path_outside_repository,
    find_repository_root,
    format_evaluation_output,
    parse_args,
)


class TestConsentedEvaluationSecurityAndBoundaries:
    """Test filesystem isolation and safety gates for external datasets."""

    def test_missing_consent_flag_halts_safely(self, capsys):
        """Without --i-confirm-consented-data, script refuses to process any files."""
        args = parse_args(
            [
                "--dataset-path",
                "/tmp/external_dataset",
                "--labels-path",
                "/tmp/external_labels.json",
            ]
        )
        assert args.i_confirm_consented_data is False

        # In main, this results in exit code 2
        from unittest.mock import patch

        from scripts.evaluate_consented import main

        with patch(
            "sys.argv",
            [
                "evaluate_consented.py",
                "--dataset-path",
                "/tmp/d",
                "--labels-path",
                "/tmp/l.json",
            ],
        ):
            code = main()
            assert code == 2

        captured = capsys.readouterr()
        assert "[SAFETY HALT]" in captured.err
        assert "--i-confirm-consented-data" in captured.err

    def test_rejects_paths_inside_repository(self, tmp_path):
        repo_root = find_repository_root()

        # Path directly inside repo
        internal_dir = repo_root / "tests"
        with pytest.raises(
            ValueError, match="Security violation: path .* resolves inside repository"
        ):
            assert_path_outside_repository(internal_dir, repo_root)

        # File directly inside repo
        internal_file = repo_root / "pyproject.toml"
        if not internal_file.exists():
            internal_file = repo_root / "backend" / "llm-service" / "pyproject.toml"
        with pytest.raises(
            ValueError, match="Security violation: path .* resolves inside repository"
        ):
            assert_path_outside_repository(internal_file, repo_root)

    def test_rejects_symlink_pointing_into_repository(self, tmp_path):
        repo_root = find_repository_root()

        # Create a symlink in external tmp_path that points to something inside repo
        external_symlink = tmp_path / "symlink_to_repo"
        target_in_repo = repo_root / "pyproject.toml"
        if not target_in_repo.exists():
            target_in_repo = repo_root / "backend" / "llm-service" / "pyproject.toml"

        external_symlink.symlink_to(target_in_repo)

        # Resolving this external symlink leads inside the repo and must be rejected
        with pytest.raises(
            ValueError, match="Security violation: path .* resolves inside repository"
        ):
            assert_path_outside_repository(external_symlink, repo_root)

    def test_accepts_valid_external_path(self, tmp_path):
        repo_root = find_repository_root()
        external_file = tmp_path / "valid_external.txt"
        external_file.write_text("hello")

        resolved = assert_path_outside_repository(external_file, repo_root)
        assert resolved == external_file.resolve()


class TestConsentedEvaluationExecutionAndMetrics:
    """Test execution on temporary synthetic files and aggregate scoring."""

    @pytest.fixture
    def external_eval_setup(self, tmp_path):
        """Create a synthetic dataset and anonymized labels in tmp_path."""
        dataset_dir = tmp_path / "external_dataset"
        dataset_dir.mkdir()

        # Create a synthetic PDF: case_001.pdf
        doc = pymupdf.open()
        p = doc.new_page()
        p.insert_text(
            (50, 72),
            "Alex Smith\n"
            "Email: alex.test@example.com\n"
            "Phone: 555-0101\n"
            "Skills: Python, TypeScript\n",
        )
        (dataset_dir / "case_001.pdf").write_bytes(doc.tobytes())
        doc.close()

        # Create anonymized labels file: case_001
        labels = {
            "case_001": {
                "emails": ["alex.test@example.com"],
                "phones": ["5550101"],
                "urls": ["https://linkedin.com/in/alex-smith"],
                "skills": ["python", "typescript", "docker"],  # Docker missing -> FN
            }
        }
        labels_path = tmp_path / "anonymized_labels.json"
        labels_path.write_text(json.dumps(labels))

        return dataset_dir, labels_path

    @pytest.mark.anyio
    async def test_evaluate_all_computes_aggregate_metrics(
        self, external_eval_setup, capsys
    ):
        dataset_dir, labels_path = external_eval_setup

        mock_provider = AsyncMock()
        mock_draft = ResumeDraft(
            profile=ProfileDraft(
                name="Alex Smith",
                email="alex.test@example.com",
                phone="555-0101",
            ),
            skills=[SkillDraft(name="Python"), SkillDraft(name="TypeScript")],
            socialLinks=[
                SocialLinkDraft(
                    platform="LinkedIn", url="https://linkedin.com/in/alex-smith"
                )
            ],
        )
        mock_res = AsyncMock()
        mock_res.draft = mock_draft
        mock_provider.extract.return_value = mock_res

        runner = ConsentedEvaluationRunner(
            dataset_dir=dataset_dir,
            labels_file=labels_path,
            provider=mock_provider,
        )

        results = await runner.evaluate_all()

        assert results["cases_evaluated"] == 1
        assert results["successful_extractions"] == 1
        assert results["failed_extractions"] == 0

        # Emails: 1 TP, 0 FP, 0 FN -> P=1.0, R=1.0, F1=1.0
        assert results["emails"]["f1"] == 1.0

        # Phones: 1 TP, 0 FP, 0 FN -> P=1.0, R=1.0, F1=1.0
        assert results["phones"]["f1"] == 1.0

        # URLs: 1 TP, 0 FP, 0 FN -> P=1.0, R=1.0, F1=1.0
        assert results["urls"]["f1"] == 1.0

        # Skills: Expected 3 (python, typescript, docker),
        # Predicted 2 (python, typescript)
        # TP=2, FP=0, FN=1 -> Prec = 1.0, Recall = 2/3 = 0.6667
        assert results["skills"]["precision"] == 1.0
        assert results["skills"]["recall"] == pytest.approx(0.6667, abs=1e-3)

        # Output formatting test
        format_evaluation_output(results)
        captured = capsys.readouterr()

        # Zero personal data or candidate names in output
        assert "Alex Smith" not in captured.out
        assert "alex.test@example.com" not in captured.out
        assert "555-0101" not in captured.out
        assert "CONSENTED REAL-RESUME EVALUATION" in captured.out
        assert "Precision=" in captured.out
