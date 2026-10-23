"""Unit tests for NvidiaProvider implementation and contract.

All tests use synthetic resume text and mocked SDK responses without live network calls.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from groq import (
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    RateLimitError,
)

from app.config import Settings
from app.providers.base import (
    LLMProvider,
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderMalformedOutputError,
    ProviderRateLimitError,
    ProviderResult,
    ProviderTimeoutError,
    ProviderUnavailableError,
    TokenUsage,
)
from app.providers.nvidia import NvidiaProvider
from app.schemas.errors import ErrorCode, WarningCode
from app.schemas.llm_draft import ResumeDraft

# ---------------------------------------------------------------------------
# Synthetic test fixtures and helpers
# ---------------------------------------------------------------------------

SYNTHETIC_CLEANED_RESUME = """BOB BUILDER
Senior Cloud Infrastructure Engineer
bob.builder@example.com | (415) 555-0199 | Austin, TX

SUMMARY
Experienced cloud infrastructure engineer specializing in GPU clusters.

EXPERIENCE
CloudScale — Lead Systems Engineer
Jun 2021 - Present | Austin, TX
• Architected scalable Kubernetes GPU clusters for LLM inference.
• Automated node provisioning and health monitoring.

EDUCATION
University of Texas at Austin — B.S. in Electrical Engineering
2017 - 2021 | GPA: 3.9

