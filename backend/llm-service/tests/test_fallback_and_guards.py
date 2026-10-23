"""Unit and integration tests for fallback policy, call guards, and telemetry.

All tests execute offline with mocked providers and zero live network calls.
"""

import socket
from typing import Any
from unittest.mock import AsyncMock, patch

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.api.routes import get_fallback_provider, get_provider
from app.config import Settings, get_settings
from app.main import app
from app.orchestration.fallback import (
    execute_draft_extraction,
    is_fallback_eligible,
)
from app.orchestration.guards import (
    ProcessLocalRateGuard,
    RequestCallGuard,
)
from app.orchestration.mock import DEFAULT_MOCK_DRAFT
from app.orchestration.pipeline import run_extraction_pipeline
from app.providers.base import (
    LLMProvider,
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderMalformedOutputError,
    ProviderRateLimitError,
    ProviderResult,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from app.schemas.errors import ErrorCode
from app.schemas.llm_draft import ResumeDraft

VALID_API_KEY = "test-service-key-phase10"
AUTH_HEADERS = {"X-API-Key": VALID_API_KEY}


def make_test_pdf(text: str = "Alice Smith\nSan Francisco, CA") -> bytes:
    """Generate in-memory PDF fixture."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((50, 72), text, fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def make_mock_provider(
    name: str = "groq",
    model: str = "llama-3.3-70b-versatile",
    draft: ResumeDraft | None = None,
    extract_exc: Exception | None = None,
    repair_exc: Exception | None = None,
) -> AsyncMock:
    """Create a mock LLMProvider with specific behaviors."""
    provider = AsyncMock(spec=LLMProvider)
    provider.name = name
    provider.model = model

    active_draft = draft or DEFAULT_MOCK_DRAFT.model_copy(deep=True)
    if extract_exc:
        provider.extract = AsyncMock(side_effect=extract_exc)
    else:
        provider.extract = AsyncMock(
            return_value=ProviderResult(
                draft=active_draft,
                provider=name,
                model=model,
                latency_ms=10,
            )
        )

    if repair_exc:
        provider.repair = AsyncMock(side_effect=repair_exc)
    else:
        provider.repair = AsyncMock(
            return_value=ProviderResult(
                draft=active_draft,
                provider=name,
                model=model,
                latency_ms=10,
            )
        )

    provider.close = AsyncMock()
    return provider


# ---------------------------------------------------------------------------
# 1. Fallback Eligibility Policy Tests
# ---------------------------------------------------------------------------


class TestFallbackEligibilityPolicy:
    """Test the exact eligibility rules for fallback activation."""

    @pytest.mark.parametrize(
        "exc",
        [
            ProviderTimeoutError("Connection timed out."),
            ProviderUnavailableError("503 Service Unavailable."),
            ProviderRateLimitError("429 Rate Limit exceeded."),
        ],
    )
    def test_eligible_errors(self, exc: Exception) -> None:
        """Verify transient network and upstream outages are eligible."""
        assert is_fallback_eligible(exc) is True

    @pytest.mark.parametrize(
        "exc",
        [
            ProviderAuthError("Invalid API Key."),
            ProviderInvalidRequestError("Bad request."),
            ProviderMalformedOutputError("Unparseable output."),
            ValueError("Unexpected local error."),
            Exception("Generic failure."),
        ],
    )
    def test_ineligible_errors(self, exc: Exception) -> None:
        """Verify non-transient, credential, and client errors are ineligible."""
        assert is_fallback_eligible(exc) is False


# ---------------------------------------------------------------------------
# 2. Fallback Orchestration Scenarios
# ---------------------------------------------------------------------------


class TestFallbackOrchestration:
    """Verify fallback execution with mocked primary and fallback providers."""

    @pytest.mark.anyio
    async def test_groq_success_without_fallback(self) -> None:
        """Primary succeeds immediately; fallback is never invoked."""
        primary = make_mock_provider(name="groq", model="llama-3.3-70b-versatile")
        fallback = make_mock_provider(
            name="nvidia", model="meta/llama-3.3-70b-instruct"
        )

        guard = RequestCallGuard(max_calls=4)
        res = await execute_draft_extraction(
            text="Resume text",
            primary_provider=primary,
            fallback_provider=fallback,
            call_guard=guard,
        )

        assert res.fallback_used is False
        assert res.fallback_attempted is False
        assert res.active_provider == primary
        assert res.attempts_count == 1
        primary.extract.assert_awaited_once()
        fallback.extract.assert_not_awaited()

    @pytest.mark.anyio
    async def test_groq_timeout_followed_by_nvidia_success(self) -> None:
        """Primary times out; fallback is invoked and succeeds."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderTimeoutError("Groq request timed out."),
        )
        fallback = make_mock_provider(
            name="nvidia",
            model="meta/llama-3.3-70b-instruct",
        )

        guard = RequestCallGuard(max_calls=4)
        res = await execute_draft_extraction(
            text="Resume text",
            primary_provider=primary,
            fallback_provider=fallback,
            call_guard=guard,
        )

        assert res.fallback_used is True
        assert res.fallback_attempted is True
        assert res.active_provider == fallback
        assert res.attempts_count == 2
        primary.extract.assert_awaited_once()
        fallback.extract.assert_awaited_once()

    @pytest.mark.anyio
    async def test_groq_temporary_outage_followed_by_nvidia_success(self) -> None:
        """Primary returns 503 unavailable; fallback is invoked and succeeds."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderUnavailableError("Groq 503 outage."),
        )
        fallback = make_mock_provider(name="nvidia")

        guard = RequestCallGuard(max_calls=4)
        res = await execute_draft_extraction(
            text="Resume text",
            primary_provider=primary,
            fallback_provider=fallback,
            call_guard=guard,
        )

        assert res.fallback_used is True
        assert res.attempts_count == 2
        primary.extract.assert_awaited_once()
        fallback.extract.assert_awaited_once()

    @pytest.mark.anyio
    async def test_groq_rate_limit_followed_by_nvidia_success(self) -> None:
        """Primary returns 429 rate limit; fallback is invoked and succeeds."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderRateLimitError("Groq 429 rate limit."),
        )
        fallback = make_mock_provider(name="nvidia")

        guard = RequestCallGuard(max_calls=4)
        res = await execute_draft_extraction(
            text="Resume text",
            primary_provider=primary,
            fallback_provider=fallback,
            call_guard=guard,
        )

        assert res.fallback_used is True
        assert res.attempts_count == 2

    @pytest.mark.anyio
    async def test_groq_auth_failure_without_fallback(self) -> None:
        """Primary has invalid credentials; fallback is NOT called."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderAuthError("GROQ_API_KEY is invalid."),
        )
        fallback = make_mock_provider(name="nvidia")

        guard = RequestCallGuard(max_calls=4)
        with pytest.raises(ProviderAuthError):
            await execute_draft_extraction(
                text="Resume text",
                primary_provider=primary,
                fallback_provider=fallback,
                call_guard=guard,
            )

        fallback.extract.assert_not_awaited()
        assert guard.call_count == 1

    @pytest.mark.anyio
    async def test_invalid_request_without_fallback(self) -> None:
        """Primary rejects request as invalid (400); fallback is NOT called."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderInvalidRequestError("Invalid parameters."),
        )
        fallback = make_mock_provider(name="nvidia")

        guard = RequestCallGuard(max_calls=4)
        with pytest.raises(ProviderInvalidRequestError):
            await execute_draft_extraction(
                text="Resume text",
                primary_provider=primary,
                fallback_provider=fallback,
                call_guard=guard,
            )

        fallback.extract.assert_not_awaited()

    @pytest.mark.anyio
    async def test_malformed_output_without_fallback(self) -> None:
        """Primary output is malformed; fallback is NOT called."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderMalformedOutputError("Invalid JSON draft."),
        )
        fallback = make_mock_provider(name="nvidia")

        guard = RequestCallGuard(max_calls=4)
        with pytest.raises(ProviderMalformedOutputError):
            await execute_draft_extraction(
                text="Resume text",
                primary_provider=primary,
                fallback_provider=fallback,
                call_guard=guard,
            )

        fallback.extract.assert_not_awaited()

    @pytest.mark.anyio
    async def test_both_providers_failing(self) -> None:
        """Primary and fallback fail; raises sanitized ProviderUnavailableError."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderTimeoutError("Groq timeout."),
        )
        fallback = make_mock_provider(
            name="nvidia",
            extract_exc=ProviderUnavailableError("NVIDIA 503."),
        )

        guard = RequestCallGuard(max_calls=4)
        with pytest.raises(ProviderUnavailableError) as exc_info:
            await execute_draft_extraction(
                text="Resume text",
                primary_provider=primary,
                fallback_provider=fallback,
                call_guard=guard,
            )

        assert exc_info.value.code == ErrorCode.PROVIDER_UNAVAILABLE
        assert guard.call_count == 2
        primary.extract.assert_awaited_once()
        fallback.extract.assert_awaited_once()


