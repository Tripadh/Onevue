"""Low-cardinality, thread-safe Prometheus metrics registry for ONEVUE LLM Service."""

import threading
from collections import defaultdict
from typing import ClassVar

# ---------------------------------------------------------------------------
# Strict Label Cardinality Normalization Sets
# ---------------------------------------------------------------------------

_ALLOWED_ROUTES: set[str] = {
    "/v1/extract",
    "/health",
    "/ready",
    "/version",
    "/metrics",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/",
}

_ALLOWED_METHODS: set[str] = {
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "OPTIONS",
    "HEAD",
}

_ALLOWED_STATUS_CLASSES: set[str] = {
    "1xx",
    "2xx",
    "3xx",
    "4xx",
    "5xx",
}

_ALLOWED_PROVIDERS: set[str] = {
    "groq",
    "nvidia",
    "mock",
}

_ALLOWED_CALL_TYPES: set[str] = {
    "extract",
    "repair",
}

_ALLOWED_ERROR_CATEGORIES: set[str] = {
    "timeout",
    "unavailable",
    "rate_limit",
    "auth",
    "invalid_request",
    "malformed_output",
    "internal",
    "none",
    "unknown",
}

# Standard latency buckets for HTTP request duration (seconds)
HISTOGRAM_BUCKETS: tuple[float, ...] = (
    0.01,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
)


def _normalize_route(route: str | None) -> str:
    """Map arbitrary paths to strictly bounded route templates."""
    if not route:
        return "other"
    route = route.strip()
    if route in _ALLOWED_ROUTES:
        return route
    return "other"


def _normalize_method(method: str | None) -> str:
    """Map HTTP methods to standard set."""
    if not method:
        return "other"
    method_upper = method.upper().strip()
    return method_upper if method_upper in _ALLOWED_METHODS else "other"


def _normalize_status_class(status_code: int) -> str:
    """Map integer status codes to class string (e.g. 2xx, 4xx, 5xx)."""
    cls = f"{status_code // 100}xx"
    return cls if cls in _ALLOWED_STATUS_CLASSES else "5xx"


def _normalize_provider(provider: str | None) -> str:
    """Map provider identifier safely."""
    if not provider:
        return "unknown"
    p_lower = str(provider).lower()
    if "groq" in p_lower:
        return "groq"
    if "nvidia" in p_lower:
        return "nvidia"
    if "mock" in p_lower:
        return "mock"
    return "unknown"


def _normalize_error_category(category: str | None) -> str:
    """Map error category safely to predefined enum values."""
    if not category:
        return "unknown"
    cat_lower = str(category).lower().strip()
    return cat_lower if cat_lower in _ALLOWED_ERROR_CATEGORIES else "unknown"


