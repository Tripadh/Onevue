"""Service lifecycle, multi-worker detection, and graceful shutdown coordinator.

Documents and manages architectural boundaries:
- Concurrency limiter and rate guards are strictly PROCESS-LOCAL.
- Multi-worker configurations (e.g. WEB_CONCURRENCY > 1) multiply effective capacity
  by the worker count because state is not shared across processes.
- Graceful shutdown stops accepting new extraction operations,
  terminates active isolated PDF workers, and cleans up resources
  within a bounded timeout.
"""

import logging
import os

from app.config import Settings, get_settings
from app.extraction.isolated_parser import get_isolated_pdf_parser
from app.orchestration.concurrency import get_concurrency_limiter

logger = logging.getLogger(__name__)


def check_multi_worker_environment(settings: Settings | None = None) -> bool:
    """Detect whether the service is configured with multiple worker processes.

    Checks application settings and common container/WSGI environment variables:
    - WEB_CONCURRENCY (Uvicorn / Gunicorn standard)
    - WORKERS / UVICORN_WORKERS

    Args:
        settings: Optional application settings instance.

    Returns:
        True if worker count is greater than 1, False otherwise.
    """
    cfg = settings or get_settings()

    candidates = [
        cfg.WEB_CONCURRENCY,
        cfg.WORKERS,
        os.environ.get("WEB_CONCURRENCY"),
        os.environ.get("WORKERS"),
        os.environ.get("UVICORN_WORKERS"),
    ]

    for val in candidates:
        if val is not None:
            try:
                num = int(str(val).strip())
                if num > 1:
                    return True
            except (ValueError, TypeError):
                continue

    return False


def warn_multi_worker_if_detected(settings: Settings | None = None) -> bool:
    """Log an advisory warning if multi-worker configuration is detected.

    Args:
        settings: Optional application settings.

    Returns:
        True if multi-worker detected and warning logged, False otherwise.
    """
    is_multi = check_multi_worker_environment(settings)
    if is_multi:
        logger.warning(
            "MULTI-WORKER WARNING: Multi-worker deployment detected (workers > 1). "
            "Please note that ProcessLocalRateGuard, ExtractionConcurrencyLimiter, "
            "and ProviderCircuitBreaker are strictly PROCESS-LOCAL in-memory "
            "safeguards and are NOT synchronized across worker processes. "
            "Total throughput and concurrency across N workers will be up to "
            "N times configured limits. Use a single worker or an external "
            "reverse-proxy rate limiter if strict global bounds are required."
        )
    return is_multi


def perform_graceful_shutdown(settings: Settings | None = None) -> None:
    """Execute graceful shutdown sequence for process-local resources.

    1. Stops accepting new extraction requests.
    2. Terminates any running isolated PDF parser workers.
    """
    cfg = settings or get_settings()

    # 1. Stop accepting new expensive extractions
    limiter = get_concurrency_limiter(cfg)
    limiter.initiate_shutdown()

    # 2. Terminate running isolated parser workers within bounded timeout
    parser = get_isolated_pdf_parser(cfg)
    parser.shutdown(timeout=3.0)