# ---------------------------------------------------------------------------
# 3. Quota and Call Guard Tests
# ---------------------------------------------------------------------------


class TestQuotaAndCallGuards:
    """Verify request call caps, loop prevention, and process-local rate limiting."""

    def test_maximum_call_attempts_enforced(self) -> None:
        """RequestCallGuard blocks when call attempts reach configured limit."""
        guard = RequestCallGuard(max_calls=3)
        guard.record_attempt("groq")
        guard.record_attempt("groq")
        guard.record_attempt("nvidia")

        assert guard.call_count == 3

        with pytest.raises(ProviderUnavailableError) as exc_info:
            guard.record_attempt("nvidia")

        assert "maximum provider call limit of 3" in exc_info.value.message
        assert exc_info.value.code == ErrorCode.PROVIDER_UNAVAILABLE

    def test_no_fallback_loops_prevented(self) -> None:
        """RequestCallGuard prevents cyclic transitions back to earlier providers."""
        guard = RequestCallGuard(max_calls=5)
        guard.record_attempt("groq")
        guard.record_attempt("nvidia")

        # Attempting to cycle back to groq after transitioning to nvidia is forbidden
        with pytest.raises(ProviderUnavailableError) as exc_info:
            guard.record_attempt("groq")

        assert "Cyclic fallback loop detected" in exc_info.value.message

    def test_same_provider_multiple_retries_allowed_within_budget(self) -> None:
        """Multiple attempts on the SAME provider are permitted within budget."""
        guard = RequestCallGuard(max_calls=3)
        guard.record_attempt("groq")
        guard.record_attempt("groq")  # Retry on same provider
        assert guard.call_count == 2

    def test_guard_rejects_invalid_max_calls(self) -> None:
        """RequestCallGuard requires max_calls >= 1."""
        with pytest.raises(ValueError):
            RequestCallGuard(max_calls=0)

    def test_process_local_rate_guard(self) -> None:
        """ProcessLocalRateGuard limits requests within window and fails closed."""
        rate_guard = ProcessLocalRateGuard(
            max_requests_per_minute=3, window_seconds=60.0
        )
        rate_guard.reset()

        # 3 calls succeed
        rate_guard.acquire()
        rate_guard.acquire()
        rate_guard.acquire()

        # 4th call exceeds limit and fails closed
        with pytest.raises(ProviderRateLimitError) as exc_info:
            rate_guard.acquire()

        assert exc_info.value.code == ErrorCode.PROVIDER_RATE_LIMITED
        assert exc_info.value.retry_after_seconds is not None
        assert exc_info.value.retry_after_seconds > 0

        # After reset, acquires succeed again
        rate_guard.reset()
        rate_guard.acquire()

    def test_guard_state_contains_zero_sensitive_data(self) -> None:
        """Verify guards store only integers and provider identifiers."""
        guard = RequestCallGuard(max_calls=4)
        guard.record_attempt("groq")
        guard.record_attempt("nvidia")

        assert guard.history == ["groq", "nvidia"]
        assert isinstance(guard.call_count, int)
        # Verify no sensitive payload fields exist on the guard object
        assert not hasattr(guard, "api_key")
        assert not hasattr(guard, "prompt")
        assert not hasattr(guard, "resume_text")


