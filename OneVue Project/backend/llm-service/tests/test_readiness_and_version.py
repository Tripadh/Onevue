"""Unit and integration tests for /health, /ready, and /version endpoints.

Verifies:
1. /health liveness check is preserved and returns operational status.
2. /ready readiness check distinguishes configured vs unconfigured states (200 vs 503).
3. /ready makes zero live provider calls and exposes zero secrets.
4. /version returns version and runtime metadata, handling absent commit SHA safely.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app

VALID_KEY = "test-service-key-phase14"


@pytest.fixture
def client_ready():
    settings = Settings(
        LLM_SERVICE_API_KEY=VALID_KEY,
        SERVICE_API_KEY=VALID_KEY,
        MOCK_MODE=True,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


class TestHealthEndpointPreserved:
    """Verify GET /health remains lightweight and intact."""

    def test_health_returns_200_ok(self, client_ready):
        resp = client_ready.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "onevue-llm-service"
        assert data["version"] == "1.0.0"

    def test_health_does_not_call_external_services(self, client_ready):
        with (
            patch("groq.AsyncGroq") as mock_groq,
            patch("httpx.AsyncClient") as mock_http,
        ):
            resp = client_ready.get("/health")
            assert resp.status_code == 200
            assert mock_groq.call_count == 0
            assert mock_http.call_count == 0


class TestReadinessEndpoint:
    """Verify GET /ready readiness check behavior in different states."""

    def test_ready_in_configured_mock_mode(self):
        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_KEY,
            SERVICE_API_KEY=VALID_KEY,
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/ready")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ready"
            assert data["ready"] is True
            assert data["service"] == "onevue-llm-service"
            assert data["checks"]["configuration"] == "ok"
            assert data["checks"]["provider"] == "ok"
        app.dependency_overrides.clear()

    def test_ready_in_configured_real_mode_with_groq_key(self):
        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_KEY,
            SERVICE_API_KEY=VALID_KEY,
            MOCK_MODE=False,
            GROQ_API_KEY="gsk_valid_configured_test_key",
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/ready")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ready"
            assert data["ready"] is True
            assert data["checks"]["configuration"] == "ok"
            assert data["checks"]["provider"] == "ok"
        app.dependency_overrides.clear()

    def test_ready_returns_503_when_service_key_missing(self):
        settings = Settings(
            LLM_SERVICE_API_KEY="",
            SERVICE_API_KEY="",
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/ready")
            assert resp.status_code == 503
            data = resp.json()
            assert data["status"] == "unavailable"
            assert data["ready"] is False
            assert data["checks"]["configuration"] == "missing_service_key"
        app.dependency_overrides.clear()

    def test_ready_returns_503_when_provider_key_missing_in_real_mode(self):
        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_KEY,
            SERVICE_API_KEY=VALID_KEY,
            MOCK_MODE=False,
            GROQ_API_KEY="",  # Missing in real mode
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/ready")
            assert resp.status_code == 503
            data = resp.json()
            assert data["status"] == "unavailable"
            assert data["ready"] is False
            assert data["checks"]["provider"] == "missing_provider_credentials"
        app.dependency_overrides.clear()

    def test_ready_never_leaks_secrets_or_env_values(self):
        canary = "gsk_canary_super_secret_never_leak_998877"
        settings = Settings(
            LLM_SERVICE_API_KEY=VALID_KEY,
            SERVICE_API_KEY=VALID_KEY,
            MOCK_MODE=False,
            GROQ_API_KEY=canary,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/ready")
            assert canary not in resp.text
            forbidden_substrings = ["gsk_", "secret", "password", "key="]
            for forbidden in forbidden_substrings:
                assert forbidden not in resp.text.lower()
        app.dependency_overrides.clear()


class TestVersionEndpoint:
    """Verify GET /version metadata reporting."""

    def test_version_without_commit_sha_returns_null(self):
        settings = Settings(
            GIT_COMMIT_SHA=None,
            ENVIRONMENT="test-env",
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/version")
            assert resp.status_code == 200
            data = resp.json()
            assert data["service"] == "onevue-llm-service"
            assert data["version"] == "1.0.0"
            assert data["commit_sha"] is None
            assert data["environment"] == "test-env"
        app.dependency_overrides.clear()

    def test_version_with_configured_commit_sha(self):
        sample_sha = "e4d909c290d0fb1ca068ffaddf22cbd0add92ea3"
        settings = Settings(
            GIT_COMMIT_SHA=sample_sha,
            ENVIRONMENT="production",
        )
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app) as client:
            resp = client.get("/version")
            assert resp.status_code == 200
            data = resp.json()
            assert data["commit_sha"] == sample_sha
            assert data["environment"] == "production"
        app.dependency_overrides.clear()

    def test_version_does_not_execute_subprocess_git(self):
        with patch("subprocess.run") as mock_sub:
            settings = Settings()
            app.dependency_overrides[get_settings] = lambda: settings
            with TestClient(app) as client:
                resp = client.get("/version")
                assert resp.status_code == 200
                assert mock_sub.call_count == 0
            app.dependency_overrides.clear()
