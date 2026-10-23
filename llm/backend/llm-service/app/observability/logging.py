"""Structured JSON logging and operational telemetry for ONEVUE LLM Service."""

import datetime
import json
import logging
import re
import sys
from typing import Any

from app.config import get_settings
from app.observability.request_id import get_request_id

# ---------------------------------------------------------------------------
# Strict Secret and PII Sanitization Patterns
# ---------------------------------------------------------------------------

_SECRET_PATTERNS: list[re.Pattern] = [
    re.compile(r"gsk_[A-Za-z0-9_-]+"),
    re.compile(r"nvapi-[A-Za-z0-9_-]+"),
    re.compile(r"sk-[A-Za-z0-9_-]+"),
    re.compile(r"Bearer\s+[A-Za-z0-9_\-.]+", re.IGNORECASE),
    re.compile(r"sec-test-[A-Za-z0-9_-]+"),
    re.compile(r"canary_[A-Za-z0-9_-]+"),
]

# Sensitive keys that must NEVER be emitted in structured log extras
_DISALLOWED_EXTRA_KEYS: set[str] = {
    "filename",
    "clean_filename",
    "file_bytes",
    "resume_text",
    "cleaned_text",
    "raw_text",
    "prompt",
    "messages",
    "draft",
    "extracted_fields",
    "authorization",
    "x_api_key",
    "api_key",
    "secret",
    "groq_api_key",
    "nvidia_api_key",
    "service_api_key",
    "metrics_token",
}

# Delimiter tags that should be neutralized if present in strings
_DELIMITER_PATTERN = re.compile(
    r"</?(?:resume_text|draft_to_repair|system_instruction)[^>]*>",
    re.IGNORECASE,
)


def sanitize_text_for_logging(text: str) -> str:
    """Sanitize strings to guarantee zero leakage of credentials or prompts."""
    if not isinstance(text, str):
        text = str(text)

    # 1. Neutralize prompt delimiters
    sanitized = _DELIMITER_PATTERN.sub("[REDACTED_DELIMITER]", text)

    # 2. Mask known secret token patterns
    for pattern in _SECRET_PATTERNS:
        sanitized = pattern.sub("[REDACTED_SECRET]", sanitized)

    # 3. Mask configured service secrets dynamically
    try:
        settings = get_settings()
        for secret_val in (
            settings.LLM_SERVICE_API_KEY,
            settings.SERVICE_API_KEY,
            settings.GROQ_API_KEY,
            settings.NVIDIA_API_KEY,
            settings.METRICS_TOKEN,
        ):
            if secret_val and secret_val.strip() and len(secret_val.strip()) > 3:
                sanitized = sanitized.replace(secret_val.strip(), "[REDACTED_SECRET]")
    except Exception:
        pass

    return sanitized


def sanitize_value(val: Any) -> Any:
    """Recursively sanitize dictionary and list values for logging."""
    if isinstance(val, str):
        return sanitize_text_for_logging(val)
    if isinstance(val, dict):
        return {
            k: sanitize_value(v)
            for k, v in val.items()
            if k.lower() not in _DISALLOWED_EXTRA_KEYS
        }
    if isinstance(val, (list, tuple)):
        return [sanitize_value(item) for item in val]
    if isinstance(val, (int, float, bool)) or val is None:
        return val
    return sanitize_text_for_logging(str(val))


class JSONLogFormatter(logging.Formatter):
    """JSON formatter enforcing strict redaction and schema stability."""

    def format(self, record: logging.LogRecord) -> str:
        settings = get_settings()
        now_utc = (
            datetime.datetime.now(datetime.UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )

        event_name = getattr(record, "event", None)
        if not event_name:
            # Fallback to sanitized message string or generic event identifier
            event_name = getattr(record, "msg", "log_message")
            if isinstance(event_name, str):
                event_name = event_name.replace(" ", "_").lower()[:64]
            else:
                event_name = "log_message"

        log_payload: dict[str, Any] = {
            "timestamp": now_utc,
            "severity": record.levelname,
            "event": sanitize_text_for_logging(str(event_name)),
            "service": settings.SERVICE_NAME,
            "environment": settings.ENVIRONMENT,
        }

        # Include request ID if available in context
        req_id = getattr(record, "request_id", None) or get_request_id()
        if req_id:
            log_payload["request_id"] = sanitize_text_for_logging(str(req_id))

        # Include sanitized message if distinct from event
        raw_message = record.getMessage()
        if raw_message and raw_message != str(event_name):
            log_payload["message"] = sanitize_text_for_logging(raw_message)

        # Include safe extra fields
        standard_attrs = {
            "name",
            "msg",
            "args",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "created",
            "msecs",
            "relativeCreated",
            "thread",
            "threadName",
            "processName",
            "process",
            "message",
            "event",
            "request_id",
        }

        for key, val in record.__dict__.items():
            if key not in standard_attrs and key.lower() not in _DISALLOWED_EXTRA_KEYS:
                log_payload[key] = sanitize_value(val)

        # Exception information (scrubbed, no raw exception dumps leaking secrets)
        if record.exc_info and record.exc_info[1]:
            exc = record.exc_info[1]
            log_payload["exception_type"] = type(exc).__name__
            log_payload["exception_message"] = sanitize_text_for_logging(str(exc))

        return json.dumps(log_payload, ensure_ascii=False)


_operational_logger = logging.getLogger("app.operational")


def log_event(
    event: str,
    level: int = logging.INFO,
    **metadata: Any,
) -> None:
    """Emit a structured operational log event with safe metadata.

    Args:
        event: Stable event name (e.g. 'request_started', 'provider_fallback').
        level: Logging level (e.g. logging.INFO, logging.WARNING, logging.ERROR).
        **metadata: Safe operational attributes (duration_ms, status_code, etc.).
    """
    safe_metadata = {
        k: sanitize_value(v)
        for k, v in metadata.items()
        if k.lower() not in _DISALLOWED_EXTRA_KEYS
    }
    extra_payload = {"event": event, **safe_metadata}
    _operational_logger.log(
        level,
        event,
        extra=extra_payload,
    )


_logging_configured = False


def setup_logging(log_level: str = "info") -> None:
    """Configure application JSON logging without duplicate handlers."""
    global _logging_configured
    if _logging_configured:
        return

    numeric_level = getattr(logging, log_level.upper(), logging.INFO)
    formatter = JSONLogFormatter()

    # Configure root logger
    root = logging.getLogger()
    root.setLevel(numeric_level)

    # Remove any existing stdout/stderr handlers to avoid duplicate output
    for handler in root.handlers[:]:
        if isinstance(handler, logging.StreamHandler):
            root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    handler.setLevel(numeric_level)
    root.addHandler(handler)

    # Ensure app namespace propagates to root
    app_logger = logging.getLogger("app")
    app_logger.setLevel(numeric_level)
    app_logger.propagate = True

    _logging_configured = True
