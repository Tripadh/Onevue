"""Tests for Phase 15 multi-worker environment safeguards and graceful shutdown."""

import logging
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.orchestration.concurrency import get_concurrency_limiter
from app.orchestration.lifecycle import (
    check_multi_worker_environment,
    perform_graceful_shutdown,
    warn_multi_worker_if_detected,
)


class TestMultiWorkerSafeguards:
    """Test multi-worker configuration detection and advisory logging."""

    def test_single_worker_detected_accurately(self, monkeypatch):
        monkeypatch.setenv("WEB_CONCURRENCY", "1")
        monkeypatch.setenv("WORKERS", "1")
        settings = Settings(
            WEB_CONCURRENCY=1,
            WORKERS=1,
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert check_multi_worker_environment(settings) is False

    def test_multi_worker_detected_via_settings(self):
        settings = Settings(
            WEB_CONCURRENCY=4,
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert check_multi_worker_environment(settings) is True

    def test_multi_worker_detected_via_env(self, monkeypatch):
        monkeypatch.setenv("WEB_CONCURRENCY", "2")
        settings = Settings(
            WEB_CONCURRENCY=None,
            WORKERS=None,
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert check_multi_worker_environment(settings) is True

    def test_warning_logged_when_multi_worker_detected(self, caplog):
        settings = Settings(
            WEB_CONCURRENCY=2,
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        with caplog.at_level(logging.WARNING):
            is_multi = warn_multi_worker_if_detected(settings)

        assert is_multi is True
        messages = [r.message for r in caplog.records]
        assert any("MULTI-WORKER WARNING" in msg for msg in messages)
        assert any("PROCESS-LOCAL" in msg for msg in messages)

    def test_no_warning_when_single_worker(self, caplog):
        settings = Settings(
            WEB_CONCURRENCY=1,
            WORKERS=1,
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        with caplog.at_level(logging.WARNING):
            is_multi = warn_multi_worker_if_detected(settings)

        assert is_multi is False
        messages = [r.message for r in caplog.records]
        assert not any("MULTI-WORKER WARNING" in msg for msg in messages)


class TestGracefulShutdown:
    """Test graceful shutdown sequencing and request rejection."""

    def test_perform_graceful_shutdown_marks_limiter(self):
        limiter = get_concurrency_limiter()
        limiter.reset_shutdown()
        assert limiter._shutting_down is False

        target_fn = "app.orchestration.lifecycle.get_isolated_pdf_parser"
        with patch(target_fn) as mock_get_parser:
            perform_graceful_shutdown()
            mock_get_parser.return_value.shutdown.assert_called_once()

        assert limiter._shutting_down is True
        limiter.reset_shutdown()

    def test_lifespan_lifecycle_execution(self, monkeypatch):
        monkeypatch.setenv("SERVICE_API_KEYS", "sec-key")
        monkeypatch.setenv("METRICS_TOKEN", "test-metrics-token")
        monkeypatch.setenv("WEB_CONCURRENCY", "1")

        with TestClient(app) as client:
            resp = client.get("/health")
            assert resp.status_code == 200

        # After client exits, lifespan shutdown ran
        limiter = get_concurrency_limiter()
        assert limiter._shutting_down is True
        limiter.reset_shutdown()
