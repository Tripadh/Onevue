"""Final resume schema and strict data contracts for ONEVUE."""

import re
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_DATE_REGEX = re.compile(r"^\d{4}(?:-(?:0[1-9]|1[0-2]))?$")


def _validate_date_string(v: str | None) -> str | None:
    if v is None:
        return None
    if not _DATE_REGEX.match(v):
        raise ValueError(
            f"Invalid date '{v}'. Expected 'YYYY' or 'YYYY-MM' with month 01-12."
        )
    return v


def _parse_date_tuple(d: str) -> tuple[int, int | None]:
    parts = d.split("-")
    year = int(parts[0])
    month = int(parts[1]) if len(parts) > 1 else None
    return year, month


def is_end_date_before_start_date(start_date: str, end_date: str) -> bool:
    """Check if end_date represents a calendar point strictly earlier than start_date.

    When comparing year-only and year-month values:
    - A year-only start date represents the beginning of that year (month 01).
    - A year-only end date represents the entirety of that year through month 12.
    """
    start_y, start_m = _parse_date_tuple(start_date)
    end_y, end_m = _parse_date_tuple(end_date)

    start_bound = (start_y, start_m if start_m is not None else 1)
    end_bound = (end_y, end_m if end_m is not None else 12)
    return end_bound < start_bound


class Profile(BaseModel):
    """Candidate profile and contact details."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    headline: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    summary: str | None = None


class Education(BaseModel):
    """Academic institution, degree, and study duration."""

    model_config = ConfigDict(extra="forbid")

    institution: str | None = None
    degree: str | None = None
    fieldOfStudy: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    grade: str | None = None

    @field_validator("startDate", "endDate")
    @classmethod
    def validate_dates(cls, v: str | None) -> str | None:
        return _validate_date_string(v)

    @model_validator(mode="after")
    def validate_date_ordering(self) -> Self:
        if self.startDate is not None and self.endDate is not None:
            if is_end_date_before_start_date(self.startDate, self.endDate):
                raise ValueError(
                    f"endDate '{self.endDate}' cannot be earlier than "
                    f"startDate '{self.startDate}'."
                )
        return self


class Experience(BaseModel):
    """Work experience, employment period, and achievement bullets."""

    model_config = ConfigDict(extra="forbid")

    company: str | None = None
    title: str | None = None
    location: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    isCurrent: bool = False
    bullets: list[str] = Field(default_factory=list)

    @field_validator("startDate", "endDate")
    @classmethod
    def validate_dates(cls, v: str | None) -> str | None:
        return _validate_date_string(v)

    @model_validator(mode="after")
    def validate_experience(self) -> Self:
        if self.isCurrent and self.endDate is not None:
            raise ValueError(
                f"endDate must be None when isCurrent is True, got '{self.endDate}'."
            )
        if self.startDate is not None and self.endDate is not None:
            if is_end_date_before_start_date(self.startDate, self.endDate):
                raise ValueError(
                    f"endDate '{self.endDate}' cannot be earlier than "
                    f"startDate '{self.startDate}'."
                )
        return self


class Skill(BaseModel):
    """Single candidate skill entry."""

    model_config = ConfigDict(extra="forbid")

    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Skill name cannot be empty or whitespace-only.")
        return trimmed


class Project(BaseModel):
    """Portfolio or personal project detail."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    technologies: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)


class Achievement(BaseModel):
    """Honor, award, or certification entry."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None


class SocialLink(BaseModel):
    """Web platform and profile hyperlink."""

    model_config = ConfigDict(extra="forbid")

    platform: str
    url: str

    @field_validator("platform", "url")
    @classmethod
    def validate_non_empty(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Field cannot be empty or whitespace-only.")
        return trimmed


class ResumeData(BaseModel):
    """Top-level normalized resume data contract."""

    model_config = ConfigDict(extra="forbid")

    profile: Profile = Field(default_factory=Profile)
    education: list[Education] = Field(default_factory=list)
    experience: list[Experience] = Field(default_factory=list)
    skills: list[Skill] = Field(default_factory=list)
    projects: list[Project] = Field(default_factory=list)
    achievements: list[Achievement] = Field(default_factory=list)
    socialLinks: list[SocialLink] = Field(default_factory=list)

    @field_validator("profile", mode="before")
    @classmethod
    def coerce_profile(cls, v: Any) -> Any:
        if v is None:
            return Profile()
        return v
