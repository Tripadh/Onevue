"""Automated contract verification, OpenAPI regression, and doc consistency tests.

Verifies:
1. OpenAPI specification synchronization and stale contract detection.
2. Route definitions, security schemes, and response models matching implementation.
3. Documentation examples parse validly against Pydantic response models.
4. Zero real secrets or ungrounded PII in documentation files.
5. All tests run offline with zero external network or provider calls.
"""

import json
import re
from pathlib import Path

from app.main import app
from app.schemas.errors import StructuredError
from app.schemas.response import ExtractionResponse
from scripts.export_openapi import generate_openapi_json

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DOCS_DIR = _PROJECT_ROOT / "docs"
_OPENAPI_PATH = _DOCS_DIR / "openapi.json"


class TestOpenApiContract:
    """Validate committed OpenAPI specification against running application schema."""

    def test_openapi_file_exists(self):
        """Verify docs/openapi.json exists on disk."""
        assert _OPENAPI_PATH.is_file(), (
            f"Missing OpenAPI file at '{_OPENAPI_PATH}'. "
            "Generate it with: ./.venv/bin/python scripts/export_openapi.py"
        )

    def test_committed_openapi_matches_running_app(self):
        """Regenerate schema in memory and compare against committed docs/openapi.json.

        Fails with clear instructions if committed file is stale.
        """
        assert _OPENAPI_PATH.is_file(), "docs/openapi.json does not exist."
        committed_text = _OPENAPI_PATH.read_text(encoding="utf-8")

        # In-memory schema generation
        generated_schema = app.openapi()
        generated_text = (
            json.dumps(generated_schema, indent=2, ensure_ascii=False) + "\n"
        )

        assert committed_text == generated_text, (
            "Committed docs/openapi.json differs from the running FastAPI application "
            "schema.\nRegenerate the contract using:\n"
            "  ./.venv/bin/python scripts/export_openapi.py"
        )

    def test_openapi_contains_all_expected_routes(self):
        """Verify all implemented public API routes are documented."""
        schema = json.loads(_OPENAPI_PATH.read_text(encoding="utf-8"))
        paths = schema.get("paths", {})

        expected_routes = {
            "/health",
            "/ready",
            "/version",
            "/metrics",
            "/",
            "/v1/extract",
        }
        for route in expected_routes:
            assert route in paths, (
                f"Route '{route}' missing from OpenAPI specification."
            )

    def test_openapi_security_schemes(self):
        """Verify server-to-server and metrics security schemes are configured."""
        schema = json.loads(_OPENAPI_PATH.read_text(encoding="utf-8"))
        components = schema.get("components", {})
        security_schemes = components.get("securitySchemes", {})

        assert "ApiKeyAuth" in security_schemes
        api_key_auth = security_schemes["ApiKeyAuth"]
        assert api_key_auth["type"] == "apiKey"
        assert api_key_auth["name"] == "X-API-Key"
        assert api_key_auth["in"] == "header"

        assert "MetricsTokenAuth" in security_schemes
        metrics_auth = security_schemes["MetricsTokenAuth"]
        assert metrics_auth["type"] == "http"
        assert metrics_auth["scheme"] == "bearer"

        # Check path attachments
        paths = schema.get("paths", {})
        extract_security = paths["/v1/extract"]["post"].get("security", [])
        assert {"ApiKeyAuth": []} in extract_security

        metrics_security = paths["/metrics"]["get"].get("security", [])
        assert {"MetricsTokenAuth": []} in metrics_security

    def test_openapi_response_status_codes_documented(self):
        """Verify error models and status codes are registered on /v1/extract."""
        schema = json.loads(_OPENAPI_PATH.read_text(encoding="utf-8"))
        extract_responses = schema["paths"]["/v1/extract"]["post"]["responses"]

        expected_status_codes = [
            "200",
            "400",
            "401",
            "413",
            "422",
            "429",
            "500",
            "502",
            "503",
            "504",
        ]
        for status_code in expected_status_codes:
            assert status_code in extract_responses, (
                f"Status code {status_code} missing from /v1/extract OpenAPI responses"
            )


