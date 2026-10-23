"""Provider abstractions, result contracts, and typed exceptions for LLM integration.

All provider implementations must adhere to the LLMProvider protocol and
return structured ProviderResult instances. Sensitive data (prompts, raw resume
text, credentials) is strictly prevented from leaking into error messages or metadata.
"""

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.errors import ErrorCode, WarningCode
from app.schemas.llm_draft import ResumeDraft
from app.schemas.response import ExtractionWarning


class TokenUsage(BaseModel):
    """Token consumption metrics reported by an LLM provider."""

    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int | None = Field(
        default=None, description="Number of tokens in the input prompt."
    )
    completion_tokens: int | None = Field(
        default=None, description="Number of tokens in the generated completion."
    )
    total_tokens: int | None = Field(
        default=None, description="Total tokens consumed by the request."
    )


class ProviderResult(BaseModel):
    """Typed result returned by an LLM extraction provider."""

    model_config = ConfigDict(extra="forbid")

    draft: ResumeDraft = Field(
        description="Validated raw draft extracted by the provider."
    )
    provider: str = Field(description="Unique provider identifier (e.g. 'groq').")
    model: str = Field(description="Model identifier used for the request.")
    latency_ms: int = Field(
        ge=0, description="Measured request latency in milliseconds."
    )
    token_usage: TokenUsage | None = Field(
        default=None, description="Token consumption metrics if reported by API."
    )
    warnings: list[ExtractionWarning] = Field(
        default_factory=list,
        description="Non-fatal warnings encountered during extraction preparation.",
    )


# ---------------------------------------------------------------------------
# Provider Exceptions Contract
# ---------------------------------------------------------------------------


class ProviderException(Exception):
    """Base exception for all LLM provider failures.

    Attributes:
        code: ErrorCode enum value identifying the failure category.
        message: Sanitized error description without credentials or raw content.
        retryable: Whether this failure is considered transient and safe to retry.
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class ProviderAuthError(ProviderException):
    """Authentication or authorization failure (e.g., missing or invalid API key).

    Non-retryable.
    """

    def __init__(
        self,
        message: str = "Provider authentication failed. Check configured API key.",
    ) -> None:
        super().__init__(
            code=ErrorCode.PROVIDER_AUTH,
            message=message,
            retryable=False,
        )


class ProviderRateLimitError(ProviderException):
    """Rate limit exceeded (HTTP 429).

    Retryable. May include retry_after_seconds if reported by provider.
    """

    def __init__(
        self,
        message: str = "Provider rate limit exceeded.",
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(
            code=ErrorCode.PROVIDER_RATE_LIMITED,
            message=message,
            retryable=True,
        )
        self.retry_after_seconds = retry_after_seconds


class ProviderTimeoutError(ProviderException):
    """Network timeout or connection failure during provider call.

    Retryable.
    """

    def __init__(
        self,
        message: str = "Provider request timed out or connection failed.",
    ) -> None:
        super().__init__(
            code=ErrorCode.PROVIDER_UNAVAILABLE,
            message=message,
            retryable=True,
        )


class ProviderUnavailableError(ProviderException):
    """Temporary upstream service unavailability or 5xx server error.

    Retryable.
    """

    def __init__(
        self,
        message: str = "Provider service is temporarily unavailable.",
    ) -> None:
        super().__init__(
            code=ErrorCode.PROVIDER_UNAVAILABLE,
            message=message,
            retryable=True,
        )


class ProviderInvalidRequestError(ProviderException):
    """Invalid request, unsupported schema configuration, or client 4xx error.

    Non-retryable.
    """

    def __init__(
        self,
        message: str = "Provider rejected request as invalid.",
    ) -> None:
        super().__init__(
            code=ErrorCode.INTERNAL,
            message=message,
            retryable=False,
        )


class ProviderMalformedOutputError(ProviderException):
    """Model response was missing, not valid JSON, or failed schema validation.

    Non-retryable in this phase (bounded repair belongs to Phase 6).
    """

    def __init__(
        self,
        message: str = (
            "Model response was missing, malformed, or failed draft schema validation."
        ),
    ) -> None:
        super().__init__(
            code=ErrorCode.INVALID_OUTPUT,
            message=message,
            retryable=False,
        )


# ---------------------------------------------------------------------------
# Input Truncation Helper
# ---------------------------------------------------------------------------


def truncate_input(text: str, max_chars: int) -> tuple[str, ExtractionWarning | None]:
    """Enforce MAX_INPUT_CHARS conservatively without mutating original input.

    If text exceeds max_chars, it attempts to truncate at a paragraph boundary
    (\\n\\n) or line break (\\n) within the safe tail of the window (80%-100%).
    If no clean boundary exists, it truncates at max_chars deterministically.

    Returns:
        tuple of (processed_text, optional_warning)
    """
    if len(text) <= max_chars:
        return text, None

    window = text[:max_chars]
    safe_search_start = int(max_chars * 0.8)

    # 1. Attempt paragraph boundary
    last_double_newline = window.rfind("\n\n", safe_search_start)
    if last_double_newline != -1:
        cut_point = last_double_newline
    else:
        # 2. Attempt line break boundary
        last_single_newline = window.rfind("\n", safe_search_start)
        if last_single_newline != -1:
            cut_point = last_single_newline
        else:
            # 3. Deterministic boundary at max_chars
            cut_point = max_chars

    truncated_text = text[:cut_point].rstrip()

    warning = ExtractionWarning(
        path="",
        code=WarningCode.INPUT_TRUNCATED,
        message=(
            f"Input text exceeded configured limit of {max_chars} characters and was "
            "truncated at a clean boundary."
        ),
    )
    return truncated_text, warning


# ---------------------------------------------------------------------------
# Provider Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class LLMProvider(Protocol):
    """Asynchronous interface for LLM extraction providers."""

    async def extract(self, text: str) -> ProviderResult:
        """Extract candidate resume fields from cleaned text asynchronously."""
        ...

    async def repair(self, draft: ResumeDraft, issues: list[str]) -> ProviderResult:
        """Attempt a bounded repair of an invalid ResumeDraft."""
        ...

    async def close(self) -> None:
        """Close underlying client resources cleanly."""
        ...
