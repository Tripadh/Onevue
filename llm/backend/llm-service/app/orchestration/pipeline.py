"""Orchestration pipeline coordinating extraction, validation, repair, and grounding.

Executes modules in strict sequence:
1. Extract raw text and PDF hyperlink annotations.
2. Clean extracted text.
3. Run deterministic rule extraction (emails, phones, URLs).
4. Obtain LLM draft from configured provider.
5. Normalize and validate draft.
6. Perform at most ONE bounded repair if eligible.
7. Ground candidate fields against source text and PDF links.
8. Apply confidence assessment and deterministic field merging.
9. Return final structured ExtractionResponse candidate.
"""

import logging
import time

from app.config import Settings, get_settings
from app.extraction.cleaner import clean_text
from app.extraction.isolated_parser import get_isolated_pdf_parser
from app.extraction.pdf import PyMuPDFParser, extract_pdf
from app.extraction.rules import extract_rule_based_fields
from app.grounding.merger import ground_and_merge
from app.observability.logging import log_event
from app.observability.metrics import (
    record_extraction_request,
    record_provider_call,
)
from app.orchestration.circuit_breaker import get_circuit_breaker
from app.orchestration.concurrency import is_deadline_exceeded
from app.orchestration.fallback import execute_draft_extraction
from app.orchestration.guards import ProcessLocalRateGuard, RequestCallGuard
from app.orchestration.mock import MockProvider
from app.providers.base import LLMProvider, ProviderResult, truncate_input
from app.providers.groq import GroqProvider
from app.providers.nvidia import NvidiaProvider
from app.schemas.errors import WarningCode
from app.schemas.llm_draft import ResumeDraft
from app.schemas.response import (
    ExtractionMeta,
    ExtractionResponse,
    ExtractionWarning,
)
from app.validation.repair import validate_and_repair_draft

logger = logging.getLogger(__name__)


class _GuardedProviderWrapper:
    """Wrapper ensuring subsequent repair calls are bounded by guards."""

    def __init__(
        self,
        inner: LLMProvider,
        guard: RequestCallGuard,
        rate: ProcessLocalRateGuard | None = None,
    ) -> None:
        self._inner = inner
        self._guard = guard
        self._rate = rate
        self.model = getattr(inner, "model", "")
        self.name = getattr(inner, "name", "")

    async def extract(self, text: str) -> ProviderResult:
        if self._rate is not None:
            self._rate.acquire()
        self._guard.record_attempt(self.name or "provider")
        return await self._inner.extract(text)

    async def repair(self, draft: ResumeDraft, issues: list[str]) -> ProviderResult:
        if self._rate is not None:
            self._rate.acquire()
        self._guard.record_attempt(self.name or "provider")
        record_provider_call(provider=self.name or "provider", call_type="repair")
        log_event(
            "repair_attempted",
            provider=self.name or "provider",
            issues_count=len(issues),
        )
        return await self._inner.repair(draft, issues)

    async def close(self) -> None:
        if hasattr(self._inner, "close"):
            await self._inner.close()


