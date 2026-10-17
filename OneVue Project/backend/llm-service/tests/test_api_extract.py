"""API tests for POST /v1/extract endpoint and pipeline orchestration.

All tests operate offline with synthetic PDF fixtures, mocked providers,
and TestClient. Zero live network or provider calls are permitted.
"""

import logging
from unittest.mock import AsyncMock

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.api.routes import get_provider
from app.config import Settings, get_settings
from app.main import app
from app.orchestration.mock import DEFAULT_MOCK_DRAFT, MockProvider
from app.providers.base import (
    LLMProvider,
    ProviderAuthError,
    ProviderMalformedOutputError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from app.schemas.errors import ErrorCode, WarningCode

VALID_API_KEY = "test-secret-api-key-12345"
AUTH_HEADERS = {"X-API-Key": VALID_API_KEY}


# ---------------------------------------------------------------------------
# Synthetic PDF Generators
# ---------------------------------------------------------------------------


def make_pdf(
    text: str = "Jane Doe\nSenior Backend Engineer\nSan Francisco, CA",
) -> bytes:
    """Create in-memory synthetic PDF with extractable text."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 72), text, fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def make_scanned_pdf() -> bytes:
    """Create in-memory PDF without extractable text layer."""
    doc = pymupdf.open()
    doc.new_page(width=595, height=842)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def make_encrypted_pdf(password: str = "pass123") -> bytes:
    """Create in-memory password-protected encrypted PDF."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 72), "Confidential Resume", fontsize=12)
    pdf_bytes = doc.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw=password,
        owner_pw="adminpass",
    )
    doc.close()
    return pdf_bytes


def make_multipage_pdf(page_count: int) -> bytes:
    """Create in-memory PDF with specified number of pages."""
    doc = pymupdf.open()
    for idx in range(page_count):
        page = doc.new_page(width=595, height=842)
        page.insert_text((50, 72), f"Page {idx + 1} content", fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


# ---------------------------------------------------------------------------
# Test Fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    """Test client configured with valid test API key and mock mode enabled."""
    settings = Settings(
        LLM_SERVICE_API_KEY=VALID_API_KEY,
        SERVICE_API_KEY=VALID_API_KEY,
        MOCK_MODE=True,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_provider] = lambda: MockProvider()

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 1. Authentication Tests
# ---------------------------------------------------------------------------


class TestAuthentication:
    """Verify API-key authentication rules and fail-closed behavior."""

    def test_missing_api_key_header_returns_401(self, client):
        pdf_bytes = make_pdf()
        response = client.post(
            "/v1/extract",
            files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
        )
        assert response.status_code == 401
        data = response.json()
        assert data["code"] == ErrorCode.UNAUTHORIZED
        assert "Missing or invalid API key" in data["message"]

    def test_invalid_api_key_returns_401(self, client):
        pdf_bytes = make_pdf()
        response = client.post(
            "/v1/extract",
            headers={"X-API-Key": "incorrect-api-key"},
            files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
        )
        assert response.status_code == 401
        data = response.json()
        assert data["code"] == ErrorCode.UNAUTHORIZED

    def test_fails_closed_when_api_key_unconfigured(self):
        # Service configured with empty API key
        unconfigured_settings = Settings(
            LLM_SERVICE_API_KEY="",
            SERVICE_API_KEY="",
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: unconfigured_settings

        with TestClient(app) as local_client:
            pdf_bytes = make_pdf()
            response = local_client.post(
                "/v1/extract",
                headers={"X-API-Key": "any-key"},
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 401
            data = response.json()
            assert data["code"] == ErrorCode.UNAUTHORIZED
            assert "unconfigured" in data["message"]

        app.dependency_overrides.clear()

    def test_health_and_root_remain_unauthenticated(self, client):
        # Health check must not require X-API-Key
        health_resp = client.get("/health")
        assert health_resp.status_code == 200
        assert health_resp.json()["status"] == "ok"

        root_resp = client.get("/")
        assert root_resp.status_code == 200


# ---------------------------------------------------------------------------
# 2. Upload Validation Tests
# ---------------------------------------------------------------------------


class TestUploadValidation:
    """Verify validation of file existence, types, encryption, and limits."""

    def test_missing_upload_payload_returns_400(self, client):
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            data={},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["code"] == ErrorCode.INVALID_FILE

    def test_empty_uploaded_file_returns_400(self, client):
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            files={"file": ("resume.pdf", b"", "application/pdf")},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["code"] == ErrorCode.INVALID_FILE
        assert "empty" in data["message"].lower()

    def test_non_pdf_file_rejected_as_invalid_file(self, client):
        text_content = b"This is plain text and not a valid PDF file."
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            files={"file": ("resume.pdf", text_content, "application/pdf")},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["code"] == ErrorCode.INVALID_FILE

    def test_corrupt_malformed_pdf_returns_400(self, client):
        malformed = b"%PDF-1.4\ncorrupted-random-binary-content-without-catalog"
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            files={"file": ("resume.pdf", malformed, "application/pdf")},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["code"] == ErrorCode.INVALID_FILE

    def test_encrypted_pdf_returns_422(self, client):
        enc_pdf = make_encrypted_pdf("secretpass")
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            files={"file": ("resume.pdf", enc_pdf, "application/pdf")},
        )
        assert response.status_code == 422
        data = response.json()
        assert data["code"] == ErrorCode.ENCRYPTED_PDF

    def test_scanned_pdf_without_text_returns_422(self, client):
        scanned_pdf = make_scanned_pdf()
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            files={"file": ("resume.pdf", scanned_pdf, "application/pdf")},
        )
        assert response.status_code == 422
        data = response.json()
        assert data["code"] == ErrorCode.SCANNED_PDF

    def test_page_limit_exceeded_returns_422(self, client):
        # Exceeds default limit of 10 pages
        large_page_pdf = make_multipage_pdf(11)
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            files={"file": ("resume.pdf", large_page_pdf, "application/pdf")},
        )
        assert response.status_code == 422
        data = response.json()
        assert data["code"] == ErrorCode.TOO_MANY_PAGES

    def test_file_size_limit_exceeded_returns_413(self):
        # Configure a small 100 KB limit for test
        small_limit_settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            SERVICE_API_KEY=VALID_API_KEY,
            PDF_MAX_FILE_SIZE_BYTES=100 * 1024,
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: small_limit_settings

        with TestClient(app) as local_client:
            # Send 150 KB
            large_content = b"%PDF-" + b"0" * (150 * 1024)
            response = local_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", large_content, "application/pdf")},
            )
            assert response.status_code == 413
            data = response.json()
            assert data["code"] == ErrorCode.FILE_TOO_LARGE

        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 3. Successful Extraction & Metadata Tests