# ---------------------------------------------------------------------------
# 4. Pipeline and Telemetry Tests
# ---------------------------------------------------------------------------


class TestPipelineFallbackIntegration:
    """Verify run_extraction_pipeline telemetry and fallback orchestration."""

    @pytest.mark.anyio
    async def test_pipeline_groq_timeout_nvidia_recovers(self) -> None:
        """End-to-end pipeline recovers via NVIDIA when Groq times out."""
        primary = make_mock_provider(
            name="groq",
            model="llama-3.3-70b-versatile",
            extract_exc=ProviderTimeoutError("Groq timeout"),
        )
        fallback = make_mock_provider(
            name="nvidia",
            model="meta/llama-3.3-70b-instruct",
        )

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
            NVIDIA_API_KEY="nvapi-test-key",
        )

        pdf_bytes = make_test_pdf("Alice Smith\nSan Francisco, CA")
        response = await run_extraction_pipeline(
            pdf_bytes=pdf_bytes,
            settings=settings,
            provider=primary,
            fallback_provider=fallback,
        )

        assert response.status.value in ("ok", "partial")
        assert response.meta.fallbackUsed is True
        assert response.meta.provider == "meta/llama-3.3-70b-instruct"
        assert response.meta.primaryProvider == "groq"
        assert response.meta.fallbackProvider == "nvidia"
        assert response.meta.attemptsCount == 2
        assert response.meta.quotaBlocked is False

    @pytest.mark.anyio
    async def test_pipeline_zero_network_calls(self) -> None:
        """Verify pipeline with mocked providers performs zero network socket calls."""

        def guarded_socket(*args: Any, **kwargs: Any) -> socket.socket:
            raise RuntimeError("Outbound socket connection attempted!")

        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderTimeoutError("Groq timeout"),
        )
        fallback = make_mock_provider(name="nvidia")
        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
        )

        pdf_bytes = make_test_pdf("Alice Smith")
        with patch("socket.socket", side_effect=guarded_socket):
            response = await run_extraction_pipeline(
                pdf_bytes=pdf_bytes,
                settings=settings,
                provider=primary,
                fallback_provider=fallback,
            )
            assert response.meta.fallbackUsed is True


