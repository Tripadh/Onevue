"""Tests for Phase 15 API key rotation and credential separation."""

import logging

import pytest
from fastapi.testclient import TestClient

from app.api.auth import verify_api_key
from app.api.errors import ServiceAPIError
from app.config import Settings, get_settings
from app.main import app


class TestApiKeyRotationConfig:
    """Test Settings API key parsing, precedence, normalization, and bounds."""

    def test_single_key_configuration(self):
        settings = Settings(
            SERVICE_API_KEYS="sec-key-12345",
            METRICS_TOKEN="test-metrics-token",
        )
        assert settings.effective_service_api_keys == ("sec-key-12345",)
        assert settings.effective_service_api_key == "sec-key-12345"

    def test_comma_separated_rotation_keys(self):
        settings = Settings(
            SERVICE_API_KEYS="old-key-alpha, new-key-beta",
            METRICS_TOKEN="test-metrics-token",
        )
        assert settings.effective_service_api_keys == (
            "old-key-alpha",
            "new-key-beta",
        )
        assert settings.effective_service_api_key == "old-key-alpha"

    def test_precedence_service_api_keys_over_legacy(self):
        settings = Settings(
            SERVICE_API_KEYS="rotation-key",
            LLM_SERVICE_API_KEY="legacy-llm-key",
            SERVICE_API_KEY="legacy-service-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert settings.effective_service_api_keys == ("rotation-key",)
        assert settings.effective_service_api_key == "rotation-key"

    def test_precedence_llm_service_api_key_over_service_api_key(self):
        settings = Settings(
            SERVICE_API_KEYS="",
            LLM_SERVICE_API_KEY="legacy-llm-key",
            SERVICE_API_KEY="legacy-service-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert settings.effective_service_api_keys == ("legacy-llm-key",)
        assert settings.effective_service_api_key == "legacy-llm-key"

    def test_whitespace_and_blank_filtering(self):
        settings = Settings(
            SERVICE_API_KEYS="  key-one  ,  ,  key-two  , ",
            METRICS_TOKEN="test-metrics-token",
        )
        assert settings.effective_service_api_keys == ("key-one", "key-two")

    def test_max_keys_limit_enforced(self):
        """Exceeding 10 keys raises ValueError at property access time."""
        eleven_keys = ",".join(f"key-{i}" for i in range(11))
        settings = Settings(
            SERVICE_API_KEYS=eleven_keys,
            METRICS_TOKEN="test-metrics-token",
        )
        # The property raises on access, not on construction
        with pytest.raises(ValueError, match="10 keys"):
            _ = settings.effective_service_api_keys

    def test_key_length_limit_enforced(self):
        """Keys exceeding 512 chars raise ValueError at property access time."""
        oversized_key = "a" * 513
        settings = Settings(
            SERVICE_API_KEYS=oversized_key,
            METRICS_TOKEN="test-metrics-token",
        )
        with pytest.raises(ValueError, match="512"):
            _ = settings.effective_service_api_keys


class TestApiKeyVerificationLogic:
    """Test verify_api_key behavior against active and rotated credentials."""

    @pytest.mark.anyio
    async def test_accepts_any_active_rotation_key(self):
        settings = Settings(
            SERVICE_API_KEYS="key-v1, key-v2",
            METRICS_TOKEN="token-metrics",
        )
        # Both keys must pass without raising
        await verify_api_key(x_api_key="key-v1", settings=settings)
        await verify_api_key(x_api_key="key-v2", settings=settings)

    @pytest.mark.anyio
    async def test_rejects_revoked_key(self):
        settings = Settings(
            SERVICE_API_KEYS="key-v2",  # key-v1 has been revoked
            METRICS_TOKEN="token-metrics",
        )
        with pytest.raises(ServiceAPIError) as exc_info:
            await verify_api_key(x_api_key="key-v1", settings=settings)
        assert exc_info.value.status_code == 401

    @pytest.mark.anyio
    async def test_rejects_blank_or_empty_key(self):
        settings = Settings(
            SERVICE_API_KEYS="key-v1",
            METRICS_TOKEN="token-metrics",
        )
        with pytest.raises(ServiceAPIError) as exc_info:
            await verify_api_key(x_api_key="", settings=settings)
        assert exc_info.value.status_code == 401

        with pytest.raises(ServiceAPIError) as exc_info2:
            await verify_api_key(x_api_key=None, settings=settings)
        assert exc_info2.value.status_code == 401

    @pytest.mark.anyio
    async def test_rejects_oversized_candidate_key(self):
        settings = Settings(
            SERVICE_API_KEYS="key-v1",
            METRICS_TOKEN="token-metrics",
        )
        oversized = "x" * 600
        with pytest.raises(ServiceAPIError) as exc_info:
            await verify_api_key(x_api_key=oversized, settings=settings)
        assert exc_info.value.status_code == 401

    @pytest.mark.anyio
    async def test_metrics_token_rejected_as_service_api_key(self):
        settings = Settings(
            SERVICE_API_KEYS="service-key-valid",
            METRICS_TOKEN="secret-metrics-token",
        )
        with pytest.raises(ServiceAPIError) as exc_info:
            await verify_api_key(
                x_api_key="secret-metrics-token",
                settings=settings,
            )
        assert exc_info.value.status_code == 401

    @pytest.mark.anyio
    async def test_never_logs_api_keys_during_failure(self, caplog):
        settings = Settings(
            SERVICE_API_KEYS="super-secret-valid-key",
            METRICS_TOKEN="secret-metrics-token",
        )
        canary = "unauthorized-candidate-secret-canary"
        with caplog.at_level(logging.DEBUG):
            with pytest.raises(ServiceAPIError):
                await verify_api_key(x_api_key=canary, settings=settings)

        # Neither the valid key nor the submitted candidate may appear in logs
        for record in caplog.records:
            assert "super-secret-valid-key" not in record.message
            assert canary not in record.message


class TestEndpointCredentialSeparation:
    """Test HTTP endpoint behavior for key rotation and credential separation."""

    def test_metrics_endpoint_rejects_service_api_keys(self):
        settings = Settings(
            SERVICE_API_KEYS="service-key-1,service-key-2",
            METRICS_TOKEN="dedicated-metrics-token",
        )
        app.dependency_overrides[get_settings] = lambda: settings
        try:
            client = TestClient(app)
            # Using service key on /metrics must return 401
            resp = client.get(
                "/metrics",
                headers={"Authorization": "Bearer service-key-1"},
            )
            assert resp.status_code == 401

            # Using correct metrics token succeeds
            resp_ok = client.get(
                "/metrics",
                headers={"Authorization": "Bearer dedicated-metrics-token"},
            )
            assert resp_ok.status_code == 200
        finally:
            app.dependency_overrides.clear()

    def test_rotation_window_accepts_both_keys_on_live_app(self):
        settings = Settings(
            SERVICE_API_KEYS="old-key,new-key",
            METRICS_TOKEN="test-metrics-token",
            MOCK_MODE=True,
        )
        app.dependency_overrides[get_settings] = lambda: settings
        try:
            client = TestClient(app)
            pdf_bytes = b"%PDF-1.4 minimal dummy pdf content"

            # Request with old key should not be 401
            r_old = client.post(
                "/v1/extract",
                headers={"X-API-Key": "old-key"},
                files={"file": ("test.pdf", pdf_bytes, "application/pdf")},
            )
            assert r_old.status_code != 401

            # Request with new key should not be 401
            r_new = client.post(
                "/v1/extract",
                headers={"X-API-Key": "new-key"},
                files={"file": ("test.pdf", pdf_bytes, "application/pdf")},
            )
            assert r_new.status_code != 401

            # Request with wrong key should be 401
            r_wrong = client.post(
                "/v1/extract",
                headers={"X-API-Key": "revoked-or-wrong-key"},
                files={"file": ("test.pdf", pdf_bytes, "application/pdf")},
            )
            assert r_wrong.status_code == 401
        finally:
            app.dependency_overrides.clear()