# ---------------------------------------------------------------------------


class TestSuccessfulExtraction:
    """Verify complete extraction response structure and metadata in mock mode."""

    def test_successful_mock_extraction_complete_metadata(self, client):
        pdf_bytes = make_pdf(
            "Jane Doe\n"
            "Senior Backend Engineer\n"
            "San Francisco, CA\n"
            "jane.doe@example.com\n"
            "+1 (415) 555-0199\n"
            "https://linkedin.com/in/janedoe\n"
            "https://github.com/janedoe"
        )
        response = client.post(
            "/v1/extract",
            headers=AUTH_HEADERS,
            files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
        )
        assert response.status_code == 200
        data = response.json()

        # Outcome status
        assert data["status"] in ("ok", "partial")

        # Resume profile data
        profile = data["data"]["profile"]
        assert profile["name"] == "Jane Doe"
        assert profile["email"] == "jane.doe@example.com"

        # Field metadata & grounding
        field_meta = data["fieldMeta"]
        assert "profile.name" in field_meta
        assert field_meta["profile.name"]["confidence"] in ("high", "medium")
        assert field_meta["profile.name"]["grounding_status"] == "grounded"

        # Telemetry metadata
        meta = data["meta"]
        assert meta["schemaVersion"] == "1.0.0"
        assert meta["provider"] == "mock"
        assert meta["mock"] is True
        assert meta["latencyMs"] >= 0

        # Warnings include MOCK_DATA
        warning_codes = [w["code"] for w in data["warnings"]]
        assert WarningCode.MOCK_DATA in warning_codes

    def test_mock_mode_makes_zero_network_calls(self, monkeypatch):
        # Monkeypatch httpx to fail if any external call is attempted
        def fail_on_network(*args, **kwargs):
            raise AssertionError("Network operation attempted in mock mode!")

        monkeypatch.setattr("httpx.AsyncClient.send", fail_on_network)

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: MockProvider()

        with TestClient(app) as test_client:
            pdf_bytes = make_pdf("Jane Doe\nSan Francisco, CA")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 200

        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 4. Partial Results, Bounded Repair, and Provider Errors
# ---------------------------------------------------------------------------