# ---------------------------------------------------------------------------
# 5. API /v1/extract Route Integration Tests
# ---------------------------------------------------------------------------


class TestApiRouteFallback:
    """Verify HTTP API endpoint behavior under fallback conditions."""

    def test_api_groq_timeout_nvidia_success(self) -> None:
        """POST /v1/extract falls back to NVIDIA on primary timeout."""
        primary = make_mock_provider(
            name="groq",
            model="llama-3.3-70b-versatile",
            extract_exc=ProviderTimeoutError("Groq timeout"),
        )
        fallback = make_mock_provider(
            name="nvidia",
            model="meta/llama-3.3-70b-instruct",
        )

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
            NVIDIA_API_KEY="nvapi-test-key",
        )

        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: primary
        app.dependency_overrides[get_fallback_provider] = lambda: fallback

        with TestClient(app) as test_client:
            pdf_bytes = make_test_pdf("Alice Smith\nSan Francisco, CA")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["meta"]["fallbackUsed"] is True
            assert data["meta"]["provider"] == "meta/llama-3.3-70b-instruct"

        app.dependency_overrides.clear()

    def test_api_both_providers_fail_returns_503(self) -> None:
        """POST /v1/extract returns HTTP 503 when both primary and fallback fail."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderTimeoutError("Groq timeout"),
        )
        fallback = make_mock_provider(
            name="nvidia",
            extract_exc=ProviderUnavailableError("NVIDIA 503"),
        )

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
            NVIDIA_API_KEY="nvapi-test-key",
        )

        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: primary
        app.dependency_overrides[get_fallback_provider] = lambda: fallback

        with TestClient(app) as test_client:
            pdf_bytes = make_test_pdf("Alice Smith")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 503
            err = response.json()
            assert err["code"] == ErrorCode.PROVIDER_UNAVAILABLE

        app.dependency_overrides.clear()

    def test_api_groq_auth_failure_no_fallback_returns_502(self) -> None:
        """POST /v1/extract returns 502 without fallback on Groq auth failure."""
        primary = make_mock_provider(
            name="groq",
            extract_exc=ProviderAuthError("Invalid Groq API key"),
        )
        fallback = make_mock_provider(name="nvidia")

        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_API_KEY,
            MOCK_MODE=False,
            NVIDIA_API_KEY="nvapi-test-key",
        )

        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_provider] = lambda: primary
        app.dependency_overrides[get_fallback_provider] = lambda: fallback

        with TestClient(app) as test_client:
            pdf_bytes = make_test_pdf("Alice Smith")
            response = test_client.post(
                "/v1/extract",
                headers=AUTH_HEADERS,
                files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
            )
            assert response.status_code == 502
            fallback.extract.assert_not_awaited()

        app.dependency_overrides.clear()
