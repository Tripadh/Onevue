"""Tests for mock-only load and performance testing harness (scripts/load_test.py).

Guarantees:
- Never connects to external networks or live provider APIs.
- Validates loopback-only target URL restriction.
- Validates rejection of production environments.
- Validates rejection of non-mock mode targets.
- Validates concurrency and request bounds.
- Validates latency percentile math and results formatting.
"""

from unittest.mock import AsyncMock

import httpx
import pytest

from scripts.load_test import (
    calculate_percentiles,
    generate_synthetic_test_pdf,
    parse_args,
    run_load_test,
    validate_target_url,
    verify_target_safety_preflight,
)


class TestLoadTestUrlAndArgumentValidation:
    """Test URL parsing, loopback restrictions, and argument bounds."""

    @pytest.mark.parametrize(
        "unsafe_url",
        [
            "http://api.groq.com",
            "https://integrate.api.nvidia.com",
            "http://example.com",
            "http://192.168.1.100:8000",
            "http://10.0.0.1:8000",
            "ftp://localhost:8000",
            "",
            "   ",
        ],
    )
    def test_rejects_unsafe_target_urls(self, unsafe_url):
        with pytest.raises(
            ValueError, match="Unsafe target|Target URL cannot|Unsupported URL"
        ):
            validate_target_url(unsafe_url)

    @pytest.mark.parametrize(
        ("valid_url", "expected"),
        [
            ("http://127.0.0.1:8000", "http://127.0.0.1:8000"),
            ("http://localhost:8000/", "http://localhost:8000"),
            ("http://0.0.0.0:8000", "http://0.0.0.0:8000"),
            ("http://[::1]:8000", "http://[::1]:8000"),
        ],
    )
    def test_accepts_valid_local_loopback_urls(self, valid_url, expected):
        assert validate_target_url(valid_url) == expected

    def test_cli_parser_has_no_provider_credential_arguments(self):
        args = parse_args([])
        assert not hasattr(args, "groq_api_key")
        assert not hasattr(args, "nvidia_api_key")
        assert not hasattr(args, "api_key")

        # Parsing unexpected provider key arguments must fail
        with pytest.raises(SystemExit):
            parse_args(["--groq-key", "secret"])

    def test_rejects_out_of_bounds_concurrency_or_requests(self):
        with pytest.raises(ValueError, match="Concurrency must be between"):
            pytest.importorskip("asyncio").run(
                run_load_test(
                    base_url="http://127.0.0.1:8000",
                    concurrency=0,
                    total_requests=10,
                )
            )

        with pytest.raises(ValueError, match="Concurrency must be between"):
            pytest.importorskip("asyncio").run(
                run_load_test(
                    base_url="http://127.0.0.1:8000",
                    concurrency=100,  # Exceeds MAX_SAFE_CONCURRENCY (50)
                    total_requests=10,
                )
            )

        with pytest.raises(ValueError, match="Total requests must be between"):
            pytest.importorskip("asyncio").run(
                run_load_test(
                    base_url="http://127.0.0.1:8000",
                    concurrency=5,
                    total_requests=5000,  # Exceeds MAX_SAFE_REQUESTS (1000)
                )
            )


class TestLoadTestSafetyPreflightChecks:
    """Test target health, mock-mode verification, and production rejection."""

    @pytest.mark.anyio
    async def test_preflight_rejects_unhealthy_target(self):
        mock_client = AsyncMock(spec=httpx.AsyncClient)
        mock_resp = AsyncMock()
        mock_resp.status_code = 503
        mock_client.get.return_value = mock_resp

        with pytest.raises(ValueError, match="Health check failed"):
            await verify_target_safety_preflight(mock_client, "http://127.0.0.1:8000")

    @pytest.mark.anyio
    async def test_preflight_rejects_production_environment(self):
        mock_client = AsyncMock(spec=httpx.AsyncClient)

        async def fake_get(url):
            from unittest.mock import MagicMock

            resp = MagicMock()
            if url.endswith("/health"):
                resp.status_code = 200
            elif url.endswith("/version"):
                resp.status_code = 200
                resp.json.return_value = {"environment": "production"}
            elif url.endswith("/ready"):
                resp.status_code = 200
                resp.json.return_value = {"checks": {"mock_mode": "true"}}
            return resp

        mock_client.get.side_effect = fake_get

        with pytest.raises(ValueError, match="environment is 'production'"):
            await verify_target_safety_preflight(mock_client, "http://127.0.0.1:8000")

    @pytest.mark.anyio
    async def test_preflight_rejects_non_mock_mode_target(self):
        mock_client = AsyncMock(spec=httpx.AsyncClient)

        async def fake_get(url):
            from unittest.mock import MagicMock

            resp = MagicMock()
            if url.endswith("/health"):
                resp.status_code = 200
            elif url.endswith("/version"):
                resp.status_code = 200
                resp.json.return_value = {"environment": "development"}
            elif url.endswith("/ready"):
                resp.status_code = 200
                resp.json.return_value = {"checks": {"mock_mode": "false"}}
            return resp

        mock_client.get.side_effect = fake_get

        with pytest.raises(ValueError, match="Target service is NOT in mock mode"):
            await verify_target_safety_preflight(mock_client, "http://127.0.0.1:8000")


class TestLoadTestExecutionAndStatistics:
    """Test synthetic payload generation and statistical aggregation."""

    def test_synthetic_pdf_generation(self):
        pdf_bytes = generate_synthetic_test_pdf()
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 100
        assert pdf_bytes.startswith(b"%PDF")

    def test_percentile_calculations_empty(self):
        stats = calculate_percentiles([])
        assert stats["p50"] == 0.0
        assert stats["mean"] == 0.0

    def test_percentile_calculations_known_distribution(self):
        # 10 values from 10.0 to 100.0
        latencies = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0]
        stats = calculate_percentiles(latencies)
        assert stats["min"] == 10.0
        assert stats["max"] == 100.0
        assert stats["mean"] == 55.0
        assert stats["p50"] == 50.0
        assert stats["p90"] == 90.0
        assert stats["p95"] == 100.0

    @pytest.mark.anyio
    async def test_run_load_test_execution_with_mocked_http_client(self):
        mock_client = AsyncMock(spec=httpx.AsyncClient)

        async def fake_get(url):
            from unittest.mock import MagicMock

            resp = MagicMock()
            if url.endswith("/health"):
                resp.status_code = 200
            elif url.endswith("/version"):
                resp.status_code = 200
                resp.json.return_value = {"environment": "development"}
            elif url.endswith("/ready"):
                resp.status_code = 200
                resp.json.return_value = {"checks": {"mock_mode": "true"}}
            return resp

        async def fake_post(url, **kwargs):
            from unittest.mock import MagicMock

            resp = MagicMock()
            resp.status_code = 200
            return resp

        mock_client.get.side_effect = fake_get
        mock_client.post.side_effect = fake_post

        results = await run_load_test(
            base_url="http://127.0.0.1:8000",
            concurrency=2,
            total_requests=4,
            timeout_seconds=2.0,
            client=mock_client,
        )

        assert results["total_requested"] == 4
        assert results["completed"] == 4
        assert results["successful"] == 4
        assert results["status_codes"] == {200: 4}
        assert results["timeouts"] == 0
        assert results["connection_errors"] == 0
        assert results["throughput_rps"] > 0
        assert "p50" in results["latencies_ms"]