class MetricsRegistry:
    """Thread-safe, zero-dependency Prometheus metrics collector."""

    _instance: ClassVar["MetricsRegistry | None"] = None
    _lock: ClassVar[threading.Lock] = threading.Lock()

    def __init__(self) -> None:
        self._mutex = threading.Lock()
        self.reset()

    @classmethod
    def get_instance(cls) -> "MetricsRegistry":
        """Return singleton metrics registry."""
        with cls._lock:
            if cls._instance is None:
                cls._instance = MetricsRegistry()
            return cls._instance

    def reset(self) -> None:
        """Reset all metrics to initial states (used in tests)."""
        with self._mutex:
            # Counters
            self.http_requests_total: dict[tuple[str, str, str], int] = defaultdict(int)
            self.extraction_requests_total: dict[tuple[str, str], int] = defaultdict(
                int
            )
            self.provider_calls_total: dict[tuple[str, str], int] = defaultdict(int)
            self.provider_failures_total: dict[tuple[str, str], int] = defaultdict(int)
            self.provider_fallbacks_total: dict[tuple[str, str], int] = defaultdict(int)
            self.rate_limit_rejections_total: dict[tuple[str], int] = defaultdict(int)
            self.provider_timeouts_total: dict[tuple[str], int] = defaultdict(int)

            # Histograms: (route, method) -> {bucket: count, "sum": float, "count": int}
            self.http_duration_buckets: dict[
                tuple[str, str], dict[float | str, float]
            ] = defaultdict(lambda: defaultdict(float))

    def record_http_request(
        self,
        route: str,
        method: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        """Record an HTTP request completion and its latency safely."""
        try:
            norm_route = _normalize_route(route)
            norm_method = _normalize_method(method)
            norm_status = _normalize_status_class(status_code)

            with self._mutex:
                # 1. Total count
                self.http_requests_total[(norm_route, norm_method, norm_status)] += 1

                # 2. Latency histogram
                hist = self.http_duration_buckets[(norm_route, norm_method)]
                hist["count"] += 1
                hist["sum"] += max(0.0, float(duration_seconds))
                for b in HISTOGRAM_BUCKETS:
                    if duration_seconds <= b:
                        hist[b] += 1
        except Exception:
            # Instrumentation must never impact business logic
            pass

    def record_extraction_request(
        self,
        status: str,
        error_code: str = "none",
    ) -> None:
        """Record extraction success/failure count with sanitized error code."""
        try:
            norm_status = "success" if status == "success" else "failure"
            norm_code = str(error_code)[:32] if error_code else "none"
            with self._mutex:
                self.extraction_requests_total[(norm_status, norm_code)] += 1
        except Exception:
            pass

    def record_provider_call(
        self,
        provider: str,
        call_type: str = "extract",
    ) -> None:
        """Record an outgoing LLM provider invocation."""
        try:
            norm_p = _normalize_provider(provider)
            norm_ct = (
                call_type.lower()
                if call_type.lower() in _ALLOWED_CALL_TYPES
                else "extract"
            )
            with self._mutex:
                self.provider_calls_total[(norm_p, norm_ct)] += 1
        except Exception:
            pass

    def record_provider_failure(
        self,
        provider: str,
        error_category: str,
    ) -> None:
        """Record a categorized provider failure."""
        try:
            norm_p = _normalize_provider(provider)
            norm_cat = _normalize_error_category(error_category)
            with self._mutex:
                self.provider_failures_total[(norm_p, norm_cat)] += 1
        except Exception:
            pass

    def record_provider_fallback(
        self,
        primary: str,
        fallback: str,
    ) -> None:
        """Record a fallback activation."""
        try:
            norm_primary = _normalize_provider(primary)
            norm_fallback = _normalize_provider(fallback)
            with self._mutex:
                self.provider_fallbacks_total[(norm_primary, norm_fallback)] += 1
        except Exception:
            pass

    def record_rate_limit_rejection(
        self,
        guard: str = "process_local",
    ) -> None:
        """Record a rate limit rejection event."""
        try:
            norm_guard = "process_local" if "process" in guard.lower() else "budget"
            with self._mutex:
                self.rate_limit_rejections_total[(norm_guard,)] += 1
        except Exception:
            pass

    def record_provider_timeout(
        self,
        provider: str,
    ) -> None:
        """Record a provider timeout event."""
        try:
            norm_p = _normalize_provider(provider)
            with self._mutex:
                self.provider_timeouts_total[(norm_p,)] += 1
        except Exception:
            pass

    def render_prometheus_text(self) -> str:
        """Generate Prometheus exposition text format (version 0.0.4)."""
        lines: list[str] = []

        with self._mutex:
            # 1. http_requests_total
            lines.append(
                "# HELP http_requests_total Total number of HTTP requests processed."
            )
            lines.append("# TYPE http_requests_total counter")
            for (route, method, status), val in sorted(
                self.http_requests_total.items()
            ):
                lines.append(
                    f'http_requests_total{{method="{method}",route="{route}",'
                    f'status_class="{status}"}} {val}'
                )

            # 2. http_request_duration_seconds
            lines.append(
                "# HELP http_request_duration_seconds HTTP request duration in seconds."
            )
            lines.append("# TYPE http_request_duration_seconds histogram")
            for (route, method), hist in sorted(self.http_duration_buckets.items()):
                cumulative = 0
                for b in HISTOGRAM_BUCKETS:
                    cumulative += int(hist.get(b, 0))
                    b_str = f"{b:g}"
                    lines.append(
                        f'http_request_duration_seconds_bucket{{le="{b_str}",'
                        f'method="{method}",route="{route}"}} {cumulative}'
                    )
                lines.append(
                    f'http_request_duration_seconds_bucket{{le="+Inf",'
                    f'method="{method}",route="{route}"}} {int(hist.get("count", 0))}'
                )
                lines.append(
                    f'http_request_duration_seconds_sum{{method="{method}",'
                    f'route="{route}"}} {hist.get("sum", 0.0):.6f}'
                )
                lines.append(
                    f'http_request_duration_seconds_count{{method="{method}",'
                    f'route="{route}"}} {int(hist.get("count", 0))}'
                )

            # 3. extraction_requests_total
            lines.append(
                "# HELP extraction_requests_total Total number of resume extraction "
                "requests by status and error code."
            )
            lines.append("# TYPE extraction_requests_total counter")
            for (status, code), val in sorted(self.extraction_requests_total.items()):
                lines.append(
                    f'extraction_requests_total{{error_code="{code}",'
                    f'status="{status}"}} {val}'
                )

            # 4. provider_calls_total
            lines.append(
                "# HELP provider_calls_total Total calls made to LLM providers."
            )
            lines.append("# TYPE provider_calls_total counter")
            for (provider, call_type), val in sorted(self.provider_calls_total.items()):
                lines.append(
                    f'provider_calls_total{{call_type="{call_type}",'
                    f'provider="{provider}"}} {val}'
                )

            # 5. provider_failures_total
            lines.append(
                "# HELP provider_failures_total Failure count for LLM providers."
            )
            lines.append("# TYPE provider_failures_total counter")
            for (provider, error_category), val in sorted(
                self.provider_failures_total.items()
            ):
                lines.append(
                    f'provider_failures_total{{error_category="{error_category}",'
                    f'provider="{provider}"}} {val}'
                )

            # 6. provider_fallbacks_total
            lines.append(
                "# HELP provider_fallbacks_total Total provider fallback activations."
            )
            lines.append("# TYPE provider_fallbacks_total counter")
            for (primary, fallback), val in sorted(
                self.provider_fallbacks_total.items()
            ):
                lines.append(
                    f'provider_fallbacks_total{{fallback="{fallback}",'
                    f'primary="{primary}"}} {val}'
                )

            # 7. rate_limit_rejections_total
            lines.append(
                "# HELP rate_limit_rejections_total Total rate limit guard rejections."
            )
            lines.append("# TYPE rate_limit_rejections_total counter")
            for (guard,), val in sorted(self.rate_limit_rejections_total.items()):
                lines.append(f'rate_limit_rejections_total{{guard="{guard}"}} {val}')

            # 8. provider_timeouts_total
            lines.append(
                "# HELP provider_timeouts_total Total timeouts calling providers."
            )
            lines.append("# TYPE provider_timeouts_total counter")
            for (provider,), val in sorted(self.provider_timeouts_total.items()):
                lines.append(f'provider_timeouts_total{{provider="{provider}"}} {val}')

        return "\n".join(lines) + "\n"


# Package-level helpers
def record_http_request(
    route: str, method: str, status_code: int, duration_seconds: float
) -> None:
    """Safely record an HTTP request."""
    MetricsRegistry.get_instance().record_http_request(
        route, method, status_code, duration_seconds
    )


def record_extraction_request(status: str, error_code: str = "none") -> None:
    """Safely record an extraction request."""
    MetricsRegistry.get_instance().record_extraction_request(status, error_code)


def record_provider_call(provider: str, call_type: str = "extract") -> None:
    """Safely record a provider call."""
    MetricsRegistry.get_instance().record_provider_call(provider, call_type)


def record_provider_failure(provider: str, error_category: str) -> None:
    """Safely record a provider failure."""
    MetricsRegistry.get_instance().record_provider_failure(provider, error_category)


def record_provider_fallback(primary: str, fallback: str) -> None:
    """Safely record a provider fallback."""
    MetricsRegistry.get_instance().record_provider_fallback(primary, fallback)


def record_rate_limit_rejection(guard: str = "process_local") -> None:
    """Safely record a rate limit rejection."""
    MetricsRegistry.get_instance().record_rate_limit_rejection(guard)


def record_provider_timeout(provider: str) -> None:
    """Safely record a provider timeout."""
    MetricsRegistry.get_instance().record_provider_timeout(provider)


def get_metrics_text() -> str:
    """Return current metrics formatted in Prometheus text exposition format."""
    return MetricsRegistry.get_instance().render_prometheus_text()


def reset_metrics() -> None:
    """Reset metrics registry counters for test isolation."""
    MetricsRegistry.get_instance().reset()
