"""Application entrypoint for ONEVUE LLM Service."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.errors import ServiceAPIError
from app.api.routes import router
from app.config import get_settings
from app.extraction.pdf import PDFExtractionError
from app.observability.logging import setup_logging
from app.observability.middleware import ObservabilityMiddleware
from app.orchestration.lifecycle import (
    perform_graceful_shutdown,
    warn_multi_worker_if_detected,
)
from app.providers.base import ProviderException
from app.schemas.errors import ErrorCode, StructuredError

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_application: FastAPI):
    """Manage application startup checks and graceful shutdown sequence."""
    settings = get_settings()
    # Startup: Reset shutdown state and check multi-worker configuration
    from app.extraction.isolated_parser import get_isolated_pdf_parser
    from app.orchestration.circuit_breaker import get_circuit_breaker
    from app.orchestration.concurrency import get_concurrency_limiter

    get_concurrency_limiter(settings).reset_shutdown()
    get_isolated_pdf_parser(settings).reset_shutdown()
    get_circuit_breaker().reset()
    warn_multi_worker_if_detected(settings)
    yield
    # Shutdown: Stop accepting new extractions and terminate isolated workers
    logger.info("Initiating graceful shutdown for ONEVUE LLM Service...")
    perform_graceful_shutdown(settings)
    get_circuit_breaker().reset()
    logger.info("Graceful shutdown completed.")


def get_custom_openapi(application: FastAPI) -> dict:
    """Generate OpenAPI specification with security schemes and grounded examples."""
    if application.openapi_schema:
        return application.openapi_schema

    openapi_schema = get_openapi(
        title=application.title,
        version=application.version,
        openapi_version=application.openapi_version,
        description=application.description,
        routes=application.routes,
    )

    # 1. Define Server-to-Server Security Schemes
    components = openapi_schema.setdefault("components", {})
    components["securitySchemes"] = {
        "ApiKeyAuth": {
            "type": "apiKey",
            "in": "header",
            "name": "X-API-Key",
            "description": (
                "Server-to-server service API key for ONEVUE LLM Service. "
                "Rotatable across active keys in SERVICE_API_KEYS."
            ),
        },
        "MetricsTokenAuth": {
            "type": "http",
            "scheme": "bearer",
            "description": (
                "Bearer token or X-Metrics-Token header for protected "
                "Prometheus metrics. Must match configured METRICS_TOKEN."
            ),
        },
    }

    # 2. Attach security requirements to protected endpoints
    paths = openapi_schema.get("paths", {})
    if "/v1/extract" in paths and "post" in paths["/v1/extract"]:
        paths["/v1/extract"]["post"]["security"] = [{"ApiKeyAuth": []}]

    if "/metrics" in paths and "get" in paths["/metrics"]:
        paths["/metrics"]["get"]["security"] = [{"MetricsTokenAuth": []}]

    # 3. Enrich schema examples with synthetic data grounded in actual contracts
    schemas = components.get("schemas", {})

    if "StructuredError" in schemas:
        schemas["StructuredError"]["example"] = {
            "code": "INVALID_FILE",
            "message": "Invalid file upload. Only .pdf files are supported.",
        }

    if "HealthResponse" in schemas:
        schemas["HealthResponse"]["example"] = {
            "status": "ok",
            "service": "onevue-llm-service",
            "version": "1.0.0",
        }

    if "ReadinessResponse" in schemas:
        schemas["ReadinessResponse"]["example"] = {
            "status": "ready",
            "ready": True,
            "service": "onevue-llm-service",
            "checks": {
                "configuration": "ok",
                "provider": "ok",
                "mock_mode": "false",
            },
        }

    if "VersionResponse" in schemas:
        schemas["VersionResponse"]["example"] = {
            "service": "onevue-llm-service",
            "version": "1.0.0",
            "commit_sha": None,
            "environment": "development",
        }

    if "RootResponse" in schemas:
        schemas["RootResponse"]["example"] = {
            "service": "onevue-llm-service",
            "version": "1.0.0",
            "message": (
                "ONEVUE LLM Service is operational. "
                "Refer to /docs for interactive API documentation."
            ),
            "docs_url": "/docs",
            "openapi_url": "/openapi.json",
        }

    if "ExtractionResponse" in schemas:
        schemas["ExtractionResponse"]["example"] = {
            "status": "ok",
            "data": {
                "profile": {
                    "name": "Jordan Doe",
                    "headline": "Full-Stack Software Engineer",
                    "email": "jordan.doe.synthetic@example.com",
                    "phone": "+1-555-019-2831",
                    "location": "San Francisco, CA",
                    "summary": (
                        "Full-stack engineer with 4+ years of experience "
                        "in distributed microservices."
                    ),
                },
                "education": [
                    {
                        "institution": "State University of Technology",
                        "degree": "B.S. Computer Science",
                        "fieldOfStudy": "Computer Science",
                        "startDate": "2016-08",
                        "endDate": "2020-05",
                        "grade": "3.8 GPA",
                    }
                ],
                "experience": [
                    {
                        "company": "Acme Innovations Inc.",
                        "title": "Software Engineer",
                        "location": "San Francisco, CA",
                        "startDate": "2020-06",
                        "endDate": None,
                        "isCurrent": True,
                        "bullets": [
                            (
                                "Engineered distributed REST APIs handling "
                                "high throughput."
                            ),
                            ("Implemented asynchronous background pipeline workers."),
                        ],
                    }
                ],
                "skills": [
                    {"name": "Python"},
                    {"name": "FastAPI"},
                    {"name": "TypeScript"},
                    {"name": "PostgreSQL"},
                    {"name": "Docker"},
                ],
                "projects": [
                    {
                        "name": "Cloud Observability Dashboard",
                        "description": (
                            "Real-time metrics visualization platform "
                            "for distributed services."
                        ),
                        "technologies": ["Python", "React", "Prometheus"],
                        "links": [
                            "https://github.com/example-synthetic/cloud-dashboard"
                        ],
                    }
                ],
                "achievements": [
                    {
                        "title": "Hackathon First Place Winner",
                        "description": (
                            "Awarded first place for cloud automation tooling project."
                        ),
                    }
                ],
                "socialLinks": [
                    {
                        "platform": "github",
                        "url": "https://github.com/example-synthetic",
                    },
                    {
                        "platform": "linkedin",
                        "url": "https://linkedin.com/in/example-synthetic",
                    },
                ],
            },
            "fieldMeta": {
                "profile.name": {
                    "confidence": "high",
                    "grounded": True,
                    "source": "llm",
                    "alternatives": [],
                    "grounding_status": "grounded",
                    "evidence": ["Jordan Doe"],
                },
                "profile.email": {
                    "confidence": "high",
                    "grounded": True,
                    "source": "rules",
                    "alternatives": [],
                    "grounding_status": "grounded",
                    "evidence": ["jordan.doe.synthetic@example.com"],
                },
            },
            "warnings": [],
            "meta": {
                "schemaVersion": "1.0.0",
                "provider": "llama-3.3-70b-versatile",
                "fallbackUsed": False,
                "latencyMs": 1420,
                "mock": False,
                "primaryProvider": "groq",
                "fallbackProvider": None,
                "attemptsCount": 1,
                "quotaBlocked": False,
            },
            "error": None,
        }

    application.openapi_schema = openapi_schema
    return application.openapi_schema


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    settings = get_settings()
    setup_logging(log_level=settings.LOG_LEVEL)

    application = FastAPI(
        title="ONEVUE LLM Service",
        description=(
            "Microservice responsible for LLM resume extraction "
            "and portfolio synthesis."
        ),
        version=settings.SERVICE_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # Middleware: Request Correlation, Structured Logging & Prometheus Metrics
    application.add_middleware(ObservabilityMiddleware)

    # -----------------------------------------------------------------------
    # Exception Handlers: Sanitized, Structured JSON Errors
    # -----------------------------------------------------------------------

    @application.exception_handler(ServiceAPIError)
    async def service_api_error_handler(
        _request: Request, exc: ServiceAPIError
    ) -> JSONResponse:
        logger.warning("API error occurred: %s", exc.code.value)
        headers = getattr(exc, "headers", None)
        return JSONResponse(
            status_code=exc.status_code,
            headers=headers,
            content=StructuredError(
                code=exc.code,
                message=exc.message,
            ).model_dump(),
        )

    @application.exception_handler(PDFExtractionError)
    async def pdf_extraction_error_handler(
        _request: Request, exc: PDFExtractionError
    ) -> JSONResponse:
        logger.warning("PDF extraction error: %s", exc.code.value)
        status_code = 400
        if exc.code == ErrorCode.FILE_TOO_LARGE:
            status_code = 413
        elif exc.code in (
            ErrorCode.TOO_MANY_PAGES,
            ErrorCode.ENCRYPTED_PDF,
            ErrorCode.SCANNED_PDF,
        ):
            status_code = 422
        elif exc.code == ErrorCode.INVALID_FILE:
            status_code = 400

        return JSONResponse(
            status_code=status_code,
            content=StructuredError(
                code=exc.code,
                message=exc.message,
            ).model_dump(),
        )

    @application.exception_handler(ProviderException)
    async def provider_exception_handler(
        _request: Request, exc: ProviderException
    ) -> JSONResponse:
        logger.error("Provider error: %s", exc.code.value)
        status_code = 502
        if exc.code == ErrorCode.PROVIDER_AUTH:
            status_code = 502
        elif exc.code == ErrorCode.PROVIDER_RATE_LIMITED:
            status_code = 429
        elif exc.code == ErrorCode.PROVIDER_UNAVAILABLE:
            status_code = 503
        elif exc.code == ErrorCode.INVALID_OUTPUT:
            status_code = 502
        elif exc.code == ErrorCode.INTERNAL:
            status_code = 500

        return JSONResponse(
            status_code=status_code,
            content=StructuredError(
                code=exc.code,
                message=exc.message,
            ).model_dump(),
        )

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        logger.warning("Request validation error: %s", type(exc).__name__)
        return JSONResponse(
            status_code=400,
            content=StructuredError(
                code=ErrorCode.INVALID_FILE,
                message=(
                    "Missing or invalid request payload. A PDF file upload is required."
                ),
            ).model_dump(),
        )

    @application.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        _request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        logger.warning("HTTP exception: %d", exc.status_code)
        code = ErrorCode.INTERNAL
        if exc.status_code == 401:
            code = ErrorCode.UNAUTHORIZED
        elif exc.status_code in (400, 415):
            code = ErrorCode.INVALID_FILE
        elif exc.status_code == 413:
            code = ErrorCode.FILE_TOO_LARGE
        elif exc.status_code == 422:
            code = ErrorCode.INVALID_FILE

        msg = str(exc.detail) if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            status_code=exc.status_code,
            content=StructuredError(
                code=code,
                message=msg,
            ).model_dump(),
        )

    @application.exception_handler(Exception)
    async def unhandled_exception_handler(
        _request: Request, exc: Exception
    ) -> JSONResponse:
        logger.error("Unhandled internal exception: %s", type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content=StructuredError(
                code=ErrorCode.INTERNAL,
                message="An unexpected internal server error occurred.",
            ).model_dump(),
        )

    application.include_router(router)
    application.openapi = lambda: get_custom_openapi(application)
    return application


app = create_app()
