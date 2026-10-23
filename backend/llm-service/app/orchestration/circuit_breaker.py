"""In-memory, thread-safe circuit breaker protecting upstream LLM providers.

Implements finite-state circuit breaker per provider:
- CLOSED: Normal operation. Bounded consecutive transient failures trigger OPEN.
- OPEN: Outage protection. Outgoing calls are blocked immediately; fallback is used
  if available and eligible.
- HALF_OPEN: Controlled recovery. After cooldown_seconds, allows exactly ONE recovery
  probe request. Concurrent requests are blocked from probing simultaneously.

Only genuine transient provider failures (timeouts, 5xx server errors,
429 rate limits) count toward the failure threshold. Permanent errors
(auth failure, invalid client request, malformed output) never trip the
circuit breaker.
"""

import logging
import threading
import time
from enum import StrEnum

from app.observability.logging import log_event
from app.providers.base import (
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderMalformedOutputError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)

logger = logging.getLogger(__name__)


class CircuitBreakerState(StrEnum):
    """Enumeration of circuit breaker states."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


def is_transient_provider_error(exc: Exception) -> bool:
    """Return True if exception represents an eligible transient provider outage."""
    if isinstance(
        exc,
        (
            ProviderAuthError,
            ProviderInvalidRequestError,
            ProviderMalformedOutputError,
        ),
    ):
        return False

    return isinstance(
        exc,
        (
            ProviderTimeoutError,
            ProviderUnavailableError,
            ProviderRateLimitError,
        ),
    )


class _ProviderCircuitState:
    """Internal mutable state tracked for a single provider."""

    def __init__(self) -> None:
        self.state: CircuitBreakerState = CircuitBreakerState.CLOSED
        self.consecutive_failures: int = 0
        self.opened_at: float = 0.0
        self.probe_in_flight: bool = False


class ProviderCircuitBreaker:
    """Thread-safe circuit breaker managing upstream provider health."""

    def __init__(
        self,
        failure_threshold: int = 3,
        cooldown_seconds: float = 30.0,
        enabled: bool = True,
    ) -> None:
        """Initialize provider circuit breaker.

        Args:
            failure_threshold: Number of consecutive transient failures before opening.
            cooldown_seconds: Cooldown duration before attempting recovery probe.
            enabled: Master switch. If False, circuit is always effectively CLOSED.
        """
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be at least 1.")
        if cooldown_seconds <= 0:
            raise ValueError("cooldown_seconds must be positive.")

        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.enabled = enabled
        self._providers: dict[str, _ProviderCircuitState] = {}
        self._lock = threading.Lock()

    def _get_provider_state(self, provider_id: str) -> _ProviderCircuitState:
        """Retrieve or initialize internal state for a provider."""
        key = provider_id.lower().strip()
        if key not in self._providers:
            self._providers[key] = _ProviderCircuitState()
        return self._providers[key]

    def can_execute(self, provider_id: str) -> bool:
        """Check whether a request is permitted to call the provider.

        In HALF_OPEN state, permits exactly ONE recovery probe at a time.
        Concurrent requests receive False until the probe resolves.

        Args:
            provider_id: Provider name (e.g. 'groq', 'nvidia').

        Returns:
            True if call is permitted, False if circuit is OPEN or probe in flight.
        """
        if not self.enabled:
            return True

        with self._lock:
            state = self._get_provider_state(provider_id)
            now = time.monotonic()

            if state.state == CircuitBreakerState.CLOSED:
                return True

            if state.state == CircuitBreakerState.OPEN:
                # Check whether cooldown period has elapsed
                if (now - state.opened_at) >= self.cooldown_seconds:
                    logger.info(
                        "Circuit breaker cooldown elapsed for '%s'. "
                        "Entering HALF_OPEN state with single recovery probe.",
                        provider_id,
                    )
                    state.state = CircuitBreakerState.HALF_OPEN
                    state.probe_in_flight = True
                    log_event(
                        "circuit_breaker_half_open",
                        provider=provider_id,
                    )
                    return True
                return False

            if state.state == CircuitBreakerState.HALF_OPEN:
                if not state.probe_in_flight:
                    state.probe_in_flight = True
                    return True
                # A recovery probe is already in flight; reject concurrent calls
                return False

            return True

    def record_success(self, provider_id: str) -> None:
        """Record successful execution, resetting circuit to CLOSED.

        Args:
            provider_id: Provider name.
        """
        if not self.enabled:
            return

        with self._lock:
            state = self._get_provider_state(provider_id)
            previous_state = state.state
            state.consecutive_failures = 0
            state.probe_in_flight = False
            state.state = CircuitBreakerState.CLOSED

            if previous_state in (
                CircuitBreakerState.OPEN,
                CircuitBreakerState.HALF_OPEN,
            ):
                logger.info(
                    "Circuit breaker CLOSED for provider '%s' after "
                    "successful recovery probe.",
                    provider_id,
                )
                log_event(
                    "circuit_breaker_closed",
                    provider=provider_id,
                    recovered_from=previous_state.value,
                )

    def record_failure(self, provider_id: str, exc: Exception) -> None:
        """Record provider failure and transition state if threshold is reached.

        Only counts transient errors. In HALF_OPEN state, any transient error
        immediately reverts the circuit to OPEN.

        Args:
            provider_id: Provider name.
            exc: Exception raised during provider execution.
        """
        if not self.enabled:
            return

        # Permanent errors do not trip the circuit breaker
        if not is_transient_provider_error(exc):
            with self._lock:
                state = self._get_provider_state(provider_id)
                if state.state == CircuitBreakerState.HALF_OPEN:
                    state.probe_in_flight = False
            return

        with self._lock:
            state = self._get_provider_state(provider_id)
            now = time.monotonic()

            if state.state == CircuitBreakerState.HALF_OPEN:
                # Recovery probe failed: re-open circuit immediately
                state.state = CircuitBreakerState.OPEN
                state.opened_at = now
                state.probe_in_flight = False
                logger.warning(
                    "Circuit breaker recovery probe failed for provider '%s'. "
                    "Re-opening circuit for %.1fs cooldown.",
                    provider_id,
                    self.cooldown_seconds,
                )
                log_event(
                    "circuit_breaker_probe_failed",
                    provider=provider_id,
                    error_type=type(exc).__name__,
                )
                return

            if state.state == CircuitBreakerState.CLOSED:
                state.consecutive_failures += 1
                if state.consecutive_failures >= self.failure_threshold:
                    state.state = CircuitBreakerState.OPEN
                    state.opened_at = now
                    state.probe_in_flight = False
                    logger.warning(
                        "Circuit breaker OPENED for provider '%s' after %d "
                        "consecutive transient failures. Cooldown is %.1fs.",
                        provider_id,
                        state.consecutive_failures,
                        self.cooldown_seconds,
                    )
                    log_event(
                        "circuit_breaker_opened",
                        provider=provider_id,
                        consecutive_failures=state.consecutive_failures,
                        cooldown_seconds=self.cooldown_seconds,
                    )

    def get_state(self, provider_id: str) -> CircuitBreakerState:
        """Return the current circuit breaker state for a provider."""
        with self._lock:
            state = self._get_provider_state(provider_id)
            if state.state == CircuitBreakerState.OPEN:
                if (time.monotonic() - state.opened_at) >= self.cooldown_seconds:
                    return CircuitBreakerState.HALF_OPEN
            return state.state

    def reset(self, provider_id: str | None = None) -> None:
        """Reset circuit breaker state (for testing)."""
        with self._lock:
            if provider_id is not None:
                key = provider_id.lower().strip()
                if key in self._providers:
                    self._providers[key] = _ProviderCircuitState()
            else:
                self._providers.clear()


# Module-level singleton and accessor
_CIRCUIT_BREAKER_INSTANCE: ProviderCircuitBreaker | None = None
_CB_LOCK = threading.Lock()


def get_circuit_breaker(
    failure_threshold: int | None = None,
    cooldown_seconds: float | None = None,
    enabled: bool | None = None,
) -> ProviderCircuitBreaker:
    """Return singleton ProviderCircuitBreaker instance."""
    global _CIRCUIT_BREAKER_INSTANCE
    with _CB_LOCK:
        if _CIRCUIT_BREAKER_INSTANCE is None:
            from app.config import get_settings

            cfg = get_settings()
            _CIRCUIT_BREAKER_INSTANCE = ProviderCircuitBreaker(
                failure_threshold=(
                    failure_threshold
                    if failure_threshold is not None
                    else cfg.CIRCUIT_BREAKER_FAILURE_THRESHOLD
                ),
                cooldown_seconds=(
                    cooldown_seconds
                    if cooldown_seconds is not None
                    else cfg.CIRCUIT_BREAKER_COOLDOWN_SECONDS
                ),
                enabled=(
                    enabled if enabled is not None else cfg.CIRCUIT_BREAKER_ENABLED
                ),
            )
        return _CIRCUIT_BREAKER_INSTANCE


def reset_circuit_breaker() -> None:
    """Reset the singleton circuit breaker instance (for testing)."""
    global _CIRCUIT_BREAKER_INSTANCE
    with _CB_LOCK:
        if _CIRCUIT_BREAKER_INSTANCE is not None:
            _CIRCUIT_BREAKER_INSTANCE.reset()
            _CIRCUIT_BREAKER_INSTANCE = None
