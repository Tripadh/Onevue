"""Observability and operational visibility package for ONEVUE LLM Service."""

from app.observability.error_reporting import ErrorReporter, scrub_error_event
from app.observability.logging import (
    JSONLogFormatter,
    log_event,
    sanitize_text_for_logging,
    setup_logging,
)
from app.observability.metrics import (
    MetricsRegistry,
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
from app.observability.middleware import ObservabilityMiddleware
from app.observability.request_id import (
    REQUEST_ID_HEADER,
    get_request_id,
    is_valid_request_id,
    resolve_request_id,
    set_request_id,
)

__all__ = [
    "REQUEST_ID_HEADER",
    "ErrorReporter",
    "JSONLogFormatter",
    "MetricsRegistry",
    "ObservabilityMiddleware",
    "get_metrics_text",
    "get_request_id",
    "is_valid_request_id",
    "log_event",
    "record_extraction_request",
    "record_http_request",
    "record_provider_call",
    "record_provider_fallback",
    "record_provider_failure",
    "record_provider_timeout",
    "record_rate_limit_rejection",
    "reset_metrics",
    "resolve_request_id",
    "sanitize_text_for_logging",
    "scrub_error_event",
    "set_request_id",
    "setup_logging",
]
