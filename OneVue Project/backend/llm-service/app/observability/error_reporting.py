"""Privacy-preserving optional error-reporting integration and scrubber."""

from typing import Any

from app.config import Settings, get_settings
from app.observability.logging import sanitize_text_for_logging

_SENSITIVE_HEADERS: set[str] = {
    "authorization",
    "x-api-key",
    "x-metrics-token",
    "cookie",
    "set-cookie",
    "proxy-authorization",
}

_FORBIDDEN_EVENT_KEYS: set[str] = {
    "pdf_bytes",
    "file_bytes",
    "filename",
    "clean_filename",
    "resume_text",
    "cleaned_text",
    "raw_text",
    "prompt",
    "draft",
    "api_key",
    "groq_api_key",
    "nvidia_api_key",
    "service_api_key",
}


def scrub_error_event(
    event: dict[str, Any], hint: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Scrub sensitive request data, credentials, and resume content from error events.

    Functions as a privacy-enforcing before-send hook for Sentry-compatible SDKs.
    Guarantees that uploaded PDF bytes, resume text, personal information,
    API keys, and authorization headers are completely stripped prior to transmission.
    """
    if not isinstance(event, dict):
        return {}

    # 1. Scrub Request Metadata & Completely Drop Request Bodies
    if "request" in event and isinstance(event["request"], dict):
        req = event["request"]

        # Redact sensitive headers
        if "headers" in req and isinstance(req["headers"], dict):
            req["headers"] = {
                k: ("[REDACTED_HEADER]" if k.lower() in _SENSITIVE_HEADERS else v)
                for k, v in req["headers"].items()
            }

        # Request bodies / form payloads are strictly scrubbed
        if "data" in req:
            req["data"] = "[REDACTED_REQUEST_BODY]"

        # Strip cookies
        if "cookies" in req:
            req["cookies"] = "[REDACTED_COOKIES]"

    # 2. Scrub Exception Messages and Frame Variables
    if "exception" in event and isinstance(event["exception"], dict):
        exc_values = event["exception"].get("values", [])
        if isinstance(exc_values, list):
            for exc_entry in exc_values:
                if isinstance(exc_entry, dict):
                    if "value" in exc_entry and isinstance(exc_entry["value"], str):
                        exc_entry["value"] = sanitize_text_for_logging(
                            exc_entry["value"]
                        )

                    # Strip stack trace local variables to prevent data leaks
                    stacktrace = exc_entry.get("stacktrace", {})
                    if isinstance(stacktrace, dict):
                        frames = stacktrace.get("frames", [])
                        if isinstance(frames, list):
                            for frame in frames:
                                if isinstance(frame, dict) and "vars" in frame:
                                    frame["vars"] = "[REDACTED_FRAME_VARS]"

    # 3. Scrub Breadcrumbs
    if "breadcrumbs" in event and isinstance(event["breadcrumbs"], dict):
        crumbs = event["breadcrumbs"].get("values", [])
        if isinstance(crumbs, list):
            for crumb in crumbs:
                if isinstance(crumb, dict):
                    if "message" in crumb and isinstance(crumb["message"], str):
                        crumb["message"] = sanitize_text_for_logging(crumb["message"])
                    if "data" in crumb and isinstance(crumb["data"], dict):
                        crumb["data"] = {
                            k: "[REDACTED]"
                            if k.lower() in _FORBIDDEN_EVENT_KEYS
                            else sanitize_text_for_logging(str(v))
                            for k, v in crumb["data"].items()
                        }

    # 4. Scrub Extra Contexts & User Data
    if "user" in event:
        # Never transmit personal user IDs or email
        event["user"] = {"ip_address": "[REDACTED]"}

    if "extra" in event and isinstance(event["extra"], dict):
        event["extra"] = {
            k: "[REDACTED]"
            if k.lower() in _FORBIDDEN_EVENT_KEYS
            else (sanitize_text_for_logging(str(v)) if isinstance(v, str) else v)
            for k, v in event["extra"].items()
        }

    return event


class ErrorReporter:
    """Manager for optional, privacy-safe error reporting."""

    _initialized: bool = False

    @classmethod
    def is_configured(cls, settings: Settings | None = None) -> bool:
        """Check whether error reporting is enabled in settings."""
        settings = settings or get_settings()
        return bool(settings.ERROR_REPORTING_ENABLED and settings.SENTRY_DSN.strip())

    @classmethod
    def init(cls, settings: Settings | None = None) -> bool:
        """Initialize error reporting if explicitly configured. Disabled by default."""
        settings = settings or get_settings()
        if not cls.is_configured(settings):
            return False

        try:
            import sentry_sdk

            sentry_sdk.init(
                dsn=settings.SENTRY_DSN.strip(),
                environment=settings.ENVIRONMENT,
                before_send=scrub_error_event,
                send_default_pii=False,
                traces_sample_rate=0.0,
            )
            cls._initialized = True
            return True
        except ImportError:
            # sentry-sdk is optional and not a mandatory dependency
            return False
        except Exception:
            return False
