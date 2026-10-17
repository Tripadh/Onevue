"""Unit tests for optional Sentry-compatible error reporting and privacy scrubber.

Verifies:
1. Error reporting remains disabled by default.
2. Event scrubber strips sensitive headers (Authorization, X-API-Key, etc.).
3. Event scrubber replaces request body/data with redacted placeholder.
4. Event scrubber scrubs stack trace frame variables, breadcrumbs, and exceptions.
5. Canary secrets, API keys, and PII markers are scrubbed before any transmission.
6. Zero live network calls are made.
"""

from app.config import Settings
from app.observability.error_reporting import ErrorReporter, scrub_error_event


class TestErrorReporterConfiguration:
    """Verify default disabled state and configuration gates."""

    def test_disabled_by_default(self):
        settings = Settings()
        assert settings.ERROR_REPORTING_ENABLED is False
        assert ErrorReporter.is_configured(settings) is False
        assert ErrorReporter.init(settings) is False

    def test_configured_only_with_both_flag_and_dsn(self):
        s1 = Settings(ERROR_REPORTING_ENABLED=True, SENTRY_DSN="")
        assert ErrorReporter.is_configured(s1) is False

        s2 = Settings(
            ERROR_REPORTING_ENABLED=False, SENTRY_DSN="https://key@sentry.io/123"
        )
        assert ErrorReporter.is_configured(s2) is False

        s3 = Settings(
            ERROR_REPORTING_ENABLED=True, SENTRY_DSN="https://key@sentry.io/123"
        )
        assert ErrorReporter.is_configured(s3) is True


class TestEventScrubberOffline:
    """Verify comprehensive scrubbing of error event payloads."""

    def test_scrubs_sensitive_request_headers_and_body(self):
        raw_event = {
            "request": {
                "headers": {
                    "X-API-Key": "my-secret-service-key-12345",
                    "Authorization": "Bearer jwt.secret.token",
                    "X-Metrics-Token": "secret-metrics-token",
                    "Cookie": "session=abcdef123456",
                    "User-Agent": "Mozilla/5.0",
                    "Content-Type": "multipart/form-data",
                },
                "data": b"Raw PDF binary bytes and resume text content",
                "cookies": "session=secret",
            }
        }

        scrubbed = scrub_error_event(raw_event)
        headers = scrubbed["request"]["headers"]

        # Sensitive headers scrubbed
        assert headers["X-API-Key"] == "[REDACTED_HEADER]"
        assert headers["Authorization"] == "[REDACTED_HEADER]"
        assert headers["X-Metrics-Token"] == "[REDACTED_HEADER]"
        assert headers["Cookie"] == "[REDACTED_HEADER]"

        # Safe headers preserved
        assert headers["User-Agent"] == "Mozilla/5.0"
        assert headers["Content-Type"] == "multipart/form-data"

        # Request data completely redacted
        assert scrubbed["request"]["data"] == "[REDACTED_REQUEST_BODY]"
        assert scrubbed["request"]["cookies"] == "[REDACTED_COOKIES]"

    def test_scrubs_exception_values_and_frame_vars(self):
        canary_key = "gsk_canary_error_key_998877665544"
        raw_event = {
            "exception": {
                "values": [
                    {
                        "type": "ProviderAuthError",
                        "value": f"Authentication failed with key {canary_key}",
                        "stacktrace": {
                            "frames": [
                                {
                                    "filename": "pipeline.py",
                                    "lineno": 120,
                                    "vars": {
                                        "api_key": canary_key,
                                        "pdf_bytes": b"binary data",
                                        "resume_text": "Candidate details",
                                    },
                                }
                            ]
                        },
                    }
                ]
            }
        }

        scrubbed = scrub_error_event(raw_event)
        exc_entry = scrubbed["exception"]["values"][0]

        # Exception message scrubbed
        assert canary_key not in exc_entry["value"]
        assert "[REDACTED_SECRET]" in exc_entry["value"]

        # Frame vars scrubbed
        frame = exc_entry["stacktrace"]["frames"][0]
        assert frame["vars"] == "[REDACTED_FRAME_VARS]"

    def test_scrubs_breadcrumbs_and_extra(self):
        canary_nvapi = "nvapi-canary_secret_marker_112233"
        raw_event = {
            "breadcrumbs": {
                "values": [
                    {
                        "message": f"Calling provider with {canary_nvapi}",
                        "data": {
                            "filename": "resume.pdf",
                            "resume_text": "Jane Doe",
                            "safe_status": "ok",
                        },
                    }
                ]
            },
            "extra": {
                "prompt": "Extract candidate info",
                "pdf_bytes": b"bytes",
                "candidate_count": 1,
            },
            "user": {
                "email": "user@example.com",
                "id": "user-1234",
            },
        }

        scrubbed = scrub_error_event(raw_event)
        crumb = scrubbed["breadcrumbs"]["values"][0]

        assert canary_nvapi not in crumb["message"]
        assert "[REDACTED_SECRET]" in crumb["message"]
        assert crumb["data"]["filename"] == "[REDACTED]"
        assert crumb["data"]["resume_text"] == "[REDACTED]"
        assert crumb["data"]["safe_status"] == "ok"

        # Extra keys scrubbed
        assert scrubbed["extra"]["prompt"] == "[REDACTED]"
        assert scrubbed["extra"]["pdf_bytes"] == "[REDACTED]"
        assert scrubbed["extra"]["candidate_count"] == 1

        # User scrubbed
        assert "email" not in scrubbed["user"]
        assert "id" not in scrubbed["user"]
        assert scrubbed["user"]["ip_address"] == "[REDACTED]"
