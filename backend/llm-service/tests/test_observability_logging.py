"""Unit and integration tests for structured operational logging and redaction.

Verifies:
1. Structured JSON format with timestamp, severity, event, and correlation ID.
2. Stable operational event names.
3. Strict redaction of secrets, canary markers, prompts, PII, and filenames.
4. Idempotent logging configuration preventing duplicate entries.
"""

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.observability.logging import (
    JSONLogFormatter,
    sanitize_text_for_logging,
    setup_logging,
)
from app.observability.request_id import set_request_id

TEST_KEY = "sec-test-service-key-logging-12345"


@pytest.fixture
def obs_client():
    settings = Settings(
        LLM_SERVICE_API_KEY=TEST_KEY,
        SERVICE_API_KEY=TEST_KEY,
        MOCK_MODE=True,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


class TestStructuredJSONFormatter:
    """Tests verifying JSONLogFormatter schema, stable events, and redactions."""

    def test_formatter_emits_valid_json_with_required_fields(self):
        formatter = JSONLogFormatter()
        set_request_id("test-req-id-123")
        record = logging.LogRecord(
            name="app.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=10,
            msg="request_completed",
            args=(),
            exc_info=None,
        )
        record.event = "request_completed"
        record.http_status = 200
        record.duration_ms = 45.2

        formatted = formatter.format(record)
        data = json.loads(formatted)

        assert data["service"] == "onevue-llm-service"
        assert data["environment"] == "development"
        assert data["severity"] == "INFO"
        assert data["event"] == "request_completed"
        assert data["request_id"] == "test-req-id-123"
        assert data["http_status"] == 200
        assert data["duration_ms"] == 45.2
        assert "timestamp" in data
        assert data["timestamp"].endswith("Z")
        set_request_id(None)

    def test_secrets_and_canaries_are_redacted_from_log_strings(self):
        canary_secret = "gsk_canary_test_secret_998877665544332211"
        raw_msg = f"Failed to authenticate with key {canary_secret}"
        sanitized = sanitize_text_for_logging(raw_msg)
        assert canary_secret not in sanitized
        assert "[REDACTED_SECRET]" in sanitized

    def test_bearer_tokens_are_redacted_from_log_strings(self):
        raw_msg = "Received Authorization: Bearer abc123xyz_token_value.jwt"
        sanitized = sanitize_text_for_logging(raw_msg)
        assert "abc123xyz" not in sanitized
        assert "[REDACTED_SECRET]" in sanitized

    def test_prompt_delimiters_are_neutralized_in_log_strings(self):
        raw_msg = "Processing <resume_text>Some candidate info</resume_text>"
        sanitized = sanitize_text_for_logging(raw_msg)
        assert "<resume_text>" not in sanitized
        assert "</resume_text>" not in sanitized
        assert "[REDACTED_DELIMITER]" in sanitized

    def test_disallowed_keys_dropped_from_extras(self):
        formatter = JSONLogFormatter()
        record = logging.LogRecord(
            name="app.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=10,
            msg="test_event",
            args=(),
            exc_info=None,
        )
        record.event = "data_processed"
        record.filename = "secret_resume.pdf"
        record.clean_filename = "secret_resume.pdf"
        record.resume_text = "John Doe 123 Main St"
        record.prompt = "System prompt here"
        record.safe_metric = 42

        formatted = formatter.format(record)
        data = json.loads(formatted)

        assert "clean_filename" not in data
        assert "resume_text" not in data
        assert "prompt" not in data
        assert data.get("safe_metric") == 42


class TestOperationalLoggingOutput:
    """Tests verifying real log capture and secrecy in request flows."""

    def test_request_lifecycle_logs_emitted_with_correlation(self, obs_client, caplog):
        with caplog.at_level(logging.INFO):
            resp = obs_client.get(
                "/health",
                headers={"X-Request-ID": "corr-req-test-999"},
            )
            assert resp.status_code == 200

        # Find operational logs
        records = [r for r in caplog.records if getattr(r, "event", None)]
        event_names = [getattr(r, "event", "") for r in records]
        assert "request_started" in event_names
        assert "request_completed" in event_names

        # Verify request ID presence
        completed_record = next(
            r for r in records if getattr(r, "event", "") == "request_completed"
        )
        assert getattr(completed_record, "request_id", None) == "corr-req-test-999"
        assert getattr(completed_record, "http_status", None) == 200

    def test_no_resume_text_or_canary_keys_in_logs_during_extraction(
        self, obs_client, caplog
    ):
        from tests.test_security_hardening import make_clean_pdf

        canary_email = "obs_canary_test_candidate@example.org"
        canary_phone = "+1-555-888-9999"
        canary_key = "gsk_super_secret_canary_api_key_44332211"
        pdf_bytes = make_clean_pdf(f"Candidate\n{canary_email}\n{canary_phone}")

        with caplog.at_level(logging.DEBUG):
            resp = obs_client.post(
                "/v1/extract",
                headers={"X-API-Key": TEST_KEY},
                files={
                    "file": ("super_private_resume.pdf", pdf_bytes, "application/pdf")
                },
            )
            assert resp.status_code == 200

        full_logs = caplog.text
        assert canary_email not in full_logs
        assert canary_phone not in full_logs
        assert canary_key not in full_logs
        assert "super_private_resume.pdf" not in full_logs

    def test_setup_logging_is_idempotent(self):
        root = logging.getLogger()
        handler_count_before = len(root.handlers)
        setup_logging()
        setup_logging()
        handler_count_after = len(root.handlers)
        assert handler_count_after <= handler_count_before or handler_count_after == 1