class TestPartialResultsAndErrors:
    """Verify partial outcomes, single repair attempt, and provider error handling."""

    def test_partial_result_with_validation_warnings(self):
        # Create draft with ambiguous date that normalizes to null with warning
        draft = DEFAULT_MOCK_DRAFT.model_copy(deep=True)
        draft.education[0].startDate = "Fall 2023"

        provider = MockProvider(draft=draft)
        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: provider

        with TestClient(app) as test_client:
            pdf_bytes = make_pdf("Jane Doe\nUniversity of California, Berkeley")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 200
            data = response.json()
            # Ambiguous date normalized to null with AMBIGUOUS_DATE warning
            assert data["data"]["education"][0]["startDate"] is None
            warning_codes = [w["code"] for w in data["warnings"]]
            assert WarningCode.AMBIGUOUS_DATE in warning_codes

        app.dependency_overrides.clear()

    def test_exactly_one_repair_attempt_when_eligible(self):
        # Create draft with date ordering violation: endDate < startDate
        invalid_draft = DEFAULT_MOCK_DRAFT.model_copy(deep=True)
        invalid_draft.education[0].startDate = "2022"
        invalid_draft.education[0].endDate = "2018"

        mock_provider = MockProvider(draft=invalid_draft)
        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: mock_provider

        with TestClient(app) as test_client:
            pdf_bytes = make_pdf("Jane Doe\nUC Berkeley")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 200
            # Exactly one repair call was performed
            assert mock_provider.repair_call_count == 1

        app.dependency_overrides.clear()

    @pytest.mark.parametrize(
        ("exception_cls", "expected_status", "expected_code"),
        [
            (ProviderAuthError, 502, ErrorCode.PROVIDER_AUTH),
            (ProviderRateLimitError, 429, ErrorCode.PROVIDER_RATE_LIMITED),
            (ProviderTimeoutError, 503, ErrorCode.PROVIDER_UNAVAILABLE),
            (ProviderUnavailableError, 503, ErrorCode.PROVIDER_UNAVAILABLE),
            (ProviderMalformedOutputError, 502, ErrorCode.INVALID_OUTPUT),
        ],
    )
    def test_provider_errors_mapped_to_consistent_http_status(
        self, exception_cls, expected_status, expected_code
    ):
        mock_provider = AsyncMock(spec=LLMProvider)
        mock_provider.model = "groq-test"
        mock_provider.extract.side_effect = exception_cls()

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: mock_provider

        with TestClient(app) as test_client:
            pdf_bytes = make_pdf("Jane Doe")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == expected_status
            data = response.json()
            assert data["code"] == expected_code

        app.dependency_overrides.clear()

    def test_real_mode_does_not_silently_fallback_to_mock(self):
        # When MOCK_MODE is False and provider fails, must NOT return mock data
        mock_provider = AsyncMock(spec=LLMProvider)
        mock_provider.model = "groq-test"
        mock_provider.extract.side_effect = ProviderAuthError("Auth failed")

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: mock_provider

        with TestClient(app) as test_client:
            pdf_bytes = make_pdf("Jane Doe")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 502
            data = response.json()
            assert data["code"] == ErrorCode.PROVIDER_AUTH
            # Must not contain mock data
            assert "data" not in data

        app.dependency_overrides.clear()

    def test_unexpected_error_returns_sanitized_500(self):
        mock_provider = AsyncMock(spec=LLMProvider)
        mock_provider.model = "groq-test"
        mock_provider.extract.side_effect = RuntimeError("Catastrophic disk corruption")

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: mock_provider

        with TestClient(app) as test_client:
            pdf_bytes = make_pdf("Jane Doe")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 500
            data = response.json()
            assert data["code"] == ErrorCode.INTERNAL
            # Error message must be generic and not leak internal exception details
            assert "Catastrophic" not in data["message"]

        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 5. Privacy and Security Tests
# ---------------------------------------------------------------------------


class TestPrivacyAndSanitization:
    """Ensure no API keys, personal data, or raw prompts leak in logs or responses."""

    def test_no_keys_or_resume_text_in_logs_or_errors(self, caplog):
        secret_key = "gsk_super_secret_internal_key_value_12345"
        settings = Settings(
            LLM_SERVICE_API_KEY=secret_key,
            SERVICE_API_KEY=secret_key,
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: MockProvider()

        with caplog.at_level(logging.DEBUG):
            with TestClient(app) as test_client:
                pdf_bytes = make_pdf("Confidential Candidate John Doe")
                response = test_client.post(
                    "/v1/extract",
                    headers={"X-API-Key": secret_key},
                    files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
                )
                assert response.status_code == 200

        log_text = caplog.text
        # Assert secret key never appears in logs
        assert secret_key not in log_text
        # Assert candidate sensitive strings not in logs
        assert "Confidential Candidate" not in log_text

        app.dependency_overrides.clear()
