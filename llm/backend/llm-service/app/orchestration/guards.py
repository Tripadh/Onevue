"""Bounded process-local call guards and rate limits for LLM orchestration.

Provides:
1. RequestCallGuard: Per-request budget bounding provider extraction/repair attempts
   and preventing fallback loops.
2. ProcessLocalRateGuard: In-memory sliding-window request rate limiter.

IMPORTANT ARCHITECTURAL NOTE:
These guards are strictly process-local (in-memory) for the single-process service.
They do NOT synchronize state across multiple Uvicorn worker processes or
distributed deployments. No database, Redis, or shared cache is used.

Zero sensitive information (prompts, API keys, resume text) is ever stored or logged.
"""

import collections
import logging
import threading
import time

from app.observability.logging import log_event
from app.observability.metrics import record_rate_limit_rejection
from app.providers.base import (
    ProviderRateLimitError,
    ProviderUnavailableError,
)

logger = logging.getLogger(__name__)


class RequestCallGuard:
    """Per-request budget guard bounding provider calls and preventing fallback loops.

    Enforces:
    - Maximum total provider invocations per extraction request (e.g. 4 calls).
    - Prevention of cyclical fallback transitions (e.g. Primary -> Fallback -> Primary).
    """

    def __init__(self, max_calls: int = 4) -> None:
        """Initialize guard with a configured call limit.

        Args:
            max_calls: Maximum provider calls permitted for a single request.
        """
        if max_calls < 1:
            raise ValueError("max_calls must be at least 1.")
        self.max_calls = max_calls
        self._call_count: int = 0
        self._history: list[str] = []

    @property
    def call_count(self) -> int:
        """Total number of provider calls executed for this request."""
        return self._call_count

    @property
    def history(self) -> list[str]:
        """Sequence of provider names attempted during this request."""
        return list(self._history)

    def record_attempt(self, provider_id: str) -> None:
        """Record an attempted provider call and check limits and loops.

        Args:
            provider_id: Sanitized provider identifier (e.g. 'groq', 'nvidia').

        Raises:
            ProviderUnavailableError: If call limit is reached or loop is detected.
        """
        if self._call_count >= self.max_calls:
            record_rate_limit_rejection("budget")
            log_event(
                "rate_limit_exceeded",
                level=logging.WARNING,
                guard="request_call_guard",
                max_calls=self.max_calls,
            )
            logger.warning(
                "Request call guard triggered: cap of %d calls reached.",
                self.max_calls,
            )
            raise ProviderUnavailableError(
                f"Request exceeded maximum provider call limit of {self.max_calls}."
            )

        # Detect fallback loops: re-attempting a provider that was previously abandoned
        if self._history:
            last_provider = self._history[-1]
            if provider_id != last_provider and provider_id in self._history:
                logger.warning(
                    "Fallback loop detected: illegal cycle back to '%s'.",
                    provider_id,
                )
                raise ProviderUnavailableError(
                    "Cyclic fallback loop detected: provider transition is disallowed."
                )

        self._history.append(provider_id)
        self._call_count += 1


class ProcessLocalRateGuard:
    """In-memory sliding-window rate limiter for provider calls.

    LIMITATION:
    This guard operates purely in-memory within the current Python process.
    It does not coordinate state across multiple Uvicorn worker processes.
    """

    def __init__(
        self,
        max_requests_per_minute: int = 40,
        window_seconds: float = 60.0,
        enabled: bool = True,
    ) -> None:
        """Initialize sliding window rate limiter.

        Args:
            max_requests_per_minute: Maximum permitted calls within sliding window.
            window_seconds: Duration of the sliding window in seconds (default 60s).
            enabled: Whether the rate guard is active.
        """
        if max_requests_per_minute < 1:
            raise ValueError("max_requests_per_minute must be at least 1.")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive.")

        self.max_requests = max_requests_per_minute
        self.window_seconds = window_seconds
        self.enabled = enabled
        self._timestamps: collections.deque[float] = collections.deque()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        """Attempt to acquire a call slot under the rate limit.

        Fails closed by raising ProviderRateLimitError if the limit is exceeded.

        Raises:
            ProviderRateLimitError: If current rate exceeds configured limits.
        """
        if not self.enabled:
            return

        with self._lock:
            now = time.monotonic()
            cutoff = now - self.window_seconds

            # Prune expired timestamps
            while self._timestamps and self._timestamps[0] <= cutoff:
                self._timestamps.popleft()

            if len(self._timestamps) >= self.max_requests:
                oldest = self._timestamps[0]
                retry_after = max(1.0, round(oldest + self.window_seconds - now, 2))
                record_rate_limit_rejection("process_local")
                log_event(
                    "rate_limit_exceeded",
                    level=logging.WARNING,
                    guard="process_local",
                    max_requests=self.max_requests,
                    retry_after_seconds=retry_after,
                )
                logger.warning(
                    "Process-local rate guard limit (%d req/%ds) reached. "
                    "Failing closed with retry_after=%.2fs.",
                    self.max_requests,
                    int(self.window_seconds),
                    retry_after,
                )
                raise ProviderRateLimitError(
                    message="Process-local provider call rate limit exceeded.",
                    retry_after_seconds=retry_after,
                )

            self._timestamps.append(now)

    def reset(self) -> None:
        """Reset all tracked timestamps (useful for testing)."""
        with self._lock:
            self._timestamps.clear()
