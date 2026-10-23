"""Unit and integration tests for protected Prometheus metrics endpoint.

Verifies:
1. /metrics is disabled (returns 404) when METRICS_TOKEN is unset.
2. /metrics requires authentication with METRICS_TOKEN; rejects bad tokens (401).
3. Service API key is NOT implicitly accepted as METRICS_TOKEN.
4. Both Bearer token and X-Metrics-Token headers are supported.
5. Standard Prometheus exposition format 0.0.4.
6. Accounting for requests, extractions, provider calls, fallbacks, and rate limits.
7. Low-cardinality enforcement: zero unbounded labels.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.observability.metrics import (
    get_metrics_text,
    record_extraction_request,
    record_http_request,
    record_provider_call,
    record_provider_failure,
    record_provider_fallback,
    record_provider_timeout,
    record_rate_limit_rejection,
    reset_metrics,
)

METRICS_TOKEN_VAL = "metrics-secret-token-val-987654"
SERVICE_KEY_VAL = "service-regular-api-key-12345"


@pytest.fixture(autouse=True)
def clean_metrics_state():
    reset_metrics()
    yield
    reset_metrics()


class TestMetricsSecurityAndAuthentication:
    """Verify endpoint disablement and token-based protection."""

    def test_metrics_disabled_when_token_unset(self):
        settings = Settings(
            METRICS_TOKEN="",  # Unset
            LLM_SERVICE_API_KEY=SERVICE_KEY_VAL,
            SERVICE_API_KEY=SERVICE_KEY_VAL,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/metrics")
            assert resp.status_code == 404
            data = resp.json()
            assert "Metrics endpoint is disabled" in data["message"]
        app.dependency_overrides.clear()

    def test_metrics_rejects_missing_token_when_enabled(self):
        settings = Settings(
            METRICS_TOKEN=METRICS_TOKEN_VAL,
            LLM_SERVICE_API_KEY=SERVICE_KEY_VAL,
            SERVICE_API_KEY=SERVICE_KEY_VAL,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/metrics")
            assert resp.status_code == 401
        app.dependency_overrides.clear()

    def test_metrics_rejects_invalid_token(self):
        settings = Settings(
            METRICS_TOKEN=METRICS_TOKEN_VAL,
            LLM_SERVICE_API_KEY=SERVICE_KEY_VAL,
            SERVICE_API_KEY=SERVICE_KEY_VAL,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get(
                "/metrics",
                headers={"Authorization": "Bearer wrong-token-123"},
            )
            assert resp.status_code == 401
        app.dependency_overrides.clear()

    def test_metrics_does_not_implicitly_accept_service_api_key(self):
        settings = Settings(
            METRICS_TOKEN=METRICS_TOKEN_VAL,
            LLM_SERVICE_API_KEY=SERVICE_KEY_VAL,
            SERVICE_API_KEY=SERVICE_KEY_VAL,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get(
                "/metrics",
                headers={"Authorization": f"Bearer {SERVICE_KEY_VAL}"},
            )
            assert resp.status_code == 401
        app.dependency_overrides.clear()

    def test_metrics_accepts_valid_bearer_token(self):
        settings = Settings(
            METRICS_TOKEN=METRICS_TOKEN_VAL,
            LLM_SERVICE_API_KEY=SERVICE_KEY_VAL,
            SERVICE_API_KEY=SERVICE_KEY_VAL,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get(
                "/metrics",
                headers={"Authorization": f"Bearer {METRICS_TOKEN_VAL}"},
            )
            assert resp.status_code == 200
            assert "text/plain" in resp.headers["content-type"]
            assert "# HELP http_requests_total" in resp.text
        app.dependency_overrides.clear()

    def test_metrics_accepts_valid_x_metrics_token_header(self):
        settings = Settings(
            METRICS_TOKEN=METRICS_TOKEN_VAL,
            LLM_SERVICE_API_KEY=SERVICE_KEY_VAL,
            SERVICE_API_KEY=SERVICE_KEY_VAL,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get(
                "/metrics",
                headers={"X-Metrics-Token": METRICS_TOKEN_VAL},
            )
            assert resp.status_code == 200
            assert "# HELP http_requests_total" in resp.text
        app.dependency_overrides.clear()


class TestMetricsExpositionAndAccounting:
    """Verify Prometheus text format and accurate counting."""

    def test_http_request_accounting_and_histogram(self):
        record_http_request("/health", "GET", 200, 0.045)
        record_http_request("/health", "GET", 200, 0.080)
        record_http_request("/v1/extract", "POST", 401, 0.015)

        text = get_metrics_text()
        assert (
            'http_requests_total{method="GET",route="/health",status_class="2xx"} 2'
            in text
        )
        expected_post = (
            'http_requests_total{method="POST",'
            'route="/v1/extract",status_class="4xx"} 1'
        )
        assert expected_post in text
        assert (
            'http_request_duration_seconds_count{method="GET",route="/health"} 2'
            in text
        )
        expected_bucket = (
            'http_request_duration_seconds_bucket{le="0.05",'
            'method="GET",route="/health"} 1'
        )
        assert expected_bucket in text

    def test_extraction_and_provider_accounting(self):
        record_extraction_request("success", "none")
        record_extraction_request("failure", "INVALID_FILE")
        record_provider_call("groq", "extract")
        record_provider_failure("groq", "timeout")
        record_provider_timeout("groq")
        record_provider_fallback("groq", "nvidia")
        record_provider_call("nvidia", "extract")
        record_rate_limit_rejection("process_local")

        text = get_metrics_text()
        assert 'extraction_requests_total{error_code="none",status="success"} 1' in text
        assert (
            'extraction_requests_total{error_code="INVALID_FILE",status="failure"} 1'
            in text
        )
        assert 'provider_calls_total{call_type="extract",provider="groq"} 1' in text
        assert (
            'provider_failures_total{error_category="timeout",provider="groq"} 1'
            in text
        )
        assert 'provider_timeouts_total{provider="groq"} 1' in text
        assert 'provider_fallbacks_total{fallback="nvidia",primary="groq"} 1' in text
        assert 'provider_calls_total{call_type="extract",provider="nvidia"} 1' in text
        assert 'rate_limit_rejections_total{guard="process_local"} 1' in text

    def test_low_cardinality_enforcement(self):
        # Arbitrary routes or methods are normalized to 'other'
        record_http_request(
            "/user/123/sensitive-endpoint?token=abc", "CUSTOM_METHOD", 200, 0.1
        )
        text = get_metrics_text()
        assert 'route="other"' in text
        assert 'method="other"' in text
        assert "sensitive-endpoint" not in text
        assert "token=abc" not in text

    def test_resilience_to_internal_failure(self):
        # Even with weird arguments, recorder does not raise
        record_http_request(None, None, 99999, -5.0)  # type: ignore
        record_provider_failure(None, None)  # type: ignore
