"""Offline tests for scripts/live_check.py.

Guarantees:
- Never makes real network requests or live provider calls.
- Validates operator acknowledgement safety gate.
- Validates missing credentials safety.
- Validates production policy restrictions on NVIDIA.
- Validates call budget (strictly 1 call per provider, zero retries).
- Validates redaction and safe metadata reporting.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.config import Settings
from scripts.live_check import (
    SYNTHETIC_LIVE_CHECK_TEXT,
    check_groq_live,
    check_nvidia_live,
    parse_args,
    run_live_checks,
)


class TestLiveCheckSafetyAndArguments:
    """Test safety gating and argument parsing for live_check.py."""

    def test_missing_acknowledgement_halts_safely(self, capsys):
        """Without flag, execution halts immediately with status 2."""
        args = parse_args([])
        assert args.i_understand_live_calls is False

        # Injected mock should never be called
        mock_client = AsyncMock()
        status = pytest.importorskip("asyncio").run(
            run_live_checks(args, groq_client=mock_client)
        )
        assert status == 2
        mock_client.chat.completions.create.assert_not_called()

        captured = capsys.readouterr()
        assert "[SAFETY HALT]" in captured.err
        assert "--i-understand-live-calls" in captured.err

    def test_argument_parser_defaults(self):
        """Verify CLI argument defaults."""
        args = parse_args(["--i-understand-live-calls"])
        assert args.i_understand_live_calls is True
        assert args.provider == "groq"

        args_all = parse_args(["--i-understand-live-calls", "--provider", "all"])
        assert args_all.provider == "all"

        args_nvidia = parse_args(["--i-understand-live-calls", "--provider", "nvidia"])
        assert args_nvidia.provider == "nvidia"


class TestLiveCheckCredentialAndPolicySafeguards:
    """Test credential requirements and environment-based policy restrictions."""

    @pytest.mark.anyio
    async def test_groq_fails_safely_when_key_missing(self):
        settings = Settings(
            GROQ_API_KEY="",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        mock_client = AsyncMock()
        success, meta = await check_groq_live(settings, injected_client=mock_client)

        assert success is False
        assert meta["category"] == "MISSING_CREDENTIALS"
        mock_client.chat.completions.create.assert_not_called()

    @pytest.mark.anyio
    async def test_nvidia_fails_safely_when_key_missing(self):
        settings = Settings(
            APP_ENV="development",
            NVIDIA_API_KEY="",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        mock_client = AsyncMock()
        success, meta = await check_nvidia_live(settings, injected_client=mock_client)

        assert success is False
        assert meta["category"] == "MISSING_CREDENTIALS"
        mock_client.chat.completions.create.assert_not_called()

    @pytest.mark.anyio
    async def test_nvidia_blocked_in_production_environment(self):
        """NVIDIA live check is blocked in production unless fallback is enabled."""
        prod_settings = Settings(
            APP_ENV="production",
            NVIDIA_API_KEY="nv-key-1234",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )
        assert prod_settings.NVIDIA_FALLBACK_ENABLED is False

        mock_client = AsyncMock()
        success, meta = await check_nvidia_live(
            prod_settings, injected_client=mock_client
        )

        assert success is False
        assert meta["category"] == "PRODUCTION_POLICY_RESTRICTION"
        assert "disabled in production" in meta["message"]
        mock_client.chat.completions.create.assert_not_called()


class TestLiveCheckExecutionAndBudget:
    """Test mock execution, call budget, and safe output formatting."""

    @pytest.mark.anyio
    async def test_groq_successful_live_check_budget_and_redaction(self, capsys):
        settings = Settings(
            GROQ_API_KEY="gsk_secret_canary_key_12345",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )

        mock_choice = MagicMock()
        mock_choice.message.content = (
            '{"profile": {"name": "Jordan Doe", "headline": "Software Engineer", '
            '"email": "jordan.doe@example.com"}, "education": [], "experience": [], '
            '"skills": [{"name": "Python"}], "projects": [], "achievements": [], '
            '"socialLinks": []}'
        )
        mock_usage = MagicMock()
        mock_usage.prompt_tokens = 110
        mock_usage.completion_tokens = 45

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.usage = mock_usage

        mock_client = AsyncMock()
        mock_client.chat.completions.create.return_value = mock_response

        args = parse_args(["--i-understand-live-calls", "--provider", "groq"])
        status = await run_live_checks(args, settings=settings, groq_client=mock_client)

        assert status == 0
        # Hard call budget: strictly 1 call
        assert mock_client.chat.completions.create.call_count == 1

        captured = capsys.readouterr()
        # Verify secret key and canary strings are never printed
        assert "gsk_secret_canary_key_12345" not in captured.out
        assert "gsk_secret_canary_key_12345" not in captured.err
        # Verify synthetic prompt text is not dumped in full
        assert SYNTHETIC_LIVE_CHECK_TEXT not in captured.out
        # Verify success message and safe metadata
        assert "[SUCCESS] GROQ" in captured.out
        assert "Tokens: in=110, out=45" in captured.out
        assert "ALL REQUESTED LIVE CHECKS PASSED" in captured.out

    @pytest.mark.anyio
    async def test_nvidia_successful_live_check_budget(self, capsys):
        settings = Settings(
            APP_ENV="development",
            NVIDIA_API_KEY="nv_secret_canary_67890",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )

        mock_choice = MagicMock()
        mock_choice.message.content = (
            '{"profile": {"name": "Jordan Doe", "headline": "Engineer"}, '
            '"education": [], "experience": [], "skills": [{"name": "Python"}], '
            '"projects": [], "achievements": [], "socialLinks": []}'
        )
        mock_usage = MagicMock()
        mock_usage.prompt_tokens = 95
        mock_usage.completion_tokens = 40

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.usage = mock_usage

        mock_client = AsyncMock()
        mock_client.chat.completions.create.return_value = mock_response

        args = parse_args(["--i-understand-live-calls", "--provider", "nvidia"])
        status = await run_live_checks(
            args, settings=settings, nvidia_client=mock_client
        )

        assert status == 0
        assert mock_client.chat.completions.create.call_count == 1

        captured = capsys.readouterr()
        assert "nv_secret_canary_67890" not in captured.out
        assert "[SUCCESS] NVIDIA" in captured.out

    @pytest.mark.anyio
    async def test_provider_error_handling_and_safe_output(self, capsys):
        settings = Settings(
            GROQ_API_KEY="gsk_secret",
            SERVICE_API_KEYS="sec-key",
            METRICS_TOKEN="test-metrics-token",
        )

        mock_client = AsyncMock()
        mock_client.chat.completions.create.side_effect = ConnectionError(
            "Connection reset by peer with sensitive_token=SECRET"
        )

        args = parse_args(["--i-understand-live-calls", "--provider", "groq"])
        status = await run_live_checks(args, settings=settings, groq_client=mock_client)

        assert status == 1
        assert mock_client.chat.completions.create.call_count == 1

        captured = capsys.readouterr()
        # Ensure sensitive exception content is redacted
        assert "sensitive_token=SECRET" not in captured.out
        assert "sensitive_token=SECRET" not in captured.err
        assert "[FAILED]  GROQ" in captured.out
        assert "API_ERROR" in captured.out
