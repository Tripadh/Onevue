"""Tests for Phase 15 upstream provider circuit breaker and fallback safety."""

import time

from app.config import Settings
from app.orchestration.circuit_breaker import (
    CircuitBreakerState,
    ProviderCircuitBreaker,
)
from app.providers.base import (
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderMalformedOutputError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)


class TestProviderCircuitBreaker:
    """Test ProviderCircuitBreaker states, thresholding, single probe recovery,
    and error filtering.
    """

    def test_initial_state_closed(self):
        cb = ProviderCircuitBreaker(
            failure_threshold=3,
            cooldown_seconds=10.0,
        )
        assert cb.get_state("groq") == CircuitBreakerState.CLOSED
        assert cb.can_execute("groq") is True

    def test_transient_failures_trip_circuit_to_open(self):
        cb = ProviderCircuitBreaker(
            failure_threshold=3,
            cooldown_seconds=10.0,
        )
        # 1st failure: remains closed
        cb.record_failure("groq", ProviderTimeoutError("Request timed out"))
        assert cb.get_state("groq") == CircuitBreakerState.CLOSED
        assert cb.can_execute("groq") is True

        # 2nd failure: remains closed
        cb.record_failure("groq", ProviderUnavailableError("503 Server Error"))
        assert cb.get_state("groq") == CircuitBreakerState.CLOSED
        assert cb.can_execute("groq") is True

        # 3rd failure: trips to OPEN
        cb.record_failure("groq", ProviderRateLimitError("429 Too Many Requests"))
        assert cb.get_state("groq") == CircuitBreakerState.OPEN
        assert cb.can_execute("groq") is False

    def test_permanent_errors_do_not_trip_circuit(self):
        cb = ProviderCircuitBreaker(
            failure_threshold=2,
            cooldown_seconds=10.0,
        )
        # Auth errors, invalid requests, malformed output are permanent / client errors
        cb.record_failure("groq", ProviderAuthError("Invalid API key"))
        cb.record_failure("groq", ProviderInvalidRequestError("Bad request parameter"))
        cb.record_failure("groq", ProviderMalformedOutputError("Invalid JSON returned"))
        cb.record_failure("groq", ValueError("Client input validation failure"))

        # Circuit must remain CLOSED
        assert cb.get_state("groq") == CircuitBreakerState.CLOSED
        assert cb.can_execute("groq") is True

    def test_success_resets_failure_count(self):
        cb = ProviderCircuitBreaker(
            failure_threshold=3,
            cooldown_seconds=10.0,
        )
        cb.record_failure("groq", ProviderTimeoutError("timeout 1"))
        cb.record_failure("groq", ProviderTimeoutError("timeout 2"))

        # Success resets failure count
        cb.record_success("groq")

        # Next failure is 1st again, does not trip
        cb.record_failure("groq", ProviderTimeoutError("timeout 3"))
        assert cb.get_state("groq") == CircuitBreakerState.CLOSED

    def test_cooldown_and_single_recovery_probe_in_half_open(self):
        cb = ProviderCircuitBreaker(
            failure_threshold=2,
            cooldown_seconds=0.1,  # Short cooldown for test
        )
        cb.record_failure("groq", ProviderTimeoutError("timeout 1"))
        cb.record_failure("groq", ProviderTimeoutError("timeout 2"))
        assert cb.get_state("groq") == CircuitBreakerState.OPEN
        assert cb.can_execute("groq") is False

        # Wait for cooldown to expire
        time.sleep(0.15)

        # Transition to HALF_OPEN: 1st caller acquires probe permission
        assert cb.can_execute("groq") is True
        assert cb.get_state("groq") == CircuitBreakerState.HALF_OPEN

        # 2nd concurrent caller is rejected while probe is active
        assert cb.can_execute("groq") is False

        # Probe succeeds -> resets to CLOSED
        cb.record_success("groq")
        assert cb.get_state("groq") == CircuitBreakerState.CLOSED
        assert cb.can_execute("groq") is True

    def test_failed_recovery_probe_reopens_circuit(self):
        cb = ProviderCircuitBreaker(
            failure_threshold=2,
            cooldown_seconds=0.1,
        )
        cb.record_failure("groq", ProviderTimeoutError("t1"))
        cb.record_failure("groq", ProviderTimeoutError("t2"))

        time.sleep(0.15)
        # Probe acquired
        assert cb.can_execute("groq") is True
        assert cb.get_state("groq") == CircuitBreakerState.HALF_OPEN

        # Probe fails
        cb.record_failure("groq", ProviderUnavailableError("probe failed"))
        assert cb.get_state("groq") == CircuitBreakerState.OPEN
        assert cb.can_execute("groq") is False

    def test_providers_tracked_independently(self):
        cb = ProviderCircuitBreaker(
            failure_threshold=2,
            cooldown_seconds=10.0,
        )
        cb.record_failure("groq", ProviderTimeoutError("groq 1"))
        cb.record_failure("groq", ProviderTimeoutError("groq 2"))

        # groq is OPEN, but nvidia is CLOSED
        assert cb.can_execute("groq") is False
        assert cb.can_execute("nvidia") is True


class TestNvidiaFallbackPolicy:
    """Test NVIDIA_FALLBACK_ENABLED configuration and production safety defaults."""

    def test_nvidia_fallback_disabled_by_default_in_production(self):
        prod_settings = Settings(
            APP_ENV="production",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert prod_settings.NVIDIA_FALLBACK_ENABLED is False

    def test_nvidia_fallback_enabled_by_default_in_dev_and_test(self):
        dev_settings = Settings(
            APP_ENV="development",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert dev_settings.NVIDIA_FALLBACK_ENABLED is True

    def test_operator_explicit_override_in_production(self):
        prod_override = Settings(
            APP_ENV="production",
            NVIDIA_FALLBACK_ENABLED=True,
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert prod_override.NVIDIA_FALLBACK_ENABLED is True
