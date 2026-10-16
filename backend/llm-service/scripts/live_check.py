"""Manual-only live provider connectivity and structured-output validation script.

SAFETY REQUIREMENTS:
- Never executes automatically during test suites or package imports.
- Requires explicit command-line acknowledgement (--i-understand-live-calls).
- Enforces a hard budget of exactly ONE request per selected provider per run.
- Zero personal information, real resume data, or sensitive files are used.
- Never prints credentials, prompts, raw responses, or stack traces.
- Respects production restrictions on NVIDIA provider usage.
- Exits with non-zero status upon failure.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from typing import Any

# Ensure project root is on sys.path when invoked directly
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_CURRENT_DIR)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from app.config import Settings, get_settings  # noqa: E402
from app.providers.base import (  # noqa: E402
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderMalformedOutputError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from app.schemas.llm_draft import (  # noqa: E402
    ResumeDraft,
    get_provider_draft_schema,
)

SYNTHETIC_LIVE_CHECK_TEXT = (
    "Candidate: Jordan Doe\n"
    "Title: Software Engineer\n"
    "Contact: jordan.doe.synthetic@example.com | (555) 019-2831\n"
    "Location: Seattle, WA\n"
    "Skills: Python, TypeScript, Docker\n"
    "Experience: Software Engineer at Acme Corp (2021 - Present)\n"
    "- Built microservices handling structured data pipelines."
)


def _categorize_error(exc: Exception) -> str:
    """Map exception to a safe, low-cardinality category name."""
    exc_type = type(exc).__name__.lower()
    if isinstance(exc, ProviderAuthError) or "auth" in exc_type:
        return "AUTH_FAILURE"
    if isinstance(exc, ProviderTimeoutError) or "timeout" in exc_type:
        return "TIMEOUT"
    if isinstance(exc, ProviderRateLimitError) or "ratelimit" in exc_type:
        return "RATE_LIMIT"
    if isinstance(exc, ProviderUnavailableError) or "unavailable" in exc_type:
        return "UNAVAILABLE"
    if isinstance(exc, ProviderMalformedOutputError) or "malformed" in exc_type:
        return "MALFORMED_OUTPUT"
    if isinstance(exc, ProviderInvalidRequestError) or "badrequest" in exc_type:
        return "INVALID_REQUEST"
    return "API_ERROR"


async def check_groq_live(
    settings: Settings,
    injected_client: Any | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Execute exactly one structured-output request to Groq.

    Hard call budget: exactly 1 request, 0 retries.
    """
    start_time = time.perf_counter()
    api_key = settings.GROQ_API_KEY

    if not api_key or not api_key.strip():
        return False, {
            "provider": "groq",
            "category": "MISSING_CREDENTIALS",
            "message": "GROQ_API_KEY is not configured",
            "elapsed_ms": 0.0,
        }

    try:
        from groq import AsyncGroq

        client = injected_client or AsyncGroq(
            api_key=api_key,
            base_url=settings.GROQ_BASE_URL,
            timeout=float(min(settings.GROQ_REQUEST_TIMEOUT_SECONDS, 15.0)),
            max_retries=0,
        )

        model = settings.GROQ_MODEL

        # Strict or JSON Object completion with 1 hard-capped attempt
        completion = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract structured resume data conforming to schema. "
                        "Return only valid JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": SYNTHETIC_LIVE_CHECK_TEXT,
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        if not completion.choices or not completion.choices[0].message.content:
            return False, {
                "provider": "groq",
                "category": "EMPTY_RESPONSE",
                "model": model,
                "elapsed_ms": round(elapsed_ms, 2),
            }

        raw_content = completion.choices[0].message.content
        data = json.loads(raw_content)
        ResumeDraft.model_validate(data)

        usage = getattr(completion, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", None) if usage else None
        completion_tokens = getattr(usage, "completion_tokens", None) if usage else None

        return True, {
            "provider": "groq",
            "category": "SUCCESS",
            "model": model,
            "elapsed_ms": round(elapsed_ms, 2),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        }

    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        return False, {
            "provider": "groq",
            "category": _categorize_error(exc),
            "elapsed_ms": round(elapsed_ms, 2),
        }


async def check_nvidia_live(
    settings: Settings,
    injected_client: Any | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Execute exactly one structured-output request to NVIDIA NIM / API Catalog.

    Respects production fallback safety: rejected if APP_ENV=production and
    NVIDIA_FALLBACK_ENABLED is False.
    Hard call budget: exactly 1 request, 0 retries.
    """
    start_time = time.perf_counter()

    # Production safety check
    if settings.APP_ENV == "production" and not settings.NVIDIA_FALLBACK_ENABLED:
        return False, {
            "provider": "nvidia",
            "category": "PRODUCTION_POLICY_RESTRICTION",
            "message": (
                "NVIDIA provider is disabled in production environment "
                "(NVIDIA_FALLBACK_ENABLED is False)."
            ),
            "elapsed_ms": 0.0,
        }

    api_key = settings.NVIDIA_API_KEY
    if not api_key or not api_key.strip():
        return False, {
            "provider": "nvidia",
            "category": "MISSING_CREDENTIALS",
            "message": "NVIDIA_API_KEY is not configured",
            "elapsed_ms": 0.0,
        }

    try:
        from groq import AsyncGroq

        client = injected_client or AsyncGroq(
            api_key=api_key,
            base_url=settings.NVIDIA_BASE_URL,
            timeout=float(min(settings.NVIDIA_REQUEST_TIMEOUT_SECONDS, 15.0)),
            max_retries=0,
        )

        schema = get_provider_draft_schema(ResumeDraft)
        model = settings.NVIDIA_MODEL

        completion = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract structured resume data conforming to schema. "
                        "Return only valid JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": SYNTHETIC_LIVE_CHECK_TEXT,
                },
            ],
            response_format={"type": "json_object"},
            extra_body={"guided_json": schema},
            temperature=0.0,
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        if not completion.choices or not completion.choices[0].message.content:
            return False, {
                "provider": "nvidia",
                "category": "EMPTY_RESPONSE",
                "model": model,
                "elapsed_ms": round(elapsed_ms, 2),
            }

        raw_content = completion.choices[0].message.content
        data = json.loads(raw_content)
        ResumeDraft.model_validate(data)

        usage = getattr(completion, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", None) if usage else None
        completion_tokens = getattr(usage, "completion_tokens", None) if usage else None

        return True, {
            "provider": "nvidia",
            "category": "SUCCESS",
            "model": model,
            "elapsed_ms": round(elapsed_ms, 2),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        }

    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        return False, {
            "provider": "nvidia",
            "category": _categorize_error(exc),
            "elapsed_ms": round(elapsed_ms, 2),
        }


def parse_args(args: list[str] | None = None) -> argparse.Namespace:
    """Parse command line arguments for live check script."""
    parser = argparse.ArgumentParser(
        description=(
            "ONEVUE manual live provider connectivity and structured output check."
        )
    )
    parser.add_argument(
        "--i-understand-live-calls",
        action="store_true",
        default=False,
        help=(
            "MANDATORY: Explicit acknowledgement that this script makes real, "
            "billed network requests to remote LLM provider APIs."
        ),
    )
    parser.add_argument(
        "--provider",
        choices=["groq", "nvidia", "all"],
        default="groq",
        help="Provider to verify (groq, nvidia, or all). Default: groq.",
    )
    return parser.parse_args(args)


async def run_live_checks(
    args: argparse.Namespace,
    settings: Settings | None = None,
    groq_client: Any | None = None,
    nvidia_client: Any | None = None,
) -> int:
    """Execute live checks based on parsed arguments."""
    if not args.i_understand_live_calls:
        sys.stderr.write(
            "\n[SAFETY HALT] Live provider checks require explicit operator "
            "acknowledgement.\n"
            "Pass '--i-understand-live-calls' to confirm you intend to invoke "
            "live provider APIs.\n"
            "Exiting safely without making any network requests.\n\n"
        )
        return 2

    cfg = settings or get_settings()
    providers_to_check: list[str] = []
    if args.provider in ("groq", "all"):
        providers_to_check.append("groq")
    if args.provider in ("nvidia", "all"):
        providers_to_check.append("nvidia")

    print("\n" + "=" * 65)
    print(" ONEVUE LLM SERVICE — MANUAL PROVIDER CONNECTIVITY LIVE CHECK")
    print("=" * 65)
    print(f" Environment    : {cfg.APP_ENV}")
    print(f" Selected Target: {', '.join(providers_to_check)}")
    print(" Call Budget    : Exactly 1 request per provider (no retries)")
    print(" Content        : 100% synthetic text (zero personal data)")
    print("-" * 65)

    all_passed = True

    for p in providers_to_check:
        if p == "groq":
            success, meta = await check_groq_live(cfg, injected_client=groq_client)
        else:
            success, meta = await check_nvidia_live(cfg, injected_client=nvidia_client)

        if not success:
            all_passed = False
            cat = meta.get("category", "ERROR")
            elapsed = meta.get("elapsed_ms", 0.0)
            msg = meta.get("message", "")
            details = f" - {msg}" if msg else ""
            print(
                f" [FAILED]  {p.upper():<7} | Result: {cat} ({elapsed:.1f}ms){details}"
            )
        else:
            model = meta.get("model", "unknown")
            elapsed = meta.get("elapsed_ms", 0.0)
            p_tok = meta.get("prompt_tokens")
            c_tok = meta.get("completion_tokens")
            tok_info = (
                f" | Tokens: in={p_tok}, out={c_tok}" if p_tok is not None else ""
            )
            print(
                f" [SUCCESS] {p.upper():<7} | Model: {model} | "
                f"Duration: {elapsed:.1f}ms{tok_info}"
            )

    print("=" * 65)
    if all_passed:
        print(" SUMMARY: ALL REQUESTED LIVE CHECKS PASSED.")
    else:
        print(" SUMMARY: ONE OR MORE LIVE CHECKS FAILED.")
    print("=" * 65)
    print(
        " WARNING:\n"
        " A successful check demonstrates basic API reachability and valid\n"
        " JSON schema emission on minimal synthetic text. It does NOT guarantee\n"
        " extraction accuracy, schema grounding, or production suitability on\n"
        " complex or unstructured resumes.\n"
    )
    print(
        " NOTICE:\n"
        " Provider terms of service, data processing agreements, and commercial\n"
        " licensing must be independently verified by the operator prior to\n"
        " production deployment. Connectivity != legal compliance.\n"
        "=================================================================\n"
    )

    return 0 if all_passed else 1


def main() -> int:
    """Script entry point."""
    args = parse_args()
    return asyncio.run(run_live_checks(args))


if __name__ == "__main__":
    sys.exit(main())