class TestDocumentationExamplesAndSchemas:
    """Validate documentation examples against actual Pydantic schema contracts."""

    def test_openapi_synthetic_extraction_example_validates(self):
        """Verify OpenAPI synthetic example validates as ExtractionResponse."""
        schema = json.loads(_OPENAPI_PATH.read_text(encoding="utf-8"))
        extraction_schema = schema["components"]["schemas"]["ExtractionResponse"]
        example = extraction_schema.get("example")

        assert example is not None, (
            "ExtractionResponse must provide a synthetic example."
        )
        # Parse into Pydantic model to confirm 100% contract compliance
        validated = ExtractionResponse.model_validate(example)
        assert validated.status.value == "ok"
        assert validated.data.profile.name == "Jordan Doe"
        assert validated.data.profile.email == "jordan.doe.synthetic@example.com"
        assert validated.meta.provider == "llama-3.3-70b-versatile"

    def test_openapi_synthetic_error_example_validates(self):
        """Verify OpenAPI synthetic example validates as StructuredError."""
        schema = json.loads(_OPENAPI_PATH.read_text(encoding="utf-8"))
        error_schema = schema["components"]["schemas"]["StructuredError"]
        example = error_schema.get("example")

        assert example is not None
        validated = StructuredError.model_validate(example)
        assert validated.code.value == "INVALID_FILE"

    def test_integration_doc_contains_required_sections(self):
        """Verify INTEGRATION.md has all required integration guidance sections."""
        integration_md = (_DOCS_DIR / "INTEGRATION.md").read_text(encoding="utf-8")

        required_sections = [
            "Architecture and Trust Boundaries",
            "Authentication",
            "Request and Response Examples",
            "Timeout and Retry Policy",
            "Partial Results, Confidence, Provenance, and Warnings",
            "Review-Before-Save Workflow",
            "TypeScript Integration Example",
        ]
        for section in required_sections:
            assert section.lower() in integration_md.lower(), (
                f"Missing section '{section}' in docs/INTEGRATION.md"
            )

    def test_runbook_contains_all_operational_topics(self):
        """Verify RUNBOOK.md covers all required routine and diagnostic topics."""
        runbook_md = (_DOCS_DIR / "RUNBOOK.md").read_text(encoding="utf-8")

        required_topics = [
            "Prerequisites and Local Environment Setup",
            "Safe Startup Instructions",
            "Health, Readiness, and Version Probes",
            "Protected Prometheus Metrics",
            "Diagnosing Missing Configuration",
            "Diagnosing Provider Errors",
            "Service API Key Rotation Procedure",
            "Manual Live Provider Check Script",
            "Mock-Only Load and Performance Test",
            "Consented Real-Resume Evaluation Tool",
            "PDF Extraction Backend Comparison Tool",
            "Process-Local Limitations and Multi-Worker Implications",
            "Service Shutdown and Cleanup",
        ]
        for topic in required_topics:
            assert topic.lower() in runbook_md.lower(), (
                f"Missing topic '{topic}' in docs/RUNBOOK.md"
            )

    def test_readiness_checklist_contains_honest_statuses(self):
        """Verify PRODUCTION_READINESS.md contains honest statuses and blockers."""
        readiness_md = (_DOCS_DIR / "PRODUCTION_READINESS.md").read_text(
            encoding="utf-8"
        )

        assert "Done — verified by local code/tests" in readiness_md
        assert "Implemented — operational verification pending" in readiness_md
        assert "Blocked — external decision or action required" in readiness_md
        assert "The service is NOT YET production-ready" in readiness_md
        assert "Gate 1 — Legal Review of PyMuPDF Licensing" in readiness_md
        assert (
            "Gate 2 — Enterprise Provider Terms & Zero-Data-Retention Agreements"
            in readiness_md
        )


class TestDocumentationPrivacyAndCredentialAbsence:
    """Ensure zero real credentials or real PII appear in documentation."""

    _REAL_KEY_PATTERN = re.compile(r"\b(?:gsk_|nvapi-|sk-)[A-Za-z0-9_-]{20,}\b")
    _REAL_EMAIL_PATTERN = re.compile(
        r"\b[A-Za-z0-9._%+-]+@(?!example\.com|example\.org)[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
    )

    def test_no_real_secrets_in_docs(self):
        """Scan all documentation files to guarantee no real API keys were committed."""
        docs = list(_DOCS_DIR.glob("*.md")) + [_OPENAPI_PATH]
        assert len(docs) >= 6

        for doc_path in docs:
            text = doc_path.read_text(encoding="utf-8")
            matches = self._REAL_KEY_PATTERN.findall(text)
            assert not matches, (
                f"Potential real credential found in '{doc_path.name}': {matches}"
            )

    def test_all_emails_in_docs_use_example_domain(self):
        """Verify sample emails in documentation use example.com/example.org."""
        docs = list(_DOCS_DIR.glob("*.md")) + [_OPENAPI_PATH]

        for doc_path in docs:
            text = doc_path.read_text(encoding="utf-8")
            matches = self._REAL_EMAIL_PATTERN.findall(text)
            assert not matches, (
                f"Non-synthetic email address found in '{doc_path.name}': {matches}"
            )


class TestExportScript:
    """Test CLI script functionality for exporting OpenAPI spec."""

    def test_export_script_produces_identical_file(self, tmp_path):
        """Verify generate_openapi_json output matches docs/openapi.json."""
        out_file = tmp_path / "test_openapi.json"
        generate_openapi_json(out_file)

        assert out_file.is_file()
        expected = _OPENAPI_PATH.read_text(encoding="utf-8")
        actual = out_file.read_text(encoding="utf-8")
        assert actual == expected
