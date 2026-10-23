"""Lenient LLM extraction draft schemas and provider-facing strict schema generator."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

FORBIDDEN_SCHEMA_KEYWORDS: frozenset[str] = frozenset(
    {
        "format",
        "pattern",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minItems",
        "maxItems",
        "uniqueItems",
        "default",
    }
)


class ProfileDraft(BaseModel):
    """Draft representation of candidate profile."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    headline: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    summary: str | None = None


class EducationDraft(BaseModel):
    """Draft representation of candidate education."""

    model_config = ConfigDict(extra="forbid")

    institution: str | None = None
    degree: str | None = None
    fieldOfStudy: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    grade: str | None = None


class ExperienceDraft(BaseModel):
    """Draft representation of candidate work experience."""

    model_config = ConfigDict(extra="forbid")

    company: str | None = None
    title: str | None = None
    location: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    isCurrent: bool | None = False
    bullets: list[str] = Field(default_factory=list)


class SkillDraft(BaseModel):
    """Draft representation of a skill."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class ProjectDraft(BaseModel):
    """Draft representation of a project."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    technologies: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)


class AchievementDraft(BaseModel):
    """Draft representation of an achievement."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None


class SocialLinkDraft(BaseModel):
    """Draft representation of a social link."""

    model_config = ConfigDict(extra="forbid")

    platform: str | None = None
    url: str | None = None


class ResumeDraft(BaseModel):
    """Top-level draft model accommodating raw, lenient LLM extractions."""

    model_config = ConfigDict(extra="forbid")

    profile: ProfileDraft = Field(default_factory=ProfileDraft)
    education: list[EducationDraft] = Field(default_factory=list)
    experience: list[ExperienceDraft] = Field(default_factory=list)
    skills: list[SkillDraft] = Field(default_factory=list)
    projects: list[ProjectDraft] = Field(default_factory=list)
    achievements: list[AchievementDraft] = Field(default_factory=list)
    socialLinks: list[SocialLinkDraft] = Field(default_factory=list)


def _clean_schema_node(node: Any) -> Any:
    """Recursively clean schema nodes for strict structured-output providers."""
    if isinstance(node, dict):
        cleaned: dict[str, Any] = {}
        for key, value in node.items():
            if key in FORBIDDEN_SCHEMA_KEYWORDS:
                continue
            cleaned[key] = _clean_schema_node(value)

        # Ensure all objects set additionalProperties=False and require all properties
        if cleaned.get("type") == "object" or "properties" in cleaned:
            cleaned["type"] = "object"
            cleaned["additionalProperties"] = False
            props = cleaned.get("properties")
            if isinstance(props, dict):
                cleaned["required"] = list(props.keys())

        return cleaned

    if isinstance(node, list):
        return [_clean_schema_node(item) for item in node]

    return node


def get_provider_draft_schema(
    model_cls: type[BaseModel] = ResumeDraft,
) -> dict[str, Any]:
    """Return a strict JSON schema suitable for structured-output LLM providers.

    This helper takes the Pydantic JSON schema of ResumeDraft (or another draft model)
    and recursively ensures:
    1. Every object explicitly sets additionalProperties: false.
    2. Every object lists all of its properties in the required array.
    3. Constraints and forbidden keywords (format, pattern, minLength, default, etc.)
       are stripped recursively.
    4. Optional fields are preserved as nullable schemas.
    """
    raw_schema = model_cls.model_json_schema()
    return _clean_schema_node(raw_schema)