SKILLS
Python, CUDA, Kubernetes, Terraform, Docker, Linux
"""

SYNTHETIC_VALID_DRAFT_DICT: dict[str, Any] = {
    "profile": {
        "name": "Bob Builder",
        "headline": "Senior Cloud Infrastructure Engineer",
        "email": "bob.builder@example.com",
        "phone": "(415) 555-0199",
        "location": "Austin, TX",
        "summary": "Experienced cloud engineer specializing in GPU clusters.",
    },
    "education": [
        {
            "institution": "University of Texas at Austin",
            "degree": "B.S. in Electrical Engineering",
            "fieldOfStudy": "Electrical Engineering",
            "startDate": "2017",
            "endDate": "2021",
            "grade": "3.9",
        }
    ],
    "experience": [
        {
            "company": "CloudScale",
            "title": "Lead Systems Engineer",
            "location": "Austin, TX",
            "startDate": "Jun 2021",
            "endDate": "Present",
            "isCurrent": True,
            "bullets": [
                "Architected scalable Kubernetes GPU clusters.",
                "Automated node provisioning.",
            ],
        }
    ],
    "skills": [
        {"name": "Python"},
        {"name": "CUDA"},
        {"name": "Kubernetes"},
        {"name": "Terraform"},
    ],
    "projects": [],
    "achievements": [],
    "socialLinks": [],
}


def make_mock_completion_response(
    content_str: str,
    prompt_tokens: int = 150,
    completion_tokens: int = 250,
    total_tokens: int = 400,
    refusal: str | None = None,
) -> MagicMock:
    """Build mock completion response object matching chat completions schema."""
    response = MagicMock()
    message = MagicMock()
    message.content = content_str
    message.refusal = refusal

    choice = MagicMock()
    choice.message = message
    response.choices = [choice]

    usage = MagicMock()
    usage.prompt_tokens = prompt_tokens
    usage.completion_tokens = completion_tokens
    usage.total_tokens = total_tokens
    response.usage = usage

    return response


# ---------------------------------------------------------------------------
# Test Suite
# ---------------------------------------------------------------------------


class TestNvidiaProvider:
    """Comprehensive unit tests for NvidiaProvider."""

    def test_satisfies_llm_provider_protocol(self) -> None:
        """Verify NvidiaProvider satisfies the LLMProvider runtime protocol."""
        provider = NvidiaProvider(
            settings=Settings(
                NVIDIA_API_KEY="nvapi-testkey-1234567890abcdef",
                NVIDIA_MODEL="meta/llama-3.3-70b-instruct",
            )
        )
        assert isinstance(provider, LLMProvider)
        assert provider.name == "nvidia"
        assert provider.model == "meta/llama-3.3-70b-instruct"

    def test_missing_credentials_raises_provider_auth_error(self) -> None:
        """When NVIDIA_API_KEY is unset, client init raises ProviderAuthError."""
        settings = Settings(NVIDIA_API_KEY="")
        provider = NvidiaProvider(settings=settings)

        with pytest.raises(ProviderAuthError) as exc_info:
            provider._get_client()

        assert exc_info.value.code == ErrorCode.PROVIDER_AUTH
        assert "NVIDIA_API_KEY is not configured" in exc_info.value.message
        assert not exc_info.value.retryable

    @pytest.mark.anyio
    async def test_nvidia_provider_success(self) -> None:
        """Test successful extraction with typed ProviderResult and metadata."""
        import json

        content = json.dumps(SYNTHETIC_VALID_DRAFT_DICT)
        mock_response = make_mock_completion_response(content)

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        settings = Settings(
            NVIDIA_API_KEY="nvapi-mock-test-key",
            NVIDIA_MODEL="meta/llama-3.3-70b-instruct",
        )
        provider = NvidiaProvider(settings=settings, client=mock_client)

        result = await provider.extract(SYNTHETIC_CLEANED_RESUME)

        assert isinstance(result, ProviderResult)
        assert result.provider == "nvidia"
        assert result.model == "meta/llama-3.3-70b-instruct"
        assert result.draft.profile.name == "Bob Builder"
        assert result.draft.profile.email == "bob.builder@example.com"
        assert len(result.draft.education) == 1
        assert len(result.draft.experience) == 1
        assert len(result.draft.skills) == 4
        assert result.token_usage == TokenUsage(
            prompt_tokens=150,
            completion_tokens=250,
            total_tokens=400,
        )
        assert result.latency_ms >= 0

        # Verify API call payload
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["model"] == "meta/llama-3.3-70b-instruct"
        assert call_kwargs["response_format"] == {"type": "json_object"}
        assert "guided_json" in call_kwargs.get("extra_body", {})
        assert call_kwargs["temperature"] == 0.0

    @pytest.mark.anyio
    async def test_authentication_failure(self) -> None:
        """Verify AuthenticationError maps to sanitized ProviderAuthError."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=AuthenticationError(
                message="Invalid API Key nvapi-secret-12345",
                response=MagicMock(status_code=401),
                body=None,
            )
        )

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-invalid"),
            client=mock_client,
        )

        with pytest.raises(ProviderAuthError) as exc_info:
            await provider.extract("Sample resume text")

        assert exc_info.value.code == ErrorCode.PROVIDER_AUTH
        assert not exc_info.value.retryable
        # Ensure credentials were not leaked
        assert "nvapi-secret" not in exc_info.value.message

    @pytest.mark.anyio
    async def test_rate_limit_response_and_retry_after(self) -> None:
        """Verify RateLimitError maps to retryable ProviderRateLimitError."""
        mock_client = AsyncMock()
        mock_resp = MagicMock()
        mock_resp.headers = {"retry-after": "5.5"}
        mock_resp.status_code = 429

        mock_client.chat.completions.create = AsyncMock(
            side_effect=RateLimitError(
                message="Rate limit exceeded",
                response=mock_resp,
                body=None,
            )
        )

        slept_times: list[float] = []

        async def fake_sleep(secs: float) -> None:
            slept_times.append(secs)

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key", NVIDIA_MAX_RETRIES=2),
            client=mock_client,
            sleep_func=fake_sleep,
        )

        with pytest.raises(ProviderRateLimitError) as exc_info:
            await provider.extract("Sample resume text")

        assert exc_info.value.code == ErrorCode.PROVIDER_RATE_LIMITED
        assert exc_info.value.retryable
        assert exc_info.value.retry_after_seconds == 5.5
        assert len(slept_times) == 2  # Retried twice before exhausting

    @pytest.mark.anyio
    async def test_timeout_maps_to_provider_timeout_error(self) -> None:
        """Verify APITimeoutError maps to retryable ProviderTimeoutError."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=APITimeoutError(request=MagicMock())
        )

        slept_times: list[float] = []

        async def fake_sleep(secs: float) -> None:
            slept_times.append(secs)

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key", NVIDIA_MAX_RETRIES=1),
            client=mock_client,
            sleep_func=fake_sleep,
        )

        with pytest.raises(ProviderTimeoutError) as exc_info:
            await provider.extract("Sample resume text")

        assert exc_info.value.code == ErrorCode.PROVIDER_UNAVAILABLE
        assert exc_info.value.retryable
        assert len(slept_times) == 1

    @pytest.mark.anyio
    async def test_retry_exhaustion_raises(self) -> None:
        """Verify provider retries up to max_retries then raises."""
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=InternalServerError(
                message="Upstream 500 error",
                response=MagicMock(status_code=500),
                body=None,
            )
        )

        slept_times: list[float] = []

        async def fake_sleep(secs: float) -> None:
            slept_times.append(secs)

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key", NVIDIA_MAX_RETRIES=2),
            client=mock_client,
            sleep_func=fake_sleep,
        )

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.extract("Sample resume text")

        assert exc_info.value.code == ErrorCode.PROVIDER_UNAVAILABLE
        assert (
            mock_client.chat.completions.create.call_count == 3
        )  # 1 initial + 2 retries
        assert len(slept_times) == 2

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "bad_content",
        [
            "",  # Empty
            "   \n\t  ",  # Whitespace
            "Not JSON at all",  # Non-JSON
            '{"unknown": 123}',  # Missing profile
            '{"profile": "not an object"}',  # Schema mismatch
        ],
    )
    async def test_malformed_output_raises_provider_malformed_output_error(
        self, bad_content: str
    ) -> None:
        """Verify invalid or unparseable output maps to ProviderMalformedOutputError."""
        mock_resp = make_mock_completion_response(bad_content)
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key"),
            client=mock_client,
        )

        with pytest.raises(ProviderMalformedOutputError) as exc_info:
            await provider.extract("Resume text")

        assert exc_info.value.code == ErrorCode.INVALID_OUTPUT
        assert not exc_info.value.retryable

    @pytest.mark.anyio
    async def test_empty_choices_raises_malformed_output(self) -> None:
        """Verify empty choices list raises ProviderMalformedOutputError."""
        resp = MagicMock()
        resp.choices = []
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=resp)

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key"),
            client=mock_client,
        )

        with pytest.raises(ProviderMalformedOutputError):
            await provider.extract("Resume text")

    @pytest.mark.anyio
    async def test_model_refusal_raises_malformed_output(self) -> None:
        """Verify safety refusal raises ProviderMalformedOutputError."""
        mock_resp = make_mock_completion_response(
            content_str="I cannot help with this.",
            refusal="Safety refusal triggered.",
        )
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key"),
            client=mock_client,
        )

        with pytest.raises(ProviderMalformedOutputError) as exc_info:
            await provider.extract("Resume text")

        assert exc_info.value.code == ErrorCode.INVALID_OUTPUT

    @pytest.mark.anyio
    async def test_bounded_repair_success(self) -> None:
        """Verify repair method returns corrected ResumeDraft ProviderResult."""
        import json

        content = json.dumps(SYNTHETIC_VALID_DRAFT_DICT)
        mock_resp = make_mock_completion_response(content)
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key"),
            client=mock_client,
        )

        draft = ResumeDraft.model_validate(SYNTHETIC_VALID_DRAFT_DICT)
        issues = ["education[0].endDate earlier than startDate"]

        result = await provider.repair(draft=draft, issues=issues)

        assert isinstance(result, ProviderResult)
        assert result.provider == "nvidia"
        assert result.draft.profile.name == "Bob Builder"

        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert len(messages) == 2
        assert "Validation errors to resolve" in messages[1]["content"]

    @pytest.mark.anyio
    async def test_input_truncation_emits_warning(self) -> None:
        """Verify text exceeding MAX_INPUT_CHARS is truncated and emits warning."""
        import json

        content = json.dumps(SYNTHETIC_VALID_DRAFT_DICT)
        mock_resp = make_mock_completion_response(content)
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_resp)

        settings = Settings(
            NVIDIA_API_KEY="nvapi-key",
            MAX_INPUT_CHARS=100,
        )
        provider = NvidiaProvider(settings=settings, client=mock_client)

        long_text = "This is a very long section of text.\n\n" * 10
        result = await provider.extract(long_text)

        assert len(result.warnings) == 1
        assert result.warnings[0].code == WarningCode.INPUT_TRUNCATED

    @pytest.mark.anyio
    async def test_close_resources(self) -> None:
        """Verify close cleanly closes underlying client resources."""
        mock_client = AsyncMock()
        mock_client.close = AsyncMock()

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY="nvapi-key"),
            client=mock_client,
        )

        await provider.close()
        mock_client.close.assert_awaited_once()
        assert provider._client is None

    def test_zero_network_calls_during_construction_or_import(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Ensure no network calls are initiated during object instantiation."""

        def fail_send(*args: Any, **kwargs: Any) -> Any:
            raise AssertionError("Network access attempted!")

        monkeypatch.setattr("httpx.AsyncClient.send", fail_send)

        provider = NvidiaProvider(
            settings=Settings(
                NVIDIA_API_KEY="nvapi-fake-key",
                NVIDIA_MODEL="meta/llama-3.3-70b-instruct",
            )
        )
        assert provider.model == "meta/llama-3.3-70b-instruct"

    @pytest.mark.anyio
    async def test_no_sensitive_info_in_logs_or_errors(self) -> None:
        """Verify API keys and resume content are never exposed in exceptions."""
        secret_key = "nvapi-supersecret-999988887777"
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(
            side_effect=BadRequestError(
                message=f"Invalid request for key {secret_key}",
                response=MagicMock(status_code=400),
                body=None,
            )
        )

        provider = NvidiaProvider(
            settings=Settings(NVIDIA_API_KEY=secret_key),
            client=mock_client,
        )

        with pytest.raises(ProviderInvalidRequestError) as exc_info:
            await provider.extract("Sensitive candidate resume info")

        assert secret_key not in exc_info.value.message
        assert "Sensitive candidate" not in exc_info.value.message
