"""Error and warning definitions for ONEVUE LLM Service."""

import re
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, field_validator


class ErrorCode(StrEnum):
    """Enumeration of recognized service error codes."""

    INVALID_FILE = "INVALID_FILE"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    TOO_MANY_PAGES = "TOO_MANY_PAGES"
    ENCRYPTED_PDF = "ENCRYPTED_PDF"
    SCANNED_PDF = "SCANNED_PDF"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    PROVIDER_AUTH = "PROVIDER_AUTH"
    PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    UNAUTHORIZED = "UNAUTHORIZED"
    INTERNAL = "INTERNAL"


class WarningCode(StrEnum):
    """Enumeration of non-fatal extraction warning codes."""

    UNSUPPORTED_VALUE = "UNSUPPORTED_VALUE"
    INVALID_DATE = "INVALID_DATE"
    AMBIGUOUS_DATE = "AMBIGUOUS_DATE"
    DROPPED_ITEM = "DROPPED_ITEM"
    INPUT_TRUNCATED = "INPUT_TRUNCATED"
    LIST_TRUNCATED = "LIST_TRUNCATED"
    CONFLICT = "CONFLICT"
    MOCK_DATA = "MOCK_DATA"


_SENSITIVE_PATTERNS = [
    re.compile(r"sk-[a-zA-Z0-9_\-]{16,}", re.IGNORECASE),
    re.compile(r"gsk_[a-zA-Z0-9_\-]{16,}", re.IGNORECASE),
    re.compile(r"nvapi-[a-zA-Z0-9_\-]{16,}", re.IGNORECASE),
    re.compile(r"bearer\s+[a-zA-Z0-9_\-\.]{16,}", re.IGNORECASE),
]


class StructuredError(BaseModel):
    """Structured error payload ensuring sensitive information is never exposed."""

    model_config = ConfigDict(extra="forbid")

    code: ErrorCode
    message: str

    @field_validator("message")
    @classmethod
    def validate_safe_message(cls, v: str) -> str:
        for pattern in _SENSITIVE_PATTERNS:
            if pattern.search(v):
                raise ValueError("Error message contains sensitive credential or token")
        return v
