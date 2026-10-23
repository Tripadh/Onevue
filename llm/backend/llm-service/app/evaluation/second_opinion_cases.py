"""Synthetic benchmark cases for comparative second-opinion evaluation.

Defines deterministic scenarios comparing Strategy A (Groq primary + NVIDIA fallback)
against Strategy B (Candidate: Strategy A + conditional second opinion).

Covers all 9 mandated scenario types:
1. Clean extraction without triggering a second opinion.
2. A second opinion that corrects a supported mistake.
3. A second opinion that introduces an unsupported value (rejected by arbitration).
4. Disagreement between providers (conflict preserved, not guessed).
5. Low-confidence fields.
6. Provider error resilience (timeout, rate limit, unavailable).
7. Invalid output and schema-validation failures.
8. Call-budget exhaustion.
9. A second opinion that provides no useful improvement.
"""

from dataclasses import dataclass, field
from typing import Any

from app.providers.base import ProviderTimeoutError
from app.schemas.errors import WarningCode
from app.schemas.llm_draft import (
    EducationDraft,
    ExperienceDraft,
    ProfileDraft,
    ResumeDraft,
    SkillDraft,
)
from app.schemas.response import (
    Confidence,
    ExtractionWarning,
    FieldMeta,
    FieldSource,
    GroundingStatus,
)


@dataclass
class SecondOpinionScenario:
    """A synthetic scenario for comparing Strategy A vs Strategy B."""

    case_id: str
    name: str
    description: str
    resume_text: str
    primary_draft: ResumeDraft | None = None
    primary_exc: Exception | None = None
    fallback_draft: ResumeDraft | None = None
    fallback_exc: Exception | None = None
    second_opinion_draft: ResumeDraft | None = None
    second_opinion_exc: Exception | None = None
    ground_truth_fields: dict[str, Any] = field(default_factory=dict)
    important_fields: list[str] = field(default_factory=list)
    primary_warnings: list[ExtractionWarning] = field(default_factory=list)
    primary_meta_overrides: dict[str, FieldMeta] = field(default_factory=dict)
    initial_call_guard_budget: int = 4
    initial_used_calls: int = 0
    synthetic_primary_latency_ms: int = 450
    synthetic_fallback_latency_ms: int = 650
    synthetic_second_opinion_latency_ms: int = 480
    synthetic_primary_tokens: int = 800
    synthetic_fallback_tokens: int = 850
    synthetic_second_opinion_tokens: int = 600


