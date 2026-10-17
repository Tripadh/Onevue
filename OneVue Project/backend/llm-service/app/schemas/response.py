"""Response models and extraction envelopes for ONEVUE LLM Service."""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.errors import StructuredError, WarningCode
from app.schemas.path_helpers import build_field_path
from app.schemas.resume import ResumeData


class Confidence(StrEnum):
    """Confidence tier for an extracted field."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class FieldSource(StrEnum):
    """Origin mechanism of an extracted value."""

    RULES = "rules"
    LLM = "llm"
    LLM_CHECK = "llm+check"


class ExtractionStatus(StrEnum):
    """Overall outcome of the extraction process."""

    OK = "ok"
    PARTIAL = "partial"


class GroundingStatus(StrEnum):
    """Grounding verification state against source document evidence."""

    GROUNDED = "grounded"
    PARTIALLY_GROUNDED = "partially_grounded"
    UNSUPPORTED = "unsupported"
    NOT_CHECKED = "not_checked"


class FieldMeta(BaseModel):
    """Extraction confidence and provenance metadata for an individual field."""

    model_config = ConfigDict(extra="forbid")

    confidence: Confidence
    grounded: bool
    source: FieldSource
    alternatives: list[str] = Field(default_factory=list)
    grounding_status: GroundingStatus | None = None
    evidence: list[Any] = Field(default_factory=list)

    @field_validator("alternatives", mode="before")
    @classmethod
    def normalize_alternatives(cls, v: Any) -> Any:
        if v is None:
            return []
        return v


class ExtractionWarning(BaseModel):
    """Structured advisory generated during document processing or normalization."""

    model_config = ConfigDict(extra="forbid")

    path: str = ""
    code: WarningCode
    message: str


class ExtractionMeta(BaseModel):
    """Telemetry and execution metadata for the extraction request."""

    model_config = ConfigDict(extra="forbid")

    schemaVersion: str = "1.0.0"
    provider: str
    fallbackUsed: bool = False
    latencyMs: int = Field(ge=0)
    mock: bool = False
    primaryProvider: str | None = None
    fallbackProvider: str | None = None
    attemptsCount: int = 1
    quotaBlocked: bool = False


class ExtractionResponse(BaseModel):
    """Standard response envelope returning extracted resume data and metadata."""

    model_config = ConfigDict(extra="forbid")

    status: ExtractionStatus
    data: ResumeData
    fieldMeta: dict[str, FieldMeta] = Field(default_factory=dict)
    warnings: list[ExtractionWarning] = Field(default_factory=list)
    meta: ExtractionMeta
    error: StructuredError | None = None


__all__ = [
    "Confidence",
    "ExtractionMeta",
    "ExtractionResponse",
    "ExtractionStatus",
    "ExtractionWarning",
    "FieldMeta",
    "FieldSource",
    "GroundingStatus",
    "build_field_path",
]
