"""Synthetic evaluation dataset definition for ONEVUE offline baseline evaluation.

Contains 13 version-controlled synthetic cases with manually verified ground truth,
fictional identities, and reserved example domains.
Zero real personal data or live API calls.
"""

import pymupdf

from app.evaluation.models import EvalCase, GroundTruth
from app.schemas.errors import ErrorCode, WarningCode
from app.schemas.llm_draft import (
    EducationDraft,
    ExperienceDraft,
    ProfileDraft,
    ProjectDraft,
    ResumeDraft,
    SkillDraft,
    SocialLinkDraft,
)


def _build_pdf(
    blocks: list[tuple[float, float, str, int]],
    links: list[tuple[float, float, float, float, str, str]] | None = None,
    page_width: float = 595,
    page_height: float = 842,
) -> bytes:
    """Build a synthetic in-memory PDF document.

    Args:
        blocks: List of (x, y, text, font_size) tuples.
        links: Optional list of (x0, y0, x1, y1, uri, anchor_text) tuples.
        page_width: Document width in points.
        page_height: Document height in points.

    Returns:
        Raw PDF bytes.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=page_width, height=page_height)

    for x, y, text, size in blocks:
        page.insert_text((x, y), text, fontsize=size)

    if links:
        for x0, y0, x1, y1, uri, anchor in links:
            if anchor:
                page.insert_text((x0, y1 - 2), anchor, fontsize=10)
            rect = pymupdf.Rect(x0, y0, x1, y1)
            page.insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": uri})

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_blank_pdf() -> bytes:
    """Build a synthetic PDF with zero extractable text (scanned simulation)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    # Draw a non-text rectangle
    page.draw_rect(
        pymupdf.Rect(50, 50, 200, 200),
        color=(0.8, 0.8, 0.8),
        fill=(0.9, 0.9, 0.9),
    )
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def build_evaluation_dataset() -> list[EvalCase]:
    """Construct the version-controlled synthetic evaluation dataset (13 cases)."""
    dataset: list[EvalCase] = []

    # ---------------------------------------------------------------------------
    # Case 1: Standard one-column resume
    # ---------------------------------------------------------------------------
    case1_pdf = _build_pdf(
        [
            (50, 50, "Jane Doe", 16),
            (50, 70, "Senior Backend Engineer • San Francisco, CA", 11),
            (50, 90, "Email: jane.doe@example.com | Phone: +1 (415) 555-0199", 10),
            (
                50,
                110,
                (
                    "Summary: Senior backend engineer building distributed cloud"
                    " services and APIs."
                ),
                10,
            ),
            (50, 140, "Experience", 13),
            (
                50,
                160,
                "CloudScale Systems — Staff Software Engineer (2021-01 to Present)",
                11,
            ),
            (
                50,
                180,
                (
                    "• Designed distributed microservices handling 50k requests per"
                    " second."
                ),
                10,
            ),
            (
                50,
                195,
                (
                    "• Reduced database p99 latency by 45 percent through cache"
                    " optimizations."
                ),
                10,
            ),
            (
                50,
                245,
                "University of California, Berkeley — B.S. Computer Science",
                11,
            ),
            (50, 260, "Years: 2014 to 2018", 10),
            (50, 275, "Skills", 13),
            (50, 295, "Python, Go, PostgreSQL", 10),
            (50, 325, "Projects", 13),
            (
                50,
                345,
                "MiniCache — In-memory distributed cache: https://github.com/janedoe/minicache",
                10,
            ),
            (50, 375, "Links", 13),
            (
                50,
                395,
                "https://linkedin.com/in/janedoe  https://github.com/janedoe",
                10,
            ),
        ]
    )

    case1_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Jane Doe",
            headline="Senior Backend Engineer",
            email="jane.doe@example.com",
            phone="+1 (415) 555-0199",
            location="San Francisco, CA",
            summary=(
                "Senior backend engineer building distributed cloud services and APIs."
            ),
        ),
        education=[
            EducationDraft(
                institution="University of California, Berkeley",
                degree="B.S. Computer Science",
                startDate="2014",
                endDate="2018",
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
                        "Designed distributed microservices handling 50k"
                        " requests per second."
                    ),
                    (
                        "Reduced database p99 latency by 45 percent through"
                        " cache optimizations."
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
                description="In-memory distributed cache",
                links=["https://github.com/janedoe/minicache"],
            )
        ],
        socialLinks=[
            SocialLinkDraft(platform="LinkedIn", url="https://linkedin.com/in/janedoe"),
            SocialLinkDraft(platform="GitHub", url="https://github.com/janedoe"),
        ],
    )

    case1_truth = GroundTruth(
        expected_status="ok",
        name="Jane Doe",
        headline="Senior Backend Engineer",
        location="San Francisco, CA",
        summary=(
            "Senior backend engineer building distributed cloud services and APIs."
        ),
        emails=["jane.doe@example.com"],
        phones=["+14155550199"],
        urls=[
            "https://github.com/janedoe/minicache",
            "https://linkedin.com/in/janedoe",
            "https://github.com/janedoe",
        ],
        social_links=[
            ("LinkedIn", "https://linkedin.com/in/janedoe"),
            ("GitHub", "https://github.com/janedoe"),
        ],
        project_links=["https://github.com/janedoe/minicache"],
        skills=["Python", "Go", "PostgreSQL"],
        education_dates=[("2014", "2018")],
        experience_dates=[("2021-01", None, True)],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "profile.headline",
            "profile.location",
            "education[0].institution",
            "education[0].degree",
            "experience[0].company",
            "experience[0].title",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_01_standard_one_column",
            name="Standard One-Column Resume",
            category="standard",
            description=(
                "Clean single-column resume with standard contact, experience, and"
                " education."
            ),
            assumptions="Direct layout ordering; all fields present in text layer.",
            pdf_bytes=case1_pdf,
            synthetic_draft=case1_draft,
            ground_truth=case1_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 2: Two-column resume
    # ---------------------------------------------------------------------------
    case2_pdf = _build_pdf(
        [
            # Full width header
            (50, 40, "Marcus Aurelius", 16),
            (50, 60, "Systems Architect • Rome, Italy", 11),
            # Left column (center_x < 297.5)
            (50, 100, "Contact Details", 12),
            (50, 120, "marcus.aurelius@example.org", 10),
            (50, 140, "+1 (202) 555-0188", 10),
            (50, 170, "Core Skills", 12),
            (50, 190, "Rust, C++, Docker, Kubernetes", 10),
            (50, 220, "Education", 12),
            (50, 240, "Rome Institute of Technology", 10),
            (50, 255, "M.S. Distributed Systems (2019 to 2021)", 10),
            # Right column (center_x > 297.5)
            (320, 100, "Executive Summary", 12),
            (
                320,
                120,
                "Designing resilient distributed consensus engines and protocols.",
                10,
            ),
            (320, 150, "Work Experience", 12),
            (320, 170, "Imperium Cloud — Lead Architect (2021-06 to 2024-01)", 10),
            (320, 190, "• Architected high-availability raft consensus engine.", 10),
            (320, 205, "• Managed multi-region replication topology.", 10),
        ]
    )

    case2_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Marcus Aurelius",
            headline="Systems Architect",
            email="marcus.aurelius@example.org",
            phone="+1 (202) 555-0188",
            location="Rome, Italy",
            summary="Designing resilient distributed consensus engines and protocols.",
        ),
        education=[
            EducationDraft(
                institution="Rome Institute of Technology",
                degree="M.S. Distributed Systems",
                startDate="2019",
                endDate="2021",
            )
        ],
        experience=[
            ExperienceDraft(
                company="Imperium Cloud",
                title="Lead Architect",
                startDate="2021-06",
                endDate="2024-01",
                isCurrent=False,
                bullets=[
                    "Architected high-availability raft consensus engine.",
                    "Managed multi-region replication topology.",
                ],
            )
        ],
        skills=[
            SkillDraft(name="Rust"),
            SkillDraft(name="C++"),
            SkillDraft(name="Docker"),
            SkillDraft(name="Kubernetes"),
        ],
    )

    case2_truth = GroundTruth(
        expected_status="ok",
        name="Marcus Aurelius",
        headline="Systems Architect",
        location="Rome, Italy",
        summary="Designing resilient distributed consensus engines and protocols.",
        emails=["marcus.aurelius@example.org"],
        phones=["+12025550188"],
        skills=["Rust", "C++", "Docker", "Kubernetes"],
        education_dates=[("2019", "2021")],
        experience_dates=[("2021-06", "2024-01", False)],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "profile.headline",
            "profile.location",
            "education[0].institution",
            "experience[0].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_02_two_column",
            name="Two-Column Resume",
            category="multi_column",
            description=(
                "Two-column document with sidebar contacts and main column experience."
            ),
            assumptions=(
                "Coordinate reading order parser sorts header -> left column ->"
                " right column."
            ),
            pdf_bytes=case2_pdf,
            synthetic_draft=case2_draft,
            ground_truth=case2_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 3: Missing contact details
    # ---------------------------------------------------------------------------
    case3_pdf = _build_pdf(
        [
            (50, 50, "Alex Vance", 16),
            (50, 70, "Quantum Computing Researcher • Black Mesa, NM", 11),
            (50, 100, "Education", 13),
            (50, 120, "MIT — Ph.D. Physics (2015 to 2020)", 11),
            (50, 150, "Experience", 13),
            (50, 170, "Mesa Labs — Quantum Researcher (2020-09 to 2023-12)", 11),
            (50, 190, "• Developed superconducting qubit simulation models.", 10),
            (50, 220, "Skills", 13),
            (50, 240, "Physics, Quantum Computing, LabVIEW", 10),
        ]
    )

    case3_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Alex Vance",
            headline="Quantum Computing Researcher",
            email=None,
            phone=None,
            location="Black Mesa, NM",
            summary=None,
        ),
        education=[
            EducationDraft(
                institution="MIT",
                degree="Ph.D. Physics",
                startDate="2015",
                endDate="2020",
            )
        ],
        experience=[
            ExperienceDraft(
                company="Mesa Labs",
                title="Quantum Researcher",
                startDate="2020-09",
                endDate="2023-12",
                isCurrent=False,
                bullets=["Developed superconducting qubit simulation models."],
            )
        ],
        skills=[
            SkillDraft(name="Physics"),
            SkillDraft(name="Quantum Computing"),
            SkillDraft(name="LabVIEW"),
        ],
    )

    case3_truth = GroundTruth(
        expected_status="ok",
        name="Alex Vance",
        headline="Quantum Computing Researcher",
        location="Black Mesa, NM",
        summary=None,
        emails=[],
        phones=[],
        urls=[],
        skills=["Physics", "Quantum Computing", "LabVIEW"],
        education_dates=[("2015", "2020")],
        experience_dates=[("2020-09", "2023-12", False)],
        expected_grounded_fields=[
            "profile.name",
            "profile.headline",
            "profile.location",
            "education[0].institution",
            "experience[0].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_03_missing_contact",
            name="Missing Contact Details",
            category="missing_contact",
            description="Resume containing no email address or telephone number.",
            assumptions=(
                "Pipeline does not fail or hallucinate contacts; email and phone"
                " remain None."
            ),
            pdf_bytes=case3_pdf,
            synthetic_draft=case3_draft,
            ground_truth=case3_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 4: Multiple email addresses and phone numbers
    # ---------------------------------------------------------------------------
    case4_pdf = _build_pdf(
        [
            (50, 50, "Sarah Connor", 16),
            (50, 70, "Cyber Security Specialist • Los Angeles, CA", 11),
            (50, 90, "Personal: sarah.connor@example.com", 10),
            (50, 105, "Work: sarah_sec@defense.example.org", 10),
            (50, 110, "Mobile: +1 (310) 555-0123 | Office: +1 (310) 555-0124", 10),
            (50, 140, "Experience", 13),
            (50, 160, "Cyberdyne Defense — Security Analyst (2019 to 2023)", 11),
            (
                50,
                180,
                "• Conducted vulnerability assessments across internal infrastructure.",
                10,
            ),
        ]
    )

    case4_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Sarah Connor",
            headline="Cyber Security Specialist",
            email="sarah.connor@example.com",
            phone="+1 (310) 555-0123",
            location="Los Angeles, CA",
        ),
        experience=[
            ExperienceDraft(
                company="Cyberdyne Defense",
                title="Security Analyst",
                startDate="2019",
                endDate="2023",
                bullets=[
                    (
                        "Conducted vulnerability assessments across internal"
                        " infrastructure."
                    )
                ],
            )
        ],
    )

    case4_truth = GroundTruth(
        expected_status="ok",
        name="Sarah Connor",
        headline="Cyber Security Specialist",
        location="Los Angeles, CA",
        emails=["sarah.connor@example.com", "sarah_sec@defense.example.org"],
        phones=["+13105550123", "+13105550124"],
        experience_dates=[("2019", "2023", False)],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "profile.headline",
            "experience[0].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_04_multiple_contacts",
            name="Multiple Contact Details",
            category="contacts",
            description="Resume with two valid emails and two valid phone numbers.",
            assumptions=(
                "Deterministic extraction finds all 4 contacts; merger stores"
                " alternates in fieldMeta."
            ),
            pdf_bytes=case4_pdf,
            synthetic_draft=case4_draft,
            ground_truth=case4_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 5: Education and employment date ranges
    # ---------------------------------------------------------------------------
    case5_pdf = _build_pdf(
        [
            (50, 50, "Robert Chen", 16),
            (50, 70, "Software Engineer • Seattle, WA", 11),
            (50, 90, "robert.chen@example.org | +1 (206) 555-0133", 10),
            (50, 120, "Education", 13),
            (
                50,
                140,
                "Stanford University — B.S. Symbolic Systems (2016-09 to 2020-06)",
                11,
            ),
            (50, 170, "Work Experience", 13),
            (50, 190, "FirstJob Corp — Software Engineer (2020-07 to 2022-08)", 11),
            (50, 210, "• Built payment integration pipeline.", 10),
            (
                50,
                230,
                "SecondJob Inc — Senior Software Engineer (2022-09 to 2024-05)",
                11,
            ),
            (50, 250, "• Led migration to event-driven microservices.", 10),
        ]
    )

    case5_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Robert Chen",
            headline="Software Engineer",
            email="robert.chen@example.org",
            phone="+1 (206) 555-0133",
            location="Seattle, WA",
        ),
        education=[
            EducationDraft(
                institution="Stanford University",
                degree="B.S. Symbolic Systems",
                startDate="2016-09",
                endDate="2020-06",
            )
        ],
        experience=[
            ExperienceDraft(
                company="FirstJob Corp",
                title="Software Engineer",
                startDate="2020-07",
                endDate="2022-08",
                isCurrent=False,
                bullets=["Built payment integration pipeline."],
            ),
            ExperienceDraft(
                company="SecondJob Inc",
                title="Senior Software Engineer",
                startDate="2022-09",
                endDate="2024-05",
                isCurrent=False,
                bullets=["Led migration to event-driven microservices."],
            ),
        ],
    )

    case5_truth = GroundTruth(
        expected_status="ok",
        name="Robert Chen",
        headline="Software Engineer",
        emails=["robert.chen@example.org"],
        phones=["+12065550133"],
        education_dates=[("2016-09", "2020-06")],
        experience_dates=[
            ("2020-07", "2022-08", False),
            ("2022-09", "2024-05", False),
        ],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "education[0].institution",
            "experience[0].company",
            "experience[1].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_05_date_ranges",
            name="Chronological Date Ranges",
            category="dates",
            description=(
                "Resume with unambiguous multi-year date ranges in YYYY-MM format."
            ),
            assumptions=(
                "Dates normalize cleanly and pass strict date order validation."
            ),
            pdf_bytes=case5_pdf,
            synthetic_draft=case5_draft,
            ground_truth=case5_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 6: Current employment
    # ---------------------------------------------------------------------------
    case6_pdf = _build_pdf(
        [
            (50, 50, "Priya Patel", 16),
            (50, 70, "Engineering Lead • Boston, MA", 11),
            (50, 90, "priya.patel@example.com | +1 (617) 555-0155", 10),
            (50, 120, "Experience", 13),
            (50, 140, "NextGen Health — Engineering Lead (2021-03 to Present)", 11),
            (
                50,
                160,
                "• Directing engineering architecture for healthcare portal.",
                10,
            ),
            (50, 175, "• Mentoring 8 junior and mid-level software engineers.", 10),
        ]
    )

    case6_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Priya Patel",
            headline="Engineering Lead",
            email="priya.patel@example.com",
            phone="+1 (617) 555-0155",
            location="Boston, MA",
        ),
        experience=[
            ExperienceDraft(
                company="NextGen Health",
                title="Engineering Lead",
                startDate="2021-03",
                endDate=None,
                isCurrent=True,
                bullets=[
                    "Directing engineering architecture for healthcare portal.",
                    "Mentoring 8 junior and mid-level software engineers.",
                ],
            )
        ],
    )

    case6_truth = GroundTruth(
        expected_status="ok",
        name="Priya Patel",
        headline="Engineering Lead",
        emails=["priya.patel@example.com"],
        phones=["+16175550155"],
        experience_dates=[("2021-03", None, True)],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "experience[0].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_06_current_employment",
            name="Current Employment",
            category="current_job",
            description="Resume with an ongoing role labeled 'Present'.",
            assumptions=(
                "isCurrent=True is preserved and endDate is strictly None without"
                " contradiction."
            ),
            pdf_bytes=case6_pdf,
            synthetic_draft=case6_draft,
            ground_truth=case6_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 7: Multiple projects and skills
    # ---------------------------------------------------------------------------
    case7_pdf = _build_pdf(
        [
            (50, 50, "Carlos Silva", 16),
            (50, 70, "Full Stack Engineer • Austin, TX", 11),
            (50, 90, "carlos.silva@example.com | +1 (512) 555-0166", 10),
            (50, 120, "Technical Skills", 13),
            (
                50,
                140,
                "Python, TypeScript, React, Next.js, GraphQL, Redis, Terraform, AWS",
                10,
            ),
            (50, 170, "Open Source Projects", 13),
            (
                50,
                190,
                "DevPortal — Full-stack developer portal: https://github.com/csilva/devportal",
                10,
            ),
            (
                50,
                210,
                "LogStream — High-throughput event pipeline: https://github.com/csilva/logstream",
                10,
            ),
            (
                50,
                230,
                "AuthGateway — Zero-trust authentication proxy: https://github.com/csilva/authgateway",
                10,
            ),
        ]
    )

    case7_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Carlos Silva",
            headline="Full Stack Engineer",
            email="carlos.silva@example.com",
            phone="+1 (512) 555-0166",
            location="Austin, TX",
        ),
        skills=[
            SkillDraft(name="Python"),
            SkillDraft(name="TypeScript"),
            SkillDraft(name="React"),
            SkillDraft(name="Next.js"),
            SkillDraft(name="GraphQL"),
            SkillDraft(name="Redis"),
            SkillDraft(name="Terraform"),
            SkillDraft(name="AWS"),
        ],
        projects=[
            ProjectDraft(
                name="DevPortal",
                description="Full-stack developer portal",
                links=["https://github.com/csilva/devportal"],
            ),
            ProjectDraft(
                name="LogStream",
                description="High-throughput event pipeline",
                links=["https://github.com/csilva/logstream"],
            ),
            ProjectDraft(
                name="AuthGateway",
                description="Zero-trust authentication proxy",
                links=["https://github.com/csilva/authgateway"],
            ),
        ],
    )

    case7_truth = GroundTruth(
        expected_status="ok",
        name="Carlos Silva",
        headline="Full Stack Engineer",
        emails=["carlos.silva@example.com"],
        phones=["+15125550166"],
        urls=[
            "https://github.com/csilva/devportal",
            "https://github.com/csilva/logstream",
            "https://github.com/csilva/authgateway",
        ],
        project_links=[
            "https://github.com/csilva/devportal",
            "https://github.com/csilva/logstream",
            "https://github.com/csilva/authgateway",
        ],
        skills=[
            "Python",
            "TypeScript",
            "React",
            "Next.js",
            "GraphQL",
            "Redis",
            "Terraform",
            "AWS",
        ],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "skills[0].name",
            "skills[1].name",
            "projects[0].name",
            "projects[1].name",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_07_multiple_projects_skills",
            name="Multiple Projects and Skills",
            category="rich_content",
            description=(
                "Resume with 8 distinct skills and 3 independent project repositories."
            ),
            assumptions="List items are extracted without dropping valid entries.",
            pdf_bytes=case7_pdf,
            synthetic_draft=case7_draft,
            ground_truth=case7_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 8: Portfolio and repository links (Separation of profiles vs repos)
    # ---------------------------------------------------------------------------
    case8_pdf = _build_pdf(
        [
            (50, 50, "Diana Prince", 16),
            (50, 70, "diana.prince@example.org | +1 (202) 555-0177", 10),
            (50, 90, "Portfolio: https://diana.example.com", 10),
            (
                50,
                110,
                "Profiles: https://github.com/dianaprince | https://linkedin.com/in/dianaprince",
                10,
            ),
            (50, 140, "Projects", 13),
            (
                50,
                160,
                "SentinelShield: https://github.com/dianaprince/sentinel-shield",
                10,
            ),
            (
                50,
                180,
                "ThemysciraCore: https://github.com/dianaprince/themyscira-core",
                10,
            ),
        ]
    )

    case8_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Diana Prince",
            email="diana.prince@example.org",
            phone="+1 (202) 555-0177",
        ),
        socialLinks=[
            SocialLinkDraft(platform="GitHub", url="https://github.com/dianaprince"),
            SocialLinkDraft(
                platform="LinkedIn", url="https://linkedin.com/in/dianaprince"
            ),
            SocialLinkDraft(platform="Portfolio", url="https://diana.example.com"),
        ],
        projects=[
            ProjectDraft(
                name="SentinelShield",
                links=["https://github.com/dianaprince/sentinel-shield"],
            ),
            ProjectDraft(
                name="ThemysciraCore",
                links=["https://github.com/dianaprince/themyscira-core"],
            ),
        ],
    )

    case8_truth = GroundTruth(
        expected_status="ok",
        name="Diana Prince",
        emails=["diana.prince@example.org"],
        phones=["+12025550177"],
        urls=[
            "https://diana.example.com",
            "https://github.com/dianaprince",
            "https://linkedin.com/in/dianaprince",
            "https://github.com/dianaprince/sentinel-shield",
            "https://github.com/dianaprince/themyscira-core",
        ],
        social_links=[
            ("GitHub", "https://github.com/dianaprince"),
            ("LinkedIn", "https://linkedin.com/in/dianaprince"),
        ],
        project_links=[
            "https://github.com/dianaprince/sentinel-shield",
            "https://github.com/dianaprince/themyscira-core",
        ],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "socialLinks[0].url",
            "socialLinks[1].url",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_08_portfolio_and_repos",
            name="Portfolio and Repository Link Classification",
            category="urls",
            description=(
                "Resume containing personal profiles alongside multi-segment repository"
                " URLs."
            ),
            assumptions=(
                "Repository URLs are not misclassified as personal social profile"
                " links."
            ),
            pdf_bytes=case8_pdf,
            synthetic_draft=case8_draft,
            ground_truth=case8_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 9: URLs visible as text versus embedded PDF hyperlinks
    # ---------------------------------------------------------------------------
    case9_links = [
        (
            50,
            110,
            180,
            130,
            "https://portfolio.example.org/evan",
            "Portfolio Website",
        ),
    ]
    case9_pdf = _build_pdf(
        blocks=[
            (50, 50, "Evan Wright", 16),
            (50, 70, "evan.wright@example.com • New York, NY", 10),
            (50, 90, "Visible URL: https://evan.example.com", 10),
            (50, 160, "Experience", 13),
            (50, 180, "WebCraft Studios — Frontend Engineer (2020 to 2023)", 11),
        ],
        links=case9_links,
    )

    case9_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Evan Wright",
            headline="Frontend Engineer",
            email="evan.wright@example.com",
            location="New York, NY",
        ),
        socialLinks=[
            SocialLinkDraft(platform="Website", url="https://evan.example.com"),
            SocialLinkDraft(
                platform="Portfolio", url="https://portfolio.example.org/evan"
            ),
        ],
    )

    case9_truth = GroundTruth(
        expected_status="ok",
        name="Evan Wright",
        headline="Frontend Engineer",
        emails=["evan.wright@example.com"],
        urls=[
            "https://evan.example.com",
            "https://portfolio.example.org/evan",
        ],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "socialLinks[0].url",
            "socialLinks[1].url",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_09_links_text_vs_embedded",
            name="Text URLs vs Embedded PDF Links",
            category="links",
            description=(
                "Resume combining plain text URLs and clickable PDF hyperlink"
                " annotations."
            ),
            assumptions=(
                "Annotation stream recovers masked links with anchor text and web"
                " targets."
            ),
            pdf_bytes=case9_pdf,
            synthetic_draft=case9_draft,
            ground_truth=case9_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 10: Ambiguous dates
    # ---------------------------------------------------------------------------
    case10_pdf = _build_pdf(
        [
            (50, 50, "Fiona Gallagher", 16),
            (50, 70, "fiona.g@example.com • +1 (312) 555-0188", 10),
            (50, 100, "Education", 13),
            (
                50,
                120,
                "Chicago State University — B.A. Sociology (Fall 2018 to Spring 2022)",
                11,
            ),
            (50, 150, "Experience", 13),
            (
                50,
                170,
                "Southside Community — Program Coordinator (Summer '22 to Q4 2023)",
                11,
            ),
        ]
    )

    case10_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Fiona Gallagher",
            email="fiona.g@example.com",
            phone="+1 (312) 555-0188",
        ),
        education=[
            EducationDraft(
                institution="Chicago State University",
                degree="B.A. Sociology",
                startDate="Fall 2018",
                endDate="Spring 2022",
            )
        ],
        experience=[
            ExperienceDraft(
                company="Southside Community",
                title="Program Coordinator",
                startDate="Summer '22",
                endDate="Q4 2023",
                bullets=["Coordinated community outreach initiatives."],
            )
        ],
    )

    case10_truth = GroundTruth(
        expected_status="partial",
        name="Fiona Gallagher",
        emails=["fiona.g@example.com"],
        phones=["+13125550188"],
        education_dates=[(None, None)],
        experience_dates=[(None, None, False)],
        expected_warnings=[WarningCode.AMBIGUOUS_DATE],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "education[0].institution",
            "experience[0].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_10_ambiguous_dates",
            name="Ambiguous Dates Handling",
            category="ambiguous_dates",
            description=(
                "Resume with academic and seasonal date notations (Fall 2018,"
                " Summer '22)."
            ),
            assumptions=(
                "Ambiguous dates produce AMBIGUOUS_DATE warnings and normalize to"
                " None for user review."
            ),
            pdf_bytes=case10_pdf,
            synthetic_draft=case10_draft,
            ground_truth=case10_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 11: Repeated information
    # ---------------------------------------------------------------------------
    case11_pdf = _build_pdf(
        [
            (50, 50, "George Miller", 16),
            (50, 70, "george.miller@example.org • +1 (212) 555-0177", 10),
            (50, 100, "Core Skills: Python, SQL", 11),
            (50, 130, "Experience", 13),
            (50, 150, "Metro Analytics — Data Engineer (2020 to 2023)", 11),
            (50, 170, "• Built ETL pipelines with Python and SQL.", 10),
            (50, 190, "Additional Skills: Python, SQL", 11),
            (
                50,
                220,
                "Footer Contact: george.miller@example.org • +1 (212) 555-0177",
                10,
            ),
        ]
    )

    case11_draft = ResumeDraft(
        profile=ProfileDraft(
            name="George Miller",
            email="george.miller@example.org",
            phone="+1 (212) 555-0177",
        ),
        skills=[
            SkillDraft(name="Python"),
            SkillDraft(name="SQL"),
            SkillDraft(name="Python"),
            SkillDraft(name="SQL"),
        ],
        experience=[
            ExperienceDraft(
                company="Metro Analytics",
                title="Data Engineer",
                startDate="2020",
                endDate="2023",
                bullets=["Built ETL pipelines with Python and SQL."],
            )
        ],
    )

    case11_truth = GroundTruth(
        expected_status="ok",
        name="George Miller",
        emails=["george.miller@example.org"],
        phones=["+12125550177"],
        skills=["Python", "SQL"],
        experience_dates=[("2020", "2023", False)],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "skills[0].name",
            "skills[1].name",
            "experience[0].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_11_repeated_info",
            name="Repeated Information and Deduplication",
            category="deduplication",
            description=(
                "Resume where contact details and skills appear multiple times"
                " across sections."
            ),
            assumptions=(
                "Deterministic extraction deduplicates candidates and merges evidence"
                " audit trails."
            ),
            pdf_bytes=case11_pdf,
            synthetic_draft=case11_draft,
            ground_truth=case11_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 12: Contradictory candidate data
    # ---------------------------------------------------------------------------
    case12_pdf = _build_pdf(
        [
            (50, 50, "Hannah Abbott", 16),
            (50, 70, "hannah.a@example.com • +1 (415) 555-0189", 10),
            (50, 100, "Education", 13),
            (50, 120, "Hogwarts Academy — B.S. Herbology (2018 to 2022)", 11),
            (50, 150, "Experience", 13),
            (50, 170, "Botanical Gardens — Lead Botanist (2022 to Present)", 11),
        ]
    )

    case12_draft = ResumeDraft(
        profile=ProfileDraft(
            name="Hannah Abbott",
            email="hannah.a@example.com",
            phone="+1 (415) 555-0189",
        ),
        education=[
            EducationDraft(
                institution="Hogwarts Academy",
                degree="B.S. Herbology",
                startDate="2022",
                endDate="2018",  # Inverted!
            )
        ],
        experience=[
            ExperienceDraft(
                company="Botanical Gardens",
                title="Lead Botanist",
                startDate="2022",
                endDate="2023-05",  # Contradiction with isCurrent=True!
                isCurrent=True,
                bullets=["Cultivating rare botanical specimens."],
            )
        ],
    )

    case12_truth = GroundTruth(
        expected_status="ok",
        name="Hannah Abbott",
        emails=["hannah.a@example.com"],
        phones=["+14155550189"],
        expected_warnings=[],
        expected_grounded_fields=[
            "profile.name",
            "profile.email",
            "profile.phone",
            "education[0].institution",
            "experience[0].company",
        ],
    )

    dataset.append(
        EvalCase(
            case_id="case_12_contradictory_data",
            name="Contradictory Candidate Data",
            category="repair",
            description=(
                "Draft containing chronological contradictions (isCurrent with"
                " endDate, inverted dates)."
            ),
            assumptions=(
                "Bounded repair simulator resolves contradictions safely without"
                " crashing."
            ),
            pdf_bytes=case12_pdf,
            synthetic_draft=case12_draft,
            ground_truth=case12_truth,
        )
    )

    # ---------------------------------------------------------------------------
    # Case 13: Insufficient extractable text (Scanned / Empty document)
    # ---------------------------------------------------------------------------
    case13_pdf = _make_blank_pdf()

    case13_truth = GroundTruth(
        expected_status="failed",
        expected_error_code=ErrorCode.SCANNED_PDF,
    )

    dataset.append(
        EvalCase(
            case_id="case_13_insufficient_text",
            name="Insufficient Extractable Text (Scanned/Empty)",
            category="limits",
            description=(
                "PDF containing non-text drawing and zero extractable characters."
            ),
            assumptions=(
                "PDF parser strictly raises SCANNED_PDF; extraction aborts cleanly"
                " without OCR."
            ),
            pdf_bytes=case13_pdf,
            synthetic_draft=None,
            ground_truth=case13_truth,
        )
    )

    return dataset
