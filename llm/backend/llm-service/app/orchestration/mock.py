"""Mock LLM extraction provider for offline testing and development mode."""

from app.providers.base import ProviderResult, TokenUsage
from app.schemas.llm_draft import (
    EducationDraft,
    ExperienceDraft,
    ProfileDraft,
    ProjectDraft,
    ResumeDraft,
    SkillDraft,
    SocialLinkDraft,
)

DEFAULT_MOCK_DRAFT = ResumeDraft(
    profile=ProfileDraft(
        name="Jane Doe",
        headline="Senior Backend Engineer",
        email="jane.doe@example.com",
        phone="+1 (415) 555-0199",
        location="San Francisco, CA",
        summary=(
            "Experienced backend software engineer building distributed cloud "
            "services and high-throughput APIs."
        ),
    ),
    education=[
        EducationDraft(
            institution="University of California, Berkeley",
            degree="B.S. Computer Science",
            startDate="2014",
            endDate="2018",
            grade="3.85",
        )
    ],
    experience=[
        ExperienceDraft(
            company="CloudScale Systems",
            title="Staff Software Engineer",
            location="San Francisco, CA",
            startDate="2021-01",
            endDate=None,
            isCurrent=True,
            bullets=[
                (
                    "Designed and maintained distributed microservices handling "
                    "over 50k requests per second."
                ),
                (
                    "Reduced database p99 latency by 45 percent through cache tier "
                    "optimizations."
                ),
            ],
        )
    ],
    skills=[
        SkillDraft(name="Python"),
        SkillDraft(name="Go"),
        SkillDraft(name="PostgreSQL"),
    ],
    projects=[
        ProjectDraft(
            name="MiniCache",
            description="A high-performance in-memory cache written in Go.",
            links=["https://github.com/janedoe/minicache"],
        )
    ],
    socialLinks=[
        SocialLinkDraft(
            platform="LinkedIn",
            url="https://linkedin.com/in/janedoe",
        ),
        SocialLinkDraft(
            platform="GitHub",
            url="https://github.com/janedoe",
        ),
    ],
    achievements=[],
)


class MockProvider:
    """Deterministic mock provider executing entirely offline without network access.

    Conforms to the LLMProvider protocol.
    """

    model: str = "mock"

    def __init__(self, draft: ResumeDraft | None = None) -> None:
        """Initialize mock provider with optional custom draft."""
        self._draft = draft or DEFAULT_MOCK_DRAFT
        self.repair_call_count = 0

    async def extract(self, text: str) -> ProviderResult:
        """Return deterministic synthetic ResumeDraft without network operations."""
        return ProviderResult(
            draft=self._draft.model_copy(deep=True),
            provider="mock",
            model="mock",
            latency_ms=0,
            token_usage=TokenUsage(
                prompt_tokens=0, completion_tokens=0, total_tokens=0
            ),
            warnings=[],
        )

    async def repair(self, draft: ResumeDraft, issues: list[str]) -> ProviderResult:
        """Perform a deterministic simulated repair of validation issues."""
        self.repair_call_count += 1
        repaired = draft.model_copy(deep=True)

        # Fix education date order issues if present
        for edu in repaired.education:
            if edu.startDate and edu.endDate and edu.endDate < edu.startDate:
                edu.endDate = None

        # Fix experience contradictions if present
        for exp in repaired.experience:
            if exp.isCurrent:
                exp.endDate = None
            elif exp.startDate and exp.endDate and exp.endDate < exp.startDate:
                exp.endDate = None

        return ProviderResult(
            draft=repaired,
            provider="mock",
            model="mock",
            latency_ms=0,
            token_usage=TokenUsage(
                prompt_tokens=0, completion_tokens=0, total_tokens=0
            ),
            warnings=[],
        )

    async def close(self) -> None:
        """No-op cleanup for mock provider."""
        pass
