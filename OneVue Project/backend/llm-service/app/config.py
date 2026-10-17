"""Configuration settings for ONEVUE LLM Service."""

from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service Metadata
    SERVICE_NAME: str = "onevue-llm-service"
    SERVICE_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    GIT_COMMIT_SHA: str | None = None
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    LOG_LEVEL: str = "info"

    # Observability and Protected Metrics
    METRICS_TOKEN: str = ""

    # Optional Error Reporting (Disabled by default)
    ERROR_REPORTING_ENABLED: bool = False
    SENTRY_DSN: str = ""

    # Service Security & API Key Rotation
    SERVICE_API_KEYS: str = ""
    LLM_SERVICE_API_KEY: str = ""
    SERVICE_API_KEY: str = ""

    @property
    def effective_service_api_keys(self) -> tuple[str, ...]:
        """Return tuple of valid service API keys with strict precedence.

        Precedence rule:
        1. SERVICE_API_KEYS: If configured and contains non-empty keys, it defines
           the active set of valid credentials for rotation windows (max 10 keys).
        2. LLM_SERVICE_API_KEY: If SERVICE_API_KEYS is unset/empty, falls back to
           this primary key.
        3. SERVICE_API_KEY: If LLM_SERVICE_API_KEY is unset/empty, falls back to
           this legacy key.
        4. If none configured, returns empty tuple (fails closed).
        """
        raw_keys = self.SERVICE_API_KEYS.strip()
        if raw_keys:
            parsed: list[str] = []
            for part in raw_keys.split(","):
                clean = part.strip()
                if clean:
                    if len(clean) > 512:
                        raise ValueError(
                            "Configured API key in SERVICE_API_KEYS exceeds maximum "
                            "allowed length of 512 characters."
                        )
                    if clean not in parsed:
                        parsed.append(clean)
            if len(parsed) > 10:
                raise ValueError(
                    "SERVICE_API_KEYS exceeds maximum allowed limit of 10 keys."
                )
            if parsed:
                return tuple(parsed)

        if self.LLM_SERVICE_API_KEY.strip():
            clean = self.LLM_SERVICE_API_KEY.strip()
            if len(clean) > 512:
                raise ValueError(
                    "LLM_SERVICE_API_KEY exceeds maximum allowed length of "
                    "512 characters."
                )
            return (clean,)

        if self.SERVICE_API_KEY.strip():
            clean = self.SERVICE_API_KEY.strip()
            if len(clean) > 512:
                raise ValueError(
                    "SERVICE_API_KEY exceeds maximum allowed length of 512 characters."
                )
            return (clean,)

        return ()

    @property
    def effective_service_api_key(self) -> str:
        """Return primary service API key for backward compatibility."""
        keys = self.effective_service_api_keys
        return keys[0] if keys else ""

    # LLM Provider Credentials and Models
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_REQUEST_TIMEOUT_SECONDS: float = 30.0
    GROQ_MAX_RETRIES: int = 3

    NVIDIA_API_KEY: str = ""
    NVIDIA_MODEL: str = "meta/llama-3.3-70b-instruct"
    NVIDIA_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    NVIDIA_REQUEST_TIMEOUT_SECONDS: float = 30.0
    NVIDIA_MAX_RETRIES: int = 2
    NVIDIA_FALLBACK_ENABLED: bool | None = None

    @model_validator(mode="after")
    def resolve_nvidia_fallback_default(self) -> "Settings":
        """In production, fallback is disabled by default unless explicitly enabled."""
        env = (self.APP_ENV or self.ENVIRONMENT).lower().strip()
        if self.NVIDIA_FALLBACK_ENABLED is None:
            if env == "production":
                object.__setattr__(self, "NVIDIA_FALLBACK_ENABLED", False)
            else:
                object.__setattr__(self, "NVIDIA_FALLBACK_ENABLED", True)
        return self

    # Quota and Call Guard Settings (Process-local)
    MAX_PROVIDER_CALLS_PER_REQUEST: int = 4
    PROVIDER_RATE_LIMIT_PER_MINUTE: int = 40
    ENABLE_PROCESS_RATE_GUARD: bool = True

    # Concurrency and Request Deadlines
    MAX_CONCURRENT_EXTRACTIONS: int = 2
    CONCURRENCY_ACQUIRE_TIMEOUT_SECONDS: float = 5.0
    EXTRACTION_DEADLINE_SECONDS: float = 60.0

    # PDF Parser Isolation
    PDF_PARSER_ISOLATION_ENABLED: bool = True
    PDF_PARSER_TIMEOUT_SECONDS: float = 15.0
    PDF_PARSER_MAX_WORKERS: int = 2

    # Upstream Provider Circuit Breaker
    CIRCUIT_BREAKER_ENABLED: bool = True
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: int = 3
    CIRCUIT_BREAKER_COOLDOWN_SECONDS: float = 30.0

    # Multi-worker Detection
    WEB_CONCURRENCY: int | None = None
    WORKERS: int | None = None
    APP_ENV: str = ""

    # Execution Mode
    MOCK_MODE: bool = False

    # Input Truncation Limits
    MAX_INPUT_CHARS: int = 24_000

    # PDF Extraction Safety Limits
    PDF_BACKEND: str = "pymupdf"  # Options: "pymupdf", "pypdfium2"
    PDF_MAX_FILE_SIZE_BYTES: int = 10 * 1024 * 1024  # 10 MB
    PDF_MAX_PAGES: int = 10  # Maximum 10 pages for a resume
    PDF_MAX_TEXT_CHARS: int = 100_000  # Maximum 100,000 characters

    @field_validator("MAX_CONCURRENT_EXTRACTIONS")
    @classmethod
    def validate_max_concurrent_extractions(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("MAX_CONCURRENT_EXTRACTIONS must be positive.")
        return v

    @field_validator("CONCURRENCY_ACQUIRE_TIMEOUT_SECONDS")
    @classmethod
    def validate_concurrency_timeout(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("CONCURRENCY_ACQUIRE_TIMEOUT_SECONDS must be positive.")
        return v

    @field_validator("EXTRACTION_DEADLINE_SECONDS")
    @classmethod
    def validate_extraction_deadline(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("EXTRACTION_DEADLINE_SECONDS must be positive.")
        return v

    @field_validator("PDF_PARSER_TIMEOUT_SECONDS")
    @classmethod
    def validate_pdf_parser_timeout(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("PDF_PARSER_TIMEOUT_SECONDS must be positive.")
        return v

    @field_validator("PDF_PARSER_MAX_WORKERS")
    @classmethod
    def validate_pdf_parser_max_workers(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("PDF_PARSER_MAX_WORKERS must be positive.")
        return v

    @field_validator("CIRCUIT_BREAKER_FAILURE_THRESHOLD")
    @classmethod
    def validate_circuit_breaker_threshold(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("CIRCUIT_BREAKER_FAILURE_THRESHOLD must be positive.")
        return v

    @field_validator("CIRCUIT_BREAKER_COOLDOWN_SECONDS")
    @classmethod
    def validate_circuit_breaker_cooldown(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("CIRCUIT_BREAKER_COOLDOWN_SECONDS must be positive.")
        return v

    @field_validator("GROQ_REQUEST_TIMEOUT_SECONDS")
    @classmethod
    def validate_groq_timeout(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("GROQ_REQUEST_TIMEOUT_SECONDS must be positive.")
        return v

    @field_validator("GROQ_MAX_RETRIES")
    @classmethod
    def validate_groq_max_retries(cls, v: int) -> int:
        if v < 0:
            raise ValueError("GROQ_MAX_RETRIES cannot be negative.")
        return v

    @field_validator("NVIDIA_REQUEST_TIMEOUT_SECONDS")
    @classmethod
    def validate_nvidia_timeout(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("NVIDIA_REQUEST_TIMEOUT_SECONDS must be positive.")
        return v

    @field_validator("NVIDIA_MAX_RETRIES")
    @classmethod
    def validate_nvidia_max_retries(cls, v: int) -> int:
        if v < 0:
            raise ValueError("NVIDIA_MAX_RETRIES cannot be negative.")
        return v

    @field_validator("MAX_PROVIDER_CALLS_PER_REQUEST")
    @classmethod
    def validate_max_provider_calls(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("MAX_PROVIDER_CALLS_PER_REQUEST must be positive.")
        return v

    @field_validator("PROVIDER_RATE_LIMIT_PER_MINUTE")
    @classmethod
    def validate_provider_rate_limit(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("PROVIDER_RATE_LIMIT_PER_MINUTE must be positive.")
        return v

    @field_validator("MAX_INPUT_CHARS")
    @classmethod
    def validate_max_input_chars(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("MAX_INPUT_CHARS must be positive.")
        return v

    @field_validator("PDF_BACKEND")
    @classmethod
    def validate_pdf_backend(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ("pymupdf", "pypdfium2"):
            raise ValueError(
                f"Unsupported PDF_BACKEND '{v}'. "
                "Supported options: 'pymupdf', 'pypdfium2'."
            )
        return clean


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings instance."""
    return Settings()
