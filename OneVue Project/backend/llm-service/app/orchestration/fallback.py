"""Fallback policy and orchestration coordinating primary and fallback providers.

Rules & Eligibility Policy:
- Primary Provider: Groq (default).
- Fallback Provider: NVIDIA (NIM / OpenAI-compatible API Catalog).

Eligibility Policy:
- ELIGIBLE for Fallback:
  1. ProviderTimeoutError: Network connection drops, timeouts, gateway timeouts.
  2. ProviderUnavailableError: Upstream 5xx server outages, temporary service failures.
  3. ProviderRateLimitError: Primary rate limits (HTTP 429) retries exhausted.

- STRICTLY INELIGIBLE for Fallback (fails immediately without calling NVIDIA):
  1. ProviderAuthError: Missing or invalid credentials (config error).
  2. ProviderInvalidRequestError: Malformed request or schema (client error).
  3. ProviderMalformedOutputError: JSON decode or schema validation error.
  4. PDFExtractionError: Document issues (corrupted, encrypted, scanned).
  5. User cancellation or general internal non-retryable conditions.

Zero credentials, prompts, or resume text are ever logged or exposed.
"""

import logging
from dataclasses import dataclass

from app.observability.logging import log_event
from app.observability.metrics import (
    record_provider_call,
    record_provider_failure,
    record_provider_fallback,
    record_provider_timeout,
)
from app.orchestration.circuit_breaker import (
    ProviderCircuitBreaker,
)
from app.orchestration.concurrency import is_deadline_exceeded
from app.orchestration.guards import ProcessLocalRateGuard, RequestCallGuard
from app.providers.base import (
    LLMProvider,
    ProviderAuthError,
    ProviderException,
    ProviderInvalidRequestError,
    ProviderMalformedOutputError,
    ProviderRateLimitError,
    ProviderResult,
    ProviderTimeoutError,
    ProviderUnavailableError,
)

logger = logging.getLogger(__name__)


def _categorize_provider_exception(exc: Exception) -> str:
    """Map provider exception to safe low-cardinality category."""
    if isinstance(exc, ProviderTimeoutError):
        return "timeout"
    if isinstance(exc, ProviderAuthError):
        return "auth"
    if isinstance(exc, ProviderRateLimitError):
        return "rate_limit"
    if isinstance(exc, ProviderUnavailableError):
        return "unavailable"
    if isinstance(exc, ProviderInvalidRequestError):
        return "invalid_request"
    if isinstance(exc, ProviderMalformedOutputError):
        return "malformed_output"
    if isinstance(exc, ProviderException):
        return "internal"
    return "unknown"


def is_fallback_eligible(exc: Exception) -> bool:
    """Determine whether a primary provider exception is eligible for NVIDIA fallback.

    Args:
        exc: Exception raised by the primary extraction provider.

    Returns:
        True if the failure is an eligible transient network or service outage.
        False if the failure is ineligible (auth, bad request, malformed output).
    """
    # Explicit exclusions
    if isinstance(
        exc,
        (
            ProviderAuthError,
            ProviderInvalidRequestError,
            ProviderMalformedOutputError,
        ),
    ):
        return False

    # Explicit inclusions
    if isinstance(
        exc,
        (
            ProviderTimeoutError,
            ProviderUnavailableError,
            ProviderRateLimitError,
        ),
    ):
        return True

    return False


def _get_provider_identifier(provider: LLMProvider, default: str) -> str:
    """Extract clean provider name or model identifier safely."""
    name = getattr(provider, "name", None)
    if name:
        return str(name)
    model = getattr(provider, "model", None)
    if model:
        return str(model)
    return default


@dataclass(frozen=True)
class ExtractionExecutionResult:
    """Outcome of provider execution including fallback and telemetry metadata."""

    provider_result: ProviderResult
    active_provider: LLMProvider
    primary_provider_name: str
    fallback_provider_name: str | None
    fallback_used: bool
    fallback_attempted: bool
    attempts_count: int