async def run_extraction_pipeline(
    pdf_bytes: bytes,
    settings: Settings | None = None,
    provider: LLMProvider | None = None,
    fallback_provider: LLMProvider | None = None,
) -> ExtractionResponse:
    """Execute end-to-end resume extraction pipeline on raw PDF bytes.

    Args:
        pdf_bytes: In-memory bytes of the uploaded PDF document.
        settings: Optional application settings. Defaults to get_settings().
        provider: Optional primary LLMProvider instance. If omitted, uses
            MockProvider (if MOCK_MODE) or GroqProvider.
        fallback_provider: Optional fallback LLMProvider instance (e.g. NvidiaProvider).

    Returns:
        Structured ExtractionResponse containing the candidate profile,
        field metadata, provenance, and warnings.
    """
    settings = settings or get_settings()
    start_time = time.perf_counter()
    accumulated_warnings: list[ExtractionWarning] = []

    # 1. Extract text and PDF hyperlink annotations using isolated parser
    active_pdf_parser = (
        get_isolated_pdf_parser(settings=settings)
        if settings.PDF_PARSER_ISOLATION_ENABLED
        else PyMuPDFParser()
    )
    pdf_result = extract_pdf(
        pdf_bytes,
        parser=active_pdf_parser,
        max_bytes=settings.PDF_MAX_FILE_SIZE_BYTES,
        max_pages=settings.PDF_MAX_PAGES,
        max_text_chars=settings.PDF_MAX_TEXT_CHARS,
    )

    # 2. Clean the extracted text
    cleaned_text = clean_text(pdf_result.text)

    # 3. Deterministic candidate extraction (contact info, links)
    rule_results = extract_rule_based_fields(cleaned_text, links=pdf_result.links)

    # 4. Input truncation check before LLM extraction
    truncated_text, trunc_warning = truncate_input(
        cleaned_text, max_chars=settings.MAX_INPUT_CHARS
    )
    if trunc_warning:
        accumulated_warnings.append(trunc_warning)

    # Resolve providers
    owned_primary = False
    owned_fallback = False

    if provider is None:
        if settings.MOCK_MODE:
            provider = MockProvider()
        else:
            provider = GroqProvider(settings=settings)
            owned_primary = True
            if (
                fallback_provider is None
                and settings.NVIDIA_FALLBACK_ENABLED
                and settings.NVIDIA_API_KEY
                and settings.NVIDIA_API_KEY.strip()
            ):
                fallback_provider = NvidiaProvider(settings=settings)
                owned_fallback = True

    is_mock = isinstance(provider, MockProvider) or (
        getattr(provider, "model", "") == "mock"
    )

    if is_mock:
        accumulated_warnings.append(
            ExtractionWarning(
                path="",
                code=WarningCode.MOCK_DATA,
                message="Extraction executed in mock mode.",
            )
        )

    # Initialize process-local call and rate guards
    call_guard = RequestCallGuard(max_calls=settings.MAX_PROVIDER_CALLS_PER_REQUEST)
    rate_guard = (
        ProcessLocalRateGuard(
            max_requests_per_minute=settings.PROVIDER_RATE_LIMIT_PER_MINUTE,
            enabled=settings.ENABLE_PROCESS_RATE_GUARD,
        )
        if not is_mock and settings.ENABLE_PROCESS_RATE_GUARD
        else None
    )

    try:
        # 4. Obtain LLM draft with eligible fallback orchestration and circuit breaker
        cb = (
            get_circuit_breaker(
                failure_threshold=settings.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
                cooldown_seconds=settings.CIRCUIT_BREAKER_COOLDOWN_SECONDS,
                enabled=settings.CIRCUIT_BREAKER_ENABLED,
            )
            if settings.CIRCUIT_BREAKER_ENABLED and not is_mock
            else None
        )
        exec_result = await execute_draft_extraction(
            text=truncated_text,
            primary_provider=provider,
            fallback_provider=fallback_provider if not is_mock else None,
            call_guard=call_guard,
            rate_guard=rate_guard,
            circuit_breaker=cb,
        )
        draft = exec_result.provider_result.draft
        active_provider = exec_result.active_provider

        # Wrap active provider to bound repair calls (skip if deadline exceeded)
        if is_deadline_exceeded():
            logger.warning(
                "Skipping repair attempt because overall extraction "
                "deadline has expired."
            )
            guarded_repair_provider = None
        else:
            guarded_repair_provider = _GuardedProviderWrapper(
                inner=active_provider,
                guard=call_guard,
                rate=rate_guard,
            )

        # 5 & 6. Normalize, validate, and at most ONE bounded repair if eligible
        val_result = await validate_and_repair_draft(
            draft=draft, provider=guarded_repair_provider
        )
        accumulated_warnings.extend(val_result.warnings)

        # 7 & 8. Ground candidate values and merge with deterministic candidates
        merged_data, field_meta, final_warnings = ground_and_merge(
            data=val_result.data,
            text=cleaned_text,
            links=pdf_result.links,
            rule_results=rule_results,
            pre_existing_warnings=accumulated_warnings,
        )

        # 9. Assemble response envelope with telemetry
        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        final_provider_name = (
            "mock"
            if is_mock
            else getattr(
                active_provider,
                "model",
                getattr(active_provider, "name", settings.GROQ_MODEL),
            )
        )

        meta = ExtractionMeta(
            schemaVersion="1.0.0",
            provider=final_provider_name,
            fallbackUsed=exec_result.fallback_used,
            latencyMs=elapsed_ms,
            mock=is_mock,
            primaryProvider=exec_result.primary_provider_name
            if not is_mock
            else "mock",
            fallbackProvider=exec_result.fallback_provider_name,
            attemptsCount=call_guard.call_count,
            quotaBlocked=False,
        )

        error_payload = val_result.errors[0] if val_result.errors else None

        record_extraction_request(
            status=(
                "success"
                if val_result.status.value in ("success", "partial")
                else "failure"
            ),
            error_code="none" if not error_payload else error_payload.code.value,
        )
        log_event(
            "provider_selected",
            provider=final_provider_name,
            fallback_used=exec_result.fallback_used,
            status=val_result.status.value,
        )

        return ExtractionResponse(
            status=val_result.status,
            data=merged_data,
            fieldMeta=field_meta,
            warnings=final_warnings,
            meta=meta,
            error=error_payload,
        )
    except Exception as exc:
        err_code = getattr(exc, "code", None)
        code_str = err_code.value if hasattr(err_code, "value") else type(exc).__name__
        record_extraction_request(status="failure", error_code=code_str)
        raise
    finally:
        if owned_primary and hasattr(provider, "close"):
            await provider.close()
        if (
            owned_fallback
            and fallback_provider is not None
            and hasattr(fallback_provider, "close")
        ):
            await fallback_provider.close()
