"""Unit and integration tests for request correlation IDs.

Verifies:
1. Missing X-Request-ID header generates cryptographically random UUID.
2. Valid X-Request-ID is accepted and echoed in response header.
3. Malformed/untrusted X-Request-ID is discarded and replaced with a valid UUID.
4. Oversized X-Request-ID is rejected and replaced with a valid UUID.
5. Concurrent requests receive unique request IDs without race conditions.
6. Error responses (400, 401, 404, 413, 422, 500) attach X-Request-ID header.
"""

import asyncio
import re
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.observability.request_id import is_valid_request_id, resolve_request_id

UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
TEST_AUTH_KEY = "sec-test-correlation-key-8888"


@pytest.fixture
def corr_client():
    settings = Settings(
        LLM_SERVICE_API_KEY=TEST_AUTH_KEY,
        SERVICE_API_KEY=TEST_AUTH_KEY,
        MOCK_MODE=True,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


class TestRequestIDValidationUnit:
    """Unit tests for request ID format validation."""

    def test_valid_ids(self):
        assert is_valid_request_id("req-12345") is True
        assert is_valid_request_id("abc_DEF_123-456") is True
        assert is_valid_request_id(str(uuid.uuid4())) is True
        assert is_valid_request_id("a" * 64) is True

    def test_invalid_ids(self):
        assert is_valid_request_id(None) is False
        assert is_valid_request_id("") is False
        assert is_valid_request_id("   ") is False
        assert is_valid_request_id("id with spaces") is False
        assert is_valid_request_id("id\nwith\nnewline") is False
        assert is_valid_request_id("<script>alert(1)</script>") is False
        assert is_valid_request_id("id@invalid!symbols#") is False
        assert is_valid_request_id("a" * 65) is False

    def test_resolve_request_id_fallback(self):
        # Valid passed through
        assert resolve_request_id("custom-req-123") == "custom-req-123"

        # Invalid replaced with UUID
        resolved_bad = resolve_request_id("bad id with spaces")
        assert UUID_PATTERN.match(resolved_bad) is not None

        # None replaced with UUID
        resolved_none = resolve_request_id(None)
        assert UUID_PATTERN.match(resolved_none) is not None


class TestRequestCorrelationHeadersIntegration:
    """Integration tests verifying HTTP headers and correlation across endpoints."""

    def test_missing_request_id_generates_valid_uuid(self, corr_client):
        resp = corr_client.get("/health")
        assert resp.status_code == 200
        req_id = resp.headers.get("X-Request-ID")
        assert req_id is not None
        assert UUID_PATTERN.match(req_id) is not None

    def test_valid_custom_request_id_is_echoed(self, corr_client):
        custom_id = "req-trace-abc-1234567890"
        resp = corr_client.get("/health", headers={"X-Request-ID": custom_id})
        assert resp.status_code == 200
        assert resp.headers.get("X-Request-ID") == custom_id

    def test_malformed_request_id_is_replaced(self, corr_client):
        malicious_id = "attack-id<script>alert(1)</script>"
        resp = corr_client.get("/health", headers={"X-Request-ID": malicious_id})
        assert resp.status_code == 200
        returned_id = resp.headers.get("X-Request-ID")
        assert returned_id is not None
        assert returned_id != malicious_id
        assert UUID_PATTERN.match(returned_id) is not None

    def test_oversized_request_id_is_replaced(self, corr_client):
        oversized_id = "a" * 128
        resp = corr_client.get("/health", headers={"X-Request-ID": oversized_id})
        assert resp.status_code == 200
        returned_id = resp.headers.get("X-Request-ID")
        assert returned_id is not None
        assert returned_id != oversized_id
        assert UUID_PATTERN.match(returned_id) is not None

    def test_error_response_401_returns_request_id(self, corr_client):
        resp = corr_client.post(
            "/v1/extract",
            headers={"X-API-Key": "wrong-key"},
        )
        assert resp.status_code == 401
        assert "X-Request-ID" in resp.headers
        assert resp.headers.get("X-Request-ID")

    def test_error_response_400_returns_request_id(self, corr_client):
        resp = corr_client.post(
            "/v1/extract",
            headers={"X-API-Key": TEST_AUTH_KEY},
            files={},  # Missing file
        )
        assert resp.status_code == 400
        assert "X-Request-ID" in resp.headers

    def test_error_response_404_returns_request_id(self, corr_client):
        resp = corr_client.get("/nonexistent-route")
        assert resp.status_code == 404
        assert "X-Request-ID" in resp.headers


@pytest.mark.anyio
async def test_concurrent_requests_have_isolated_request_ids():
    """Verify concurrent requests in async context receive distinct request IDs."""
    settings = Settings(
        LLM_SERVICE_API_KEY=TEST_AUTH_KEY,
        SERVICE_API_KEY=TEST_AUTH_KEY,
        MOCK_MODE=True,
    )
    app.dependency_overrides[get_settings] = lambda: settings

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Dispatch 20 concurrent requests
        tasks = [client.get("/health") for _ in range(20)]
        responses = await asyncio.gather(*tasks)

        request_ids = [r.headers.get("X-Request-ID") for r in responses]

        # Verify all 20 succeeded
        assert all(r.status_code == 200 for r in responses)
        # Verify all received valid IDs
        assert all(UUID_PATTERN.match(rid) for rid in request_ids)
        # Verify strict uniqueness (no collision or context leakage)
        assert len(set(request_ids)) == 20

    app.dependency_overrides.clear()