def build_second_opinion_scenarios() -> list[SecondOpinionScenario]:
    """Construct the 9 representative synthetic benchmark scenarios."""
    scenarios: list[SecondOpinionScenario] = []

    # Case 1: Clean extraction without a second opinion
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_1_clean_no_opinion",
            name="Clean Extraction (No Second Opinion Triggered)",
            description=(
                "Primary extraction is fully grounded, high confidence, with no "
                "ambiguities. Second opinion is not requested."
            ),
            resume_text=(
                "Alice Walker\n"
                "Email: alice.walker@example.com\n"
                "Software Engineer at Acme Corp from 2020-01 to 2023-05\n"
                "B.S. in Computer Science from MIT from 2016-09 to 2020-05\n"
                "Skills: Python, Go"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(
                    name="Alice Walker",
                    headline="Software Engineer",
                    email="alice.walker@example.com",
                ),
                education=[
                    EducationDraft(
                        institution="MIT",
                        degree="B.S. in Computer Science",
                        startDate="2016-09",
                        endDate="2020-05",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Acme Corp",
                        title="Software Engineer",
                        startDate="2020-01",
                        endDate="2023-05",
                    )
                ],
                skills=[SkillDraft(name="Python"), SkillDraft(name="Go")],
            ),
            ground_truth_fields={
                "profile.name": "Alice Walker",
                "education[0].degree": "B.S. in Computer Science",
                "education[0].institution": "MIT",
                "education[0].startDate": "2016-09",
                "education[0].endDate": "2020-05",
                "experience[0].title": "Software Engineer",
                "experience[0].company": "Acme Corp",
                "experience[0].startDate": "2020-01",
                "experience[0].endDate": "2023-05",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
        )
    )

    # Case 2: A second opinion that corrects a supported mistake
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_2_supported_correction",
            name="Supported Mistake Correction",
            description=(
                "Primary extraction hallucinated an ungrounded degree "
                "('B.A. Literature') instead of 'M.S. in Electrical Engineering'. "
                "Second opinion extracts the true grounded degree."
            ),
            resume_text=(
                "Bob Martin\n"
                "Lead Systems Architect at Cyberdyne 2018-01 to 2023-01\n"
                "M.S. in Electrical Engineering from Stanford University "
                "2016-09 to 2018-06\n"
                "Skills: Distributed Systems, Rust"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(
                    name="Bob Martin", headline="Lead Systems Architect"
                ),
                education=[
                    EducationDraft(
                        institution="Stanford University",
                        degree="B.A. Literature",  # Mistake / ungrounded
                        startDate="2016-09",
                        endDate="2018-06",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Cyberdyne",
                        title="Lead Systems Architect",
                        startDate="2018-01",
                        endDate="2023-01",
                    )
                ],
            ),
            second_opinion_draft=ResumeDraft(
                profile=ProfileDraft(
                    name="Bob Martin", headline="Lead Systems Architect"
                ),
                education=[
                    EducationDraft(
                        institution="Stanford University",
                        degree="M.S. in Electrical Engineering",  # Grounded correction
                        startDate="2016-09",
                        endDate="2018-06",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Cyberdyne",
                        title="Lead Systems Architect",
                        startDate="2018-01",
                        endDate="2023-01",
                    )
                ],
            ),
            ground_truth_fields={
                "profile.name": "Bob Martin",
                "education[0].degree": "M.S. in Electrical Engineering",
                "education[0].institution": "Stanford University",
                "education[0].startDate": "2016-09",
                "education[0].endDate": "2018-06",
                "experience[0].title": "Lead Systems Architect",
                "experience[0].company": "Cyberdyne",
                "experience[0].startDate": "2018-01",
                "experience[0].endDate": "2023-01",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
        )
    )

    # Case 3: A second opinion that introduces an unsupported value (rejected)
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_3_unsupported_hallucination",
            name="Unsupported Value Introduced by Second Opinion (Rejected)",
            description=(
                "Primary candidate has grounded title and company, with LOW "
                "confidence. Second opinion hallucinates company as 'Google LLC' "
                "(not in text). Arbitration strictly rejects the hallucination."
            ),
            resume_text=(
                "Clara Oswald\n"
                "Senior Reliability Engineer at Apex Cloud 2019-03 to 2022-12\n"
                "B.S. in Computer Engineering from Georgia Tech 2015-08 to 2019-05"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(
                    name="Clara Oswald", headline="Senior Reliability Engineer"
                ),
                education=[
                    EducationDraft(
                        institution="Georgia Tech",
                        degree="B.S. in Computer Engineering",
                        startDate="2015-08",
                        endDate="2019-05",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Apex Cloud",
                        title="Senior Reliability Engineer",
                        startDate="2019-03",
                        endDate="2022-12",
                    )
                ],
            ),
            second_opinion_draft=ResumeDraft(
                profile=ProfileDraft(
                    name="Clara Oswald", headline="Senior Reliability Engineer"
                ),
                education=[
                    EducationDraft(
                        institution="Georgia Tech",
                        degree="B.S. in Computer Engineering",
                        startDate="2015-08",
                        endDate="2019-05",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Google LLC",  # Hallucination! Not in text
                        title="Senior Reliability Engineer",
                        startDate="2019-03",
                        endDate="2022-12",
                    )
                ],
            ),
            ground_truth_fields={
                "profile.name": "Clara Oswald",
                "education[0].degree": "B.S. in Computer Engineering",
                "education[0].institution": "Georgia Tech",
                "experience[0].title": "Senior Reliability Engineer",
                "experience[0].company": "Apex Cloud",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
            primary_meta_overrides={
                "experience[0].company": FieldMeta(
                    confidence=Confidence.LOW,
                    grounded=True,
                    source=FieldSource.LLM_CHECK,
                    alternatives=[],
                    grounding_status=GroundingStatus.GROUNDED,
                    evidence=[],
                )
            },
        )
    )

    # Case 4: Disagreement between providers (conflict preserved)
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_4_provider_disagreement",
            name="Grounded Disagreement Between Providers (Conflict Preserved)",
            description=(
                "Primary extracts title as 'Engineering Manager'. Second opinion "
                "extracts 'Principal Architect'. Both appear in source text. "
                "Arbitration preserves the conflict as an alternative without guessing."
            ),
            resume_text=(
                "David Tennant\n"
                "Principal Architect and Engineering Manager at Tardis Tech "
                "2017-01 to 2022-01\n"
                "B.S. in Informatics from Oxford University 2013-09 to 2016-06"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(name="David Tennant"),
                education=[
                    EducationDraft(
                        institution="Oxford University",
                        degree="B.S. in Informatics",
                        startDate="2013-09",
                        endDate="2016-06",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Tardis Tech",
                        title="Engineering Manager",
                        startDate="2017-01",
                        endDate="2022-01",
                    )
                ],
            ),
            second_opinion_draft=ResumeDraft(
                profile=ProfileDraft(name="David Tennant"),
                education=[
                    EducationDraft(
                        institution="Oxford University",
                        degree="B.S. in Informatics",
                        startDate="2013-09",
                        endDate="2016-06",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Tardis Tech",
                        title="Principal Architect",
                        startDate="2017-01",
                        endDate="2022-01",
                    )
                ],
            ),
            ground_truth_fields={
                "profile.name": "David Tennant",
                "education[0].degree": "B.S. in Informatics",
                "education[0].institution": "Oxford University",
                "experience[0].company": "Tardis Tech",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
            primary_warnings=[
                ExtractionWarning(
                    path="experience[0].title",
                    code=WarningCode.CONFLICT,
                    message="Multiple candidate titles detected.",
                )
            ],
        )
    )

    # Case 5: Low-confidence field confirmed
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_5_low_confidence_field",
            name="Low-Confidence Field Confirmed by Second Opinion",
            description=(
                "Primary extraction extracted name as 'Elena Rostova' but with "
                "low confidence. Second opinion confirms 'Elena Rostova', "
                "upgrading confidence."
            ),
            resume_text=(
                "Elena Rostova\n"
                "Staff DevOps Engineer at CloudSphere 2019-04 to 2023-08\n"
                "B.S. in Computer Science from University of Washington "
                "2015-09 to 2019-03"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(name="Elena Rostova"),
                education=[
                    EducationDraft(
                        institution="University of Washington",
                        degree="B.S. in Computer Science",
                        startDate="2015-09",
                        endDate="2019-03",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="CloudSphere",
                        title="Staff DevOps Engineer",
                        startDate="2019-04",
                        endDate="2023-08",
                    )
                ],
            ),
            second_opinion_draft=ResumeDraft(
                profile=ProfileDraft(name="Elena Rostova"),
                education=[
                    EducationDraft(
                        institution="University of Washington",
                        degree="B.S. in Computer Science",
                        startDate="2015-09",
                        endDate="2019-03",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="CloudSphere",
                        title="Staff DevOps Engineer",
                        startDate="2019-04",
                        endDate="2023-08",
                    )
                ],
            ),
            ground_truth_fields={
                "profile.name": "Elena Rostova",
                "education[0].degree": "B.S. in Computer Science",
                "education[0].institution": "University of Washington",
                "experience[0].title": "Staff DevOps Engineer",
                "experience[0].company": "CloudSphere",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
            primary_meta_overrides={
                "profile.name": FieldMeta(
                    confidence=Confidence.LOW,
                    grounded=True,
                    source=FieldSource.LLM_CHECK,
                    alternatives=[],
                    grounding_status=GroundingStatus.GROUNDED,
                    evidence=[],
                )
            },
        )
    )

    # Case 6: Provider error resilience (Timeout / 503 / 429)
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_6_provider_error_resilience",
            name="Second Opinion Provider Error Resilience",
            description=(
                "Primary has an unsupported field triggering second opinion, but "
                "second opinion provider times out. Pipeline catches exception safely "
                "and preserves primary candidate."
            ),
            resume_text=(
                "Frank Castle\n"
                "Security Specialist at Vanguard 2016-01 to 2021-12\n"
                "B.S. in Criminal Justice from NY State University 2012-09 to 2016-05"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(name="Frank Castle"),
                education=[
                    EducationDraft(
                        institution="NY State University",
                        degree="B.S. in Criminal Justice",
                        startDate="2012-09",
                        endDate="2016-05",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Vanguard",
                        title="Security Specialist",
                        startDate="2016-01",
                        endDate="2021-12",
                    )
                ],
            ),
            second_opinion_draft=None,
            second_opinion_exc=ProviderTimeoutError(
                "Second opinion provider upstream timed out."
            ),
            ground_truth_fields={
                "profile.name": "Frank Castle",
                "education[0].degree": "B.S. in Criminal Justice",
                "education[0].institution": "NY State University",
                "experience[0].title": "Security Specialist",
                "experience[0].company": "Vanguard",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
            primary_warnings=[
                ExtractionWarning(
                    path="education[0].degree",
                    code=WarningCode.CONFLICT,
                    message="Conflicting candidate degree.",
                )
            ],
        )
    )

    # Case 7: Invalid output and schema-validation failures
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_7_invalid_schema_output",
            name="Invalid Schema Output from Second Opinion (Discarded)",
            description=(
                "Second opinion returns a draft that fails schema validation with "
                "multiple errors. Pipeline detects validation failure and "
                "safely discards it."
            ),
            resume_text=(
                "Grace Hopper\n"
                "Rear Admiral and Computer Pioneer at US Navy 1943-01 to 1986-08\n"
                "Ph.D. in Mathematics from Yale University 1930-09 to 1934-06"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(name="Grace Hopper"),
                education=[
                    EducationDraft(
                        institution="Yale University",
                        degree="Ph.D. in Mathematics",
                        startDate="1930-09",
                        endDate="1934-06",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="US Navy",
                        title="Rear Admiral",
                        startDate="1943-01",
                        endDate="1986-08",
                    )
                ],
            ),
            # Invalid second opinion: empty company and invalid dates
            second_opinion_draft=ResumeDraft(
                profile=ProfileDraft(name="Grace Hopper"),
                education=[
                    EducationDraft(
                        institution="",
                        degree="",
                        startDate="bad-date-1",
                        endDate="bad-date-2",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="",
                        title="",
                        startDate="bad-date-3",
                        endDate="bad-date-4",
                    )
                ],
            ),
            ground_truth_fields={
                "profile.name": "Grace Hopper",
                "education[0].degree": "Ph.D. in Mathematics",
                "education[0].institution": "Yale University",
                "experience[0].title": "Rear Admiral",
                "experience[0].company": "US Navy",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
            primary_warnings=[
                ExtractionWarning(
                    path="education[0].degree",
                    code=WarningCode.CONFLICT,
                    message="Ambiguous candidate degree.",
                )
            ],
        )
    )

    # Case 8: Call-budget exhaustion
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_8_budget_exhaustion",
            name="Call Budget Exhaustion (Second Opinion Disallowed)",
            description=(
                "Primary and fallback calls have exhausted the request budget "
                "(e.g. 2/2 calls). Second opinion policy recognizes exhausted "
                "budget and denies additional call."
            ),
            resume_text=(
                "Henry Higgins\n"
                "Professor of Phonetics at London Institute 2010-01 to 2020-01\n"
                "Doctorate in Linguistics from Cambridge 2005-09 to 2009-06"
            ),
            primary_exc=ProviderTimeoutError("Primary timed out."),
            fallback_draft=ResumeDraft(
                profile=ProfileDraft(name="Henry Higgins"),
                education=[
                    EducationDraft(
                        institution="Cambridge",
                        degree="Doctorate in Linguistics",
                        startDate="2005-09",
                        endDate="2009-06",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="London Institute",
                        title="Professor of Phonetics",
                        startDate="2010-01",
                        endDate="2020-01",
                    )
                ],
            ),
            initial_call_guard_budget=2,
            initial_used_calls=2,  # Guard exhausted!
            second_opinion_draft=ResumeDraft(
                profile=ProfileDraft(name="Henry Higgins"),
            ),
            ground_truth_fields={
                "profile.name": "Henry Higgins",
                "education[0].degree": "Doctorate in Linguistics",
                "education[0].institution": "Cambridge",
                "experience[0].title": "Professor of Phonetics",
                "experience[0].company": "London Institute",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
            primary_warnings=[
                ExtractionWarning(
                    path="experience[0].startDate",
                    code=WarningCode.AMBIGUOUS_DATE,
                    message="Ambiguous date on experience.",
                )
            ],
        )
    )

    # Case 9: Second opinion provides no useful improvement
    scenarios.append(
        SecondOpinionScenario(
            case_id="scenario_9_no_useful_improvement",
            name="Second Opinion Provides No Useful Improvement",
            description=(
                "Primary candidate has an ungrounded or ambiguous date field. "
                "Second opinion is called, but returns identical ambiguous data. "
                "Call is wasted with no benefit."
            ),
            resume_text=(
                "Iris West\n"
                "Investigative Journalist at Central City Picture News "
                "2018-05 to 2023-05\n"
                "B.A. in Journalism from Columbia University 2014-09 to 2018-05"
            ),
            primary_draft=ResumeDraft(
                profile=ProfileDraft(name="Iris West"),
                education=[
                    EducationDraft(
                        institution="Columbia University",
                        degree="B.A. in Journalism",
                        startDate="2014-09",
                        endDate="2018-05",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Central City Picture News",
                        title="Investigative Journalist",
                        startDate="2018-05",
                        endDate="2023-05",
                    )
                ],
            ),
            second_opinion_draft=ResumeDraft(
                profile=ProfileDraft(name="Iris West"),
                education=[
                    EducationDraft(
                        institution="Columbia University",
                        degree="B.A. in Journalism",
                        startDate="2014-09",
                        endDate="2018-05",
                    )
                ],
                experience=[
                    ExperienceDraft(
                        company="Central City Picture News",
                        title="Investigative Journalist",
                        startDate="2018-05",
                        endDate="2023-05",
                    )
                ],
            ),
            ground_truth_fields={
                "profile.name": "Iris West",
                "education[0].degree": "B.A. in Journalism",
                "education[0].institution": "Columbia University",
                "experience[0].title": "Investigative Journalist",
                "experience[0].company": "Central City Picture News",
            },
            important_fields=[
                "profile.name",
                "education[0].degree",
                "experience[0].title",
                "experience[0].company",
            ],
            primary_warnings=[
                ExtractionWarning(
                    path="experience[0].startDate",
                    code=WarningCode.AMBIGUOUS_DATE,
                    message="Ambiguous date on experience.",
                )
            ],
        )
    )

    return scenarios
