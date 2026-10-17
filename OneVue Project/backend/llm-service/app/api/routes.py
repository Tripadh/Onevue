"""API routes for ONEVUE LLM Service."""

import logging
import secrets
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel

from app.api.auth import verify_api_key
from app.api.errors import ServiceAPIError
from app.config import Settings, get_settings
from app.extraction.pdf import PDFExtractionError
from app.observability.metrics import get_metrics_text
from app.orchestration.concurrency import get_concurrency_limiter
from app.orchestration.mock import MockProvider
from app.orchestration.pipeline import run_extraction_pipeline
from app.providers.base import LLMProvider, ProviderException
from app.providers.groq import GroqProvider
from app.schemas.errors import ErrorCode, StructuredError
from app.schemas.response import ExtractionResponse

logger = logging.getLogger(__name__)

router = APIRouter()


class HealthResponse(BaseModel):
    """Schema for health check response."""

    status: str
    service: str
    version: str


class ReadinessResponse(BaseModel):
    """Schema for readiness check response."""

    status: str
    ready: bool
    service: str
    checks: dict[str, str]


class VersionResponse(BaseModel):
    """Schema for service version response."""

    service: str
    version: str
    commit_sha: str | None
    environment: str


class RootResponse(BaseModel):
    """Schema for service root response."""

    service: str
    version: str
    message: str
    docs_url: str
    openapi_url: str


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health Check",
    description="Returns operational status and version without exposing secrets.",
)
def health_check() -> HealthResponse:
    """Return service health status."""
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service=settings.SERVICE_NAME,
        version=settings.SERVICE_VERSION,
    )


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    responses={
        200: {"description": "Service is ready to accept requests."},
        503: {"description": "Service is unconfigured or unavailable."},
    },
    summary="Readiness Check",
    description=(
        "Verifies whether the service has the local configuration and initialized "
        "components required to accept requests. Does not perform live provider calls. "
        "Readiness is not proof that external provider APIs are reachable."
    ),
)
def readiness_check(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReadinessResponse:
    """Check whether service has local credentials to accept requests."""
    has_service_key = bool(settings.effective_service_api_key)
    has_provider = bool(
        settings.MOCK_MODE or (settings.GROQ_API_KEY and settings.GROQ_API_KEY.strip())
    )
    is_ready = has_service_key and has_provider

    checks = {
        "configuration": "ok" if has_service_key else "missing_service_key",
        "provider": "ok" if has_provider else "missing_provider_credentials",
        "mock_mode": "true" if settings.MOCK_MODE else "false",
    }

    if not is_ready:
        response.status_code = 503
        return ReadinessResponse(
            status="unavailable",
            ready=False,
            service=settings.SERVICE_NAME,
            checks=checks,
        )

    return ReadinessResponse(
        status="ready",
        ready=True,
        service=settings.SERVICE_NAME,
        checks=checks,
    )


@router.get(
    "/version",
    response_model=VersionResponse,
    summary="Service Version",
    description=(
        "Returns service version and runtime metadata. Git commit SHA is returned "
        "only when available from runtime/build configuration; otherwise null."
    ),
)
def version_info(
    settings: Annotated[Settings, Depends(get_settings)],
) -> VersionResponse:
    """Return service version and build commit metadata."""
    commit_sha = (
        settings.GIT_COMMIT_SHA.strip()
        if settings.GIT_COMMIT_SHA and settings.GIT_COMMIT_SHA.strip()
        else None
    )
    return VersionResponse(
        service=settings.SERVICE_NAME,
        version=settings.SERVICE_VERSION,
        commit_sha=commit_sha,
        environment=settings.ENVIRONMENT,
    )


@router.get(
    "/metrics",
    summary="Protected Prometheus Metrics",
    description=(
        "Returns low-cardinality Prometheus metrics in text format. "
        "Protected by METRICS_TOKEN. Disabled if METRICS_TOKEN is unset."
    ),
    responses={
        200: {
            "description": (
                "Low-cardinality operational metrics in Prometheus text format."
            ),
            "content": {"text/plain; version=0.0.4; charset=utf-8": {}},
        },
        401: {
            "model": StructuredError,
            "description": "Missing or invalid metrics authentication token.",
        },
        404: {
            "model": StructuredError,
            "description": "Metrics endpoint is disabled (METRICS_TOKEN unset).",
        },
    },
)
def get_metrics(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    """Return operational metrics in Prometheus exposition format."""
    configured_token = settings.METRICS_TOKEN.strip() if settings.METRICS_TOKEN else ""
    if not configured_token:
        # Fail closed: disable endpoint when token is unset without exposing config
        raise HTTPException(
            status_code=404,
            detail="Metrics endpoint is disabled.",
        )

    # Validate authorization token from Authorization: Bearer <token> or X-Metrics-Token
    auth_header = request.headers.get("Authorization", "").strip()
    x_token_header = request.headers.get("X-Metrics-Token", "").strip()

    provided_token = ""
    if auth_header.lower().startswith("bearer "):
        provided_token = auth_header[7:].strip()
    elif x_token_header:
        provided_token = x_token_header

    # Forbid service API credentials from authenticating to metrics endpoint
    for service_key in settings.effective_service_api_keys:
        if secrets.compare_digest(provided_token, service_key):
            raise HTTPException(
                status_code=401,
                detail="Missing or invalid metrics authentication token.",
            )

    if not provided_token or not secrets.compare_digest(
        provided_token, configured_token
    ):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid metrics authentication token.",
        )

    return Response(
        content=get_metrics_text(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@router.get(
    "/",
    response_model=RootResponse,
    summary="Service Information",
    description="Identifies service and directs clients to interactive documentation.",
)
def root() -> RootResponse:
    """Return root service identification and documentation links."""
    settings = get_settings()
    return RootResponse(
        service=settings.SERVICE_NAME,
        version=settings.SERVICE_VERSION,
        message=(
            "ONEVUE LLM Service is operational. "
            "Refer to /docs for interactive API documentation."
        ),
        docs_url="/docs",
        openapi_url="/openapi.json",
    )


def get_provider(
    settings: Annotated[Settings, Depends(get_settings)],
) -> LLMProvider:
    """Provide configured extraction provider based on settings."""
    if settings.MOCK_MODE:
        return MockProvider()
    return GroqProvider(settings=settings)


def get_fallback_provider(
    settings: Annotated[Settings, Depends(get_settings)],
) -> LLMProvider | None:
    """Provide configured fallback extraction provider based on settings."""
    if settings.MOCK_MODE:
        return None
    if not settings.NVIDIA_FALLBACK_ENABLED:
        return None
    if not settings.NVIDIA_API_KEY or not settings.NVIDIA_API_KEY.strip():
        return None
    from app.providers.nvidia import NvidiaProvider

    return NvidiaProvider(settings=settings)


@router.post(
    "/v1/extract",
    response_model=ExtractionResponse,
    responses={
        200: {
            "model": ExtractionResponse,
            "description": (
                "Structured extraction candidate profile. The status field indicates "
                "whether extraction completed cleanly ('ok') or with "
                "partial normalization ('partial')."
            ),
        },
        400: {
            "model": StructuredError,
            "description": "Invalid file upload, empty payload, or PDF parser failure.",
        },
        401: {
            "model": StructuredError,
            "description": "Missing, invalid, or unconfigured service API key.",
        },
        413: {
            "model": StructuredError,
            "description": "Uploaded PDF exceeds maximum allowed file size.",
        },
        422: {
            "model": StructuredError,
            "description": (
                "Unprocessable document (exceeds page limit, encrypted, "
                "or scanned PDF)."
            ),
        },
        429: {
            "model": StructuredError,
            "description": "Provider rate limit or process-local rate guard reached.",
        },
        500: {
            "model": StructuredError,
            "description": "Unexpected internal server error.",
        },
        502: {
            "model": StructuredError,
            "description": (
                "Upstream provider credential failure or malformed provider response."
            ),
        },
        503: {
            "model": StructuredError,
            "description": (
                "Upstream provider unavailable, circuit breaker open, "
                "or concurrency queue timeout."
            ),
        },
        504: {
            "model": StructuredError,
            "description": "Extraction deadline exceeded.",
        },
    },
    summary="Extract Resume Profile",
    description=(
        "Extracts structured resume candidate profile from an uploaded PDF document. "
        "Requires X-API-Key authentication."
    ),
)
async def extract_resume(
    file: Annotated[UploadFile | None, File()] = None,
    _api_key: Annotated[str, Depends(verify_api_key)] = "",
    settings: Annotated[Settings, Depends(get_settings)] = None,
    provider: Annotated[LLMProvider, Depends(get_provider)] = None,
    fallback_provider: Annotated[
        LLMProvider | None, Depends(get_fallback_provider)
    ] = None,
) -> ExtractionResponse:
    """Upload a PDF resume document and receive a structured extraction candidate."""
    # 1. Require an uploaded file with .pdf extension
    if file is None or not file.filename:
        raise ServiceAPIError(
            status_code=400,
            code=ErrorCode.INVALID_FILE,
            message="Missing file upload. A PDF file must be provided.",
        )

    clean_filename = file.filename.strip()
    if len(clean_filename) > 255 or not clean_filename.lower().endswith(".pdf"):
        raise ServiceAPIError(
            status_code=400,
            code=ErrorCode.INVALID_FILE,
            message="Invalid file upload. Only .pdf files are supported.",
        )

    max_bytes = settings.PDF_MAX_FILE_SIZE_BYTES

    # Early rejection if file size header is already known
    if file.size is not None:
        if file.size == 0:
            raise ServiceAPIError(
                status_code=400,
                code=ErrorCode.INVALID_FILE,
                message="The uploaded PDF file is empty.",
            )
        if file.size > max_bytes:
            raise ServiceAPIError(
                status_code=413,
                code=ErrorCode.FILE_TOO_LARGE,
                message=(
                    f"PDF file size ({file.size} bytes) exceeds maximum "
                    f"allowed limit of {max_bytes} bytes."
                ),
            )

    # 2. Chunked read with strict maximum file size enforcement
    chunk_size = 64 * 1024  # 64 KB
    chunks: list[bytes] = []
    total_bytes = 0

    try:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                raise ServiceAPIError(
                    status_code=413,
                    code=ErrorCode.FILE_TOO_LARGE,
                    message=(
                        f"PDF file size ({total_bytes} bytes) exceeds maximum "
                        f"allowed limit of {max_bytes} bytes."
                    ),
                )
            chunks.append(chunk)
    finally:
        await file.close()

    if total_bytes == 0:
        raise ServiceAPIError(
            status_code=400,
            code=ErrorCode.INVALID_FILE,
            message="The uploaded PDF file is empty.",
        )

    pdf_bytes = b"".join(chunks)

    # 3. Delegate to orchestration pipeline under concurrency and deadline limits
    try:
        limiter = get_concurrency_limiter(settings=settings)
        return await limiter.run(
            lambda: run_extraction_pipeline(
                pdf_bytes=pdf_bytes,
                settings=settings,
                provider=provider,
                fallback_provider=fallback_provider,
            )
        )
    except (ServiceAPIError, PDFExtractionError, ProviderException):
        raise
    except Exception as exc:
        logger.error("Unexpected error in extract_resume: %s", type(exc).__name__)
        raise ServiceAPIError(
            status_code=500,
            code=ErrorCode.INTERNAL,
            message="An unexpected internal server error occurred.",
        ) from exc
