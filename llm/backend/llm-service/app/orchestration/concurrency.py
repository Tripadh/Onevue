"""Concurrency limiter and overall deadline coordinator for extraction pipeline.

Provides bounded resource management for expensive extraction requests:
1. Concurrency Limiter: Bounds active extraction operations per process
   to MAX_CONCURRENT_EXTRACTIONS.
2. Bounded Queue Timeout: Clients waiting for a concurrency slot time out after
   CONCURRENCY_ACQUIRE_TIMEOUT_SECONDS and are rejected with HTTP 503.
3. Overall Request Deadline: The complete pipeline (PDF extraction, provider
   calls, validation, repair) is bounded by EXTRACTION_DEADLINE_SECONDS.
4. Cancellation Safety: Strict try/finally resource management ensures semaphores
   are never leaked on timeouts, cancellations, or unhandled errors.
5. Graceful Shutdown: Rejects new extraction requests during service shutdown.

Note on Limitations:
The semaphore is process-local. It does not enforce a global cap across
multiple worker processes. Cancellation of an asynchronous task stops awaiting
coroutines, but does not forcibly abort a synchronous thread or external
operation that ignores cancellation (isolated worker processes with wall-clock
timeouts are used for PyMuPDF isolation).
"""

import asyncio
import contextvars
import logging
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.api.errors import ServiceAPIError
from app.config import Settings, get_settings
from app.observability.logging import log_event
from app.schemas.errors import ErrorCode

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Context variable tracking current deadline monotonic timestamp
_DEADLINE_AT: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "extraction_deadline_at", default=None
)


def get_remaining_deadline_seconds() -> float:
    """Return remaining seconds until the active extraction deadline expires.

    Returns:
        Remaining seconds as float, or infinity if no deadline is active.
    """
    deadline_at = _DEADLINE_AT.get()
    if deadline_at is None:
        return float("inf")
    return max(0.0, deadline_at - time.monotonic())


def is_deadline_exceeded() -> bool:
    """Return True if the current request overall deadline has expired."""
    deadline_at = _DEADLINE_AT.get()
    if deadline_at is None:
        return False
    return time.monotonic() >= deadline_at


class ExtractionConcurrencyLimiter:
    """Bounded semaphore and deadline manager for extraction operations."""

    def __init__(
        self,
        max_concurrent: int = 2,
        acquire_timeout_seconds: float = 5.0,
        deadline_seconds: float = 60.0,
    ) -> None:
        """Initialize concurrency limiter.

        Args:
            max_concurrent: Maximum active extractions permitted concurrently.
            acquire_timeout_seconds: Maximum time to wait in queue for an
                extraction slot.
            deadline_seconds: Overall wall-clock deadline for the extraction pipeline.
        """
        if max_concurrent < 1:
            raise ValueError("max_concurrent must be at least 1.")
        if acquire_timeout_seconds <= 0:
            raise ValueError("acquire_timeout_seconds must be positive.")
        if deadline_seconds <= 0:
            raise ValueError("deadline_seconds must be positive.")

        self.max_concurrent = max_concurrent
        self.acquire_timeout_seconds = acquire_timeout_seconds
        self.deadline_seconds = deadline_seconds
        self._semaphore: asyncio.Semaphore | None = None
        self._shutting_down = False

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Lazily initialize asyncio.Semaphore bound to current event loop."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrent)
        return self._semaphore

    def initiate_shutdown(self) -> None:
        """Mark service as shutting down to reject new extractions immediately."""
        self._shutting_down = True

    def reset_shutdown(self) -> None:
        """Reset shutdown state to allow extractions (startup / test reset)."""
        self._shutting_down = False

    async def run(
        self,
        action: Callable[[], Awaitable[T]],
    ) -> T:
        """Execute action under concurrency limits and overall deadline.

        Args:
            action: Async callable performing the extraction pipeline.

        Returns:
            Result of action().

        Raises:
            ServiceAPIError: 503 on shutdown or queue timeout; 504 on deadline exceeded.
            asyncio.CancelledError: Propagated cleanly on client disconnection.
        """
        if self._shutting_down:
            log_event("extraction_rejected_shutting_down")
            raise ServiceAPIError(
                status_code=503,
                code=ErrorCode.PROVIDER_UNAVAILABLE,
                message="Service is shutting down. Please retry later.",
                headers={"Retry-After": "5"},
            )

        sem = self._get_semaphore()
        acquired = False

        # 1. Acquire bounded concurrency slot
        try:
            try:
                await asyncio.wait_for(
                    sem.acquire(),
                    timeout=self.acquire_timeout_seconds,
                )
                acquired = True
            except TimeoutError as exc:
                log_event(
                    "concurrency_limit_exceeded",
                    max_concurrent=self.max_concurrent,
                    acquire_timeout=self.acquire_timeout_seconds,
                )
                logger.warning(
                    "Extraction concurrency slot acquire timed out after %.2fs "
                    "(capacity=%d). Rejecting request with 503.",
                    self.acquire_timeout_seconds,
                    self.max_concurrent,
                )
                raise ServiceAPIError(
                    status_code=503,
                    code=ErrorCode.PROVIDER_UNAVAILABLE,
                    message=(
                        "Service extraction capacity is currently saturated. "
                        "Please retry shortly."
                    ),
                    headers={"Retry-After": "5"},
                ) from exc

            # 2. Enforce overall request deadline
            deadline_at = time.monotonic() + self.deadline_seconds
            token = _DEADLINE_AT.set(deadline_at)

            try:
                return await asyncio.wait_for(
                    action(),
                    timeout=self.deadline_seconds,
                )
            except TimeoutError as exc:
                log_event(
                    "extraction_overall_deadline_exceeded",
                    deadline_seconds=self.deadline_seconds,
                )
                logger.warning(
                    "Extraction operation exceeded overall deadline of %.1fs. "
                    "Aborting request with 504.",
                    self.deadline_seconds,
                )
                raise ServiceAPIError(
                    status_code=504,
                    code=ErrorCode.PROVIDER_UNAVAILABLE,
                    message=(
                        f"Extraction request exceeded the overall deadline of "
                        f"{self.deadline_seconds:.1f}s."
                    ),
                ) from exc
            except asyncio.CancelledError:
                log_event("extraction_request_cancelled_by_client")
                logger.info("Extraction request cancelled by client.")
                raise
            finally:
                _DEADLINE_AT.reset(token)

        finally:
            if acquired:
                sem.release()


# Module-level singleton and accessor
_LIMITER_INSTANCE: ExtractionConcurrencyLimiter | None = None


def get_concurrency_limiter(
    settings: Settings | None = None,
) -> ExtractionConcurrencyLimiter:
    """Return singleton ExtractionConcurrencyLimiter."""
    global _LIMITER_INSTANCE
    if _LIMITER_INSTANCE is None:
        cfg = settings or get_settings()
        _LIMITER_INSTANCE = ExtractionConcurrencyLimiter(
            max_concurrent=cfg.MAX_CONCURRENT_EXTRACTIONS,
            acquire_timeout_seconds=cfg.CONCURRENCY_ACQUIRE_TIMEOUT_SECONDS,
            deadline_seconds=cfg.EXTRACTION_DEADLINE_SECONDS,
        )
    return _LIMITER_INSTANCE


def reset_concurrency_limiter() -> None:
    """Reset singleton concurrency limiter (for testing)."""
    global _LIMITER_INSTANCE
    if _LIMITER_INSTANCE is not None:
        _LIMITER_INSTANCE.reset_shutdown()
    _LIMITER_INSTANCE = None