async def execute_draft_extraction(
    text: str,
    primary_provider: LLMProvider,
    fallback_provider: LLMProvider | None = None,
    call_guard: RequestCallGuard | None = None,
    rate_guard: ProcessLocalRateGuard | None = None,
    circuit_breaker: ProviderCircuitBreaker | None = None,
) -> ExtractionExecutionResult:
    """Execute resume draft extraction with primary provider and eligible fallback.

    Integrates circuit breaker protection:
    - If primary circuit is OPEN, calls are not dispatched to primary.
    - If eligible fallback is configured, fallback is attempted.
    - If both circuits are OPEN or both providers fail, raises ProviderUnavailableError.
    - Respects overall request deadlines, aborting without retry if deadline expired.

    Args:
        text: Cleaned and truncated resume source text.
        primary_provider: Primary LLM provider (e.g. GroqProvider).
        fallback_provider: Optional fallback LLM provider (e.g. NvidiaProvider).
        call_guard: Optional per-request budget and loop guard.
        rate_guard: Optional process-local rate guard.
        circuit_breaker: Optional injected ProviderCircuitBreaker instance.

    Returns:
        ExtractionExecutionResult with provider result and safe telemetry.

    Raises:
        ProviderException: If primary fails ineligibly or both providers fail.
    """
    guard = call_guard or RequestCallGuard()
    cb = circuit_breaker
    primary_id = _get_provider_identifier(primary_provider, "primary")
    fallback_id = (
        _get_provider_identifier(fallback_provider, "fallback")
        if fallback_provider is not None
        else None
    )

    # 1. Check if primary circuit is open
    primary_circuit_open = False
    if cb is not None:
        primary_circuit_open = not cb.can_execute(primary_id)

    if primary_circuit_open:
        logger.warning(
            "Circuit breaker is OPEN for primary provider '%s'. "
            "Bypassing primary call.",
            primary_id,
        )
        record_provider_failure(provider=primary_id, error_category="unavailable")
        if fallback_provider is None:
            raise ProviderUnavailableError(
                f"Primary provider '{primary_id}' circuit breaker is OPEN "
                "and no fallback provider is available."
            )
        # Fallback is available: record transition
        record_provider_fallback(primary=primary_id, fallback=fallback_id)
        log_event(
            "provider_fallback",
            primary_provider=primary_id,
            fallback_provider=fallback_id,
            error_category="circuit_open",
        )
    else:
        # Check deadline before invoking primary
        if is_deadline_exceeded():
            raise ProviderTimeoutError(
                "Overall extraction deadline expired before primary provider call."
            )

        # Attempt primary provider
        if rate_guard is not None:
            rate_guard.acquire()
        guard.record_attempt(primary_id)
        record_provider_call(provider=primary_id, call_type="extract")

        try:
            res = await primary_provider.extract(text)
            if cb is not None:
                cb.record_success(primary_id)
            return ExtractionExecutionResult(
                provider_result=res,
                active_provider=primary_provider,
                primary_provider_name=primary_id,
                fallback_provider_name=None,
                fallback_used=False,
                fallback_attempted=False,
                attempts_count=guard.call_count,
            )
        except Exception as exc:
            if cb is not None:
                cb.record_failure(primary_id, exc)
            err_cat = _categorize_provider_exception(exc)
            record_provider_failure(provider=primary_id, error_category=err_cat)
            if err_cat == "timeout":
                record_provider_timeout(provider=primary_id)

            eligible = is_fallback_eligible(exc)
            if not eligible:
                logger.info(
                    "Primary provider '%s' failed with ineligible error %s. "
                    "Fallback will not be attempted.",
                    primary_id,
                    type(exc).__name__,
                )
                raise

            if fallback_provider is None:
                logger.warning(
                    "Primary provider '%s' failed with eligible error %s, "
                    "but no fallback provider is available.",
                    primary_id,
                    type(exc).__name__,
                )
                raise

            record_provider_fallback(primary=primary_id, fallback=fallback_id)
            log_event(
                "provider_fallback",
                primary_provider=primary_id,
                fallback_provider=fallback_id,
                error_category=err_cat,
            )
            logger.warning(
                "Primary provider '%s' failed with eligible error %s. "
                "Activating fallback provider '%s'.",
                primary_id,
                type(exc).__name__,
                fallback_id,
            )

    # 2. Attempt fallback provider
    assert fallback_provider is not None
    assert fallback_id is not None

    # Check overall deadline before invoking fallback
    if is_deadline_exceeded():
        raise ProviderTimeoutError(
            "Overall extraction deadline expired before fallback provider call."
        )

    # Check fallback circuit breaker
    if cb is not None and not cb.can_execute(fallback_id):
        logger.warning(
            "Circuit breaker is OPEN for fallback provider '%s'. "
            "Both providers unavailable.",
            fallback_id,
        )
        record_provider_failure(provider=fallback_id, error_category="unavailable")
        raise ProviderUnavailableError(
            f"Fallback provider '{fallback_id}' circuit breaker is OPEN. "
            "Both providers are unavailable."
        )

    if rate_guard is not None:
        rate_guard.acquire()
    guard.record_attempt(fallback_id)
    record_provider_call(provider=fallback_id, call_type="extract")

    try:
        fb_res = await fallback_provider.extract(text)
        if cb is not None:
            cb.record_success(fallback_id)
        return ExtractionExecutionResult(
            provider_result=fb_res,
            active_provider=fallback_provider,
            primary_provider_name=primary_id,
            fallback_provider_name=fallback_id,
            fallback_used=True,
            fallback_attempted=True,
            attempts_count=guard.call_count,
        )
    except Exception as fb_exc:
        if cb is not None:
            cb.record_failure(fallback_id, fb_exc)
        fb_err_cat = _categorize_provider_exception(fb_exc)
        record_provider_failure(provider=fallback_id, error_category=fb_err_cat)
        if fb_err_cat == "timeout":
            record_provider_timeout(provider=fallback_id)
        logger.error(
            "Fallback provider '%s' also failed with error %s. Both providers failed.",
            fallback_id,
            type(fb_exc).__name__,
        )
        if isinstance(fb_exc, ProviderException):
            raise fb_exc
        raise ProviderUnavailableError(
            "Both primary and fallback providers failed."
        ) from fb_exc
