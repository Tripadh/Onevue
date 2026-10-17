"""Focused tests for deterministic extraction of emails, phone numbers, and URLs."""

import pytest
from pydantic import ValidationError

from app.extraction.pdf import PDFLink
from app.extraction.rules import (
    EmailCandidate,
    PhoneCandidate,
    RuleExtractionResult,
    SourceEvidence,
    URLCandidate,
    URLCategory,
    classify_url,
    extract_rule_based_fields,
)


class TestEmailExtraction:
    """Tests for regex-based deterministic email address extraction."""

    def test_extract_valid_common_email(self) -> None:
        text = "You can contact me at alex.smith@example.com for opportunities."
        result = extract_rule_based_fields(text)
        assert len(result.emails) == 1
        candidate = result.emails[0]
        assert candidate.value == "alex.smith@example.com"
        assert len(candidate.evidence) == 1
        ev = candidate.evidence[0]
        assert ev.source_type == "text"
        assert ev.extracted_value == "alex.smith@example.com"
        assert ev.start_offset is not None and ev.end_offset is not None
        assert text[ev.start_offset : ev.end_offset] == "alex.smith@example.com"

    def test_extract_subdomain_and_plus_tag_emails(self) -> None:
        text = "Emails: user+tag@mail.sub.example.co.uk and work.dev@domain.org"
        result = extract_rule_based_fields(text)
        assert len(result.emails) == 2
        assert result.emails[0].value == "user+tag@mail.sub.example.co.uk"
        assert result.emails[1].value == "work.dev@domain.org"

    @pytest.mark.parametrize(
        "invalid_text",
        [
            "Contact me at name@ for details.",
            "Send inquiry to @example.com please.",
            "My address is name@example without TLD.",
            "Invalid address name..surname@example.com in resume.",
            "Broken domain user@example..com here.",
            "Not an email @something or user@",
        ],
    )
    def test_reject_malformed_emails(self, invalid_text: str) -> None:
        result = extract_rule_based_fields(invalid_text)
        assert len(result.emails) == 0

    @pytest.mark.parametrize(
        ("text", "expected_email"),
        [
            ("Reach me at contact@example.com.", "contact@example.com"),
            ("Email: contact@example.com,", "contact@example.com"),
            ("Write to (contact@example.com)", "contact@example.com"),
            ("Inquiry: <contact@example.com>;", "contact@example.com"),
            ('Quote: "contact@example.com"!', "contact@example.com"),
        ],
    )
    def test_trim_surrounding_punctuation_from_emails(
        self, text: str, expected_email: str
    ) -> None:
        result = extract_rule_based_fields(text)
        assert len(result.emails) == 1
        candidate = result.emails[0]
        assert candidate.value == expected_email
        ev = candidate.evidence[0]
        assert text[ev.start_offset : ev.end_offset] == expected_email

    def test_deduplicate_emails_case_insensitively_preserving_first_seen(
        self,
    ) -> None:
        text = "Primary: John.Doe@Example.COM, backup: john.doe@example.com."
        result = extract_rule_based_fields(text)
        assert len(result.emails) == 1
        candidate = result.emails[0]
        assert candidate.value == "John.Doe@Example.COM"
        assert len(candidate.evidence) == 2
        assert candidate.evidence[0].source_type == "text"
        assert candidate.evidence[1].source_type == "text"
        assert (
            text[candidate.evidence[0].start_offset : candidate.evidence[0].end_offset]
            == "John.Doe@Example.COM"
        )
        assert (
            text[candidate.evidence[1].start_offset : candidate.evidence[1].end_offset]
            == "john.doe@example.com"
        )

    def test_no_email_found_returns_empty_list(self) -> None:
        text = "Experienced software engineer with 5 years in backend systems."
        result = extract_rule_based_fields(text)
        assert result.emails == []


class TestPhoneExtraction:
    """Tests for regex-based deterministic phone number extraction."""

    @pytest.mark.parametrize(
        ("raw_input", "expected_val", "expected_norm"),
        [
            ("Mobile: +91 98765 43210", "+91 98765 43210", "+919876543210"),
            ("Phone: 9876543210", "9876543210", "9876543210"),
            ("Direct: +1 202-555-0123", "+1 202-555-0123", "+12025550123"),
            ("Office: (202) 555-0123", "(202) 555-0123", "2025550123"),
            ("UK: +44 20 7946 0958", "+44 20 7946 0958", "+442079460958"),
            ("Hyphenated: +91-98765-43210", "+91-98765-43210", "+919876543210"),
            ("Dotted: 202.555.0123", "202.555.0123", "2025550123"),
        ],
    )
    def test_extract_common_phone_formats(
        self, raw_input: str, expected_val: str, expected_norm: str
    ) -> None:
        result = extract_rule_based_fields(raw_input)
        assert len(result.phones) == 1
        candidate = result.phones[0]
        assert candidate.value == expected_val
        assert candidate.normalized == expected_norm
        ev = candidate.evidence[0]
        assert ev.source_type == "text"
        assert raw_input[ev.start_offset : ev.end_offset] == expected_val

    def test_phone_without_country_code_does_not_invent_prefix(self) -> None:
        text = "Contact: 9876543210"
        result = extract_rule_based_fields(text)
        assert len(result.phones) == 1
        candidate = result.phones[0]
        assert candidate.value == "9876543210"
        assert candidate.normalized == "9876543210"
        assert not candidate.normalized.startswith("+")

    @pytest.mark.parametrize(
        "invalid_text",
        [
            "Graduated in 2020 with honors.",
            "Tenure from 2020-2024 at Tech Corp.",
            "Date of birth: 2022-01-15.",
            "Short code: 12345.",
            "Identifier: 987654321.",
            "GPA: 3.8 / 4.0 in CS.",
            "CGPA was 9.2 out of 10.0.",
            "Scored 85.5% in final exam.",
            "Model A9876543210B revision.",
            "Version v1.202.555.0123 released.",
            "Excessively long 12345678901234567 number.",
            "Repeated 0000000000 digits.",
        ],
    )
    def test_reject_years_dates_grades_and_invalid_numbers(
        self, invalid_text: str
    ) -> None:
        result = extract_rule_based_fields(invalid_text)
        assert len(result.phones) == 0

    def test_phone_deduplication_preserves_first_seen_and_combines_evidence(
        self,
    ) -> None:
        text = "Call (202) 555-0123 or reach 202-555-0123 for assistance."
        result = extract_rule_based_fields(text)
        assert len(result.phones) == 1
        candidate = result.phones[0]
        assert candidate.value == "(202) 555-0123"
        assert candidate.normalized == "2025550123"
        assert len(candidate.evidence) == 2
        assert (
            text[candidate.evidence[0].start_offset : candidate.evidence[0].end_offset]
            == "(202) 555-0123"
        )
        assert (
            text[candidate.evidence[1].start_offset : candidate.evidence[1].end_offset]
            == "202-555-0123"
        )


class TestURLExtraction:
    """Tests for regex-based and annotation URL extraction."""

    def test_extract_http_and_https_urls(self) -> None:
        text = "Visit https://example.com/demo and http://docs.example.org"
        result = extract_rule_based_fields(text)
        assert len(result.urls) == 2
        assert result.urls[0].url == "https://example.com/demo"
        assert result.urls[1].url == "http://docs.example.org"

    def test_extract_schemeless_urls(self) -> None:
        text = "Profiles: github.com/johndoe, linkedin.com/in/johndoe, www.johndoe.com"
        result = extract_rule_based_fields(text)
        assert len(result.urls) == 3
        assert result.urls[0].url == "https://github.com/johndoe"
        assert result.urls[0].value == "github.com/johndoe"
        assert result.urls[1].url == "https://linkedin.com/in/johndoe"
        assert result.urls[2].url == "https://www.johndoe.com"

    @pytest.mark.parametrize(
        ("text", "expected_url"),
        [
            ("Check https://example.com/path.", "https://example.com/path"),
            ("See https://example.com/path,", "https://example.com/path"),
            ("(https://example.com/path)", "https://example.com/path"),
            ("[https://example.com/path]", "https://example.com/path"),
            ("<https://example.com/path>;", "https://example.com/path"),
        ],
    )
    def test_trim_trailing_punctuation_and_unmatched_brackets_from_urls(
        self, text: str, expected_url: str
    ) -> None:
        result = extract_rule_based_fields(text)
        assert len(result.urls) == 1
        candidate = result.urls[0]
        assert candidate.url == expected_url
        ev = candidate.evidence[0]
        assert text[ev.start_offset : ev.end_offset] == expected_url

    def test_preserve_balanced_parentheses_in_url(self) -> None:
        text = "Reference: https://en.wikipedia.org/wiki/C_(programming_language)"
        result = extract_rule_based_fields(text)
        assert len(result.urls) == 1
        assert (
            result.urls[0].url
            == "https://en.wikipedia.org/wiki/C_(programming_language)"
        )

    def test_email_addresses_not_extracted_as_urls(self) -> None:
        text = "Contact: developer@example.com"
        result = extract_rule_based_fields(text)
        assert len(result.emails) == 1
        assert len(result.urls) == 0

    def test_mailto_in_text_not_treated_as_web_url(self) -> None:
        text = "Link: mailto:dev@example.com for questions."
        result = extract_rule_based_fields(text)
        assert len(result.emails) == 1
        assert len(result.urls) == 0

    def test_query_and_fragment_preserved_in_url(self) -> None:
        text = "Portfolio: https://example.com/projects?tag=python#highlighted"
        result = extract_rule_based_fields(text)
        assert len(result.urls) == 1
        assert (
            result.urls[0].url == "https://example.com/projects?tag=python#highlighted"
        )

    def test_url_deduplication_preserves_first_seen_and_merges_evidence(
        self,
    ) -> None:
        text = "Site: github.com/developer and later https://github.com/developer/"
        result = extract_rule_based_fields(text)
        assert len(result.urls) == 1
        candidate = result.urls[0]
        assert candidate.value == "github.com/developer"
        assert candidate.url == "https://github.com/developer"
        assert len(candidate.evidence) == 2


class TestURLClassification:
    """Tests for classifying GitHub, LinkedIn, and project repositories."""

    def test_classify_github_profile(self) -> None:
        url = "https://github.com/octocat"
        assert classify_url(url) == URLCategory.GITHUB_PROFILE

        text = "Profile at github.com/octocat"
        result = extract_rule_based_fields(text)
        assert len(result.github_profiles) == 1
        assert result.github_profiles[0].value == "github.com/octocat"
        assert result.github_profiles[0].category == URLCategory.GITHUB_PROFILE

    def test_classify_github_repository(self) -> None:
        url = "https://github.com/octocat/Hello-World"
        assert classify_url(url) == URLCategory.GITHUB_REPO

        text = "Repo: github.com/octocat/Hello-World"
        result = extract_rule_based_fields(text)
        assert len(result.project_links) == 1
        assert result.project_links[0].category == URLCategory.GITHUB_REPO
        assert len(result.github_profiles) == 0

    @pytest.mark.parametrize(
        "reserved_url",
        [
            "https://github.com/features",
            "https://github.com/settings",
            "https://github.com/marketplace",
            "https://github.com/login",
            "https://github.com/signup",
            "https://github.com/topics",
            "https://github.com/orgs/my-org",
            "https://github.com/explore",
            "https://github.com/pricing",
        ],
    )
    def test_exclude_reserved_github_routes_from_profiles(
        self, reserved_url: str
    ) -> None:
        cat = classify_url(reserved_url)
        assert cat == URLCategory.GENERAL
        result = extract_rule_based_fields(reserved_url)
        assert len(result.github_profiles) == 0

    def test_classify_linkedin_personal_profile(self) -> None:
        urls = [
            "https://linkedin.com/in/jane-doe",
            "https://www.linkedin.com/in/jane-doe/",
            "https://in.linkedin.com/in/jane-doe",
        ]
        for u in urls:
            assert classify_url(u) == URLCategory.LINKEDIN_PROFILE

        text = "LinkedIn: linkedin.com/in/jane-doe"
        result = extract_rule_based_fields(text)
        assert len(result.linkedin_profiles) == 1
        assert result.linkedin_profiles[0].category == URLCategory.LINKEDIN_PROFILE

    def test_classify_linkedin_company_as_organization_not_personal_profile(
        self,
    ) -> None:
        url = "https://www.linkedin.com/company/acme-corp"
        assert classify_url(url) == URLCategory.LINKEDIN_COMPANY

        text = "Company link: linkedin.com/company/acme-corp"
        result = extract_rule_based_fields(text)
        assert len(result.linkedin_profiles) == 0
        assert len(result.urls) == 1
        assert result.urls[0].category == URLCategory.LINKEDIN_COMPANY

    @pytest.mark.parametrize(
        "unrelated_linkedin",
        [
            "https://www.linkedin.com/jobs/view/12345",
            "https://www.linkedin.com/feed/",
            "https://www.linkedin.com/login",
        ],
    )
    def test_ignore_unrelated_linkedin_routes(self, unrelated_linkedin: str) -> None:
        assert classify_url(unrelated_linkedin) == URLCategory.GENERAL
        result = extract_rule_based_fields(unrelated_linkedin)
        assert len(result.linkedin_profiles) == 0

    def test_unrelated_and_lookalike_hostnames_not_classified(self) -> None:
        lookalikes = [
            "https://fakegithub.com/octocat",
            "https://notlinkedin.com/in/user",
            "https://gist.github.com/octocat",
        ]
        for u in lookalikes:
            assert classify_url(u) == URLCategory.GENERAL


class TestAnnotationIntegration:
    """Tests for PDFLink hyperlink annotation ingestion and merging."""

    def test_extract_hidden_url_with_anchor_text(self) -> None:
        text = "My Portfolio and Projects"
        links = [
            PDFLink(
                url="https://alexsmith.dev/portfolio",
                page=1,
                anchor_text="Portfolio",
            )
        ]
        result = extract_rule_based_fields(text, links=links)
        assert len(result.urls) == 1
        candidate = result.urls[0]
        assert candidate.url == "https://alexsmith.dev/portfolio"
        assert candidate.value == "https://alexsmith.dev/portfolio"
        assert len(candidate.evidence) == 1
        ev = candidate.evidence[0]
        assert ev.source_type == "annotation"
        assert ev.page == 1
        assert ev.anchor_text == "Portfolio"
        assert ev.start_offset is None
        assert ev.end_offset is None

    def test_extract_annotation_without_anchor_text(self) -> None:
        text = "Resume Header"
        links = [PDFLink(url="https://github.com/octocat", page=2, anchor_text=None)]
        result = extract_rule_based_fields(text, links=links)
        assert len(result.urls) == 1
        assert len(result.github_profiles) == 1
        ev = result.github_profiles[0].evidence[0]
        assert ev.source_type == "annotation"
        assert ev.page == 2
        assert ev.anchor_text is None

    def test_merge_text_and_annotation_duplicate_retaining_both_evidence(
        self,
    ) -> None:
        text = "GitHub: github.com/octocat"
        links = [
            PDFLink(
                url="https://github.com/octocat/",
                page=1,
                anchor_text="GitHub Profile",
            )
        ]
        result = extract_rule_based_fields(text, links=links)
        assert len(result.urls) == 1
        assert len(result.github_profiles) == 1
        candidate = result.github_profiles[0]
        assert candidate.value == "github.com/octocat"
        assert len(candidate.evidence) == 2

        # First evidence is from text
        assert candidate.evidence[0].source_type == "text"
        assert candidate.evidence[0].start_offset == 8
        assert candidate.evidence[0].end_offset == 26

        # Second evidence is from annotation
        assert candidate.evidence[1].source_type == "annotation"
        assert candidate.evidence[1].page == 1
        assert candidate.evidence[1].anchor_text == "GitHub Profile"

    def test_mailto_annotation_creates_email_candidate(self) -> None:
        text = "Contact section"
        links = [
            PDFLink(
                url="mailto:octocat@github.com?subject=Inquiry",
                page=1,
                anchor_text="Email Me",
            )
        ]
        result = extract_rule_based_fields(text, links=links)
        assert len(result.emails) == 1
        assert len(result.urls) == 0
        candidate = result.emails[0]
        assert candidate.value == "octocat@github.com"
        ev = candidate.evidence[0]
        assert ev.source_type == "annotation"
        assert ev.page == 1
        assert ev.anchor_text == "Email Me"

    def test_tel_annotation_creates_phone_candidate(self) -> None:
        text = "Header details"
        links = [
            PDFLink(
                url="tel:+12025550123",
                page=1,
                anchor_text="Call Me",
            )
        ]
        result = extract_rule_based_fields(text, links=links)
        assert len(result.phones) == 1
        assert len(result.urls) == 0
        candidate = result.phones[0]
        assert candidate.normalized == "+12025550123"
        ev = candidate.evidence[0]
        assert ev.source_type == "annotation"
        assert ev.page == 1
        assert ev.anchor_text == "Call Me"

    def test_ignore_unsupported_annotation_schemes(self) -> None:
        text = "Links section"
        links = [
            PDFLink(url="javascript:alert('xss')", page=1, anchor_text="XSS"),
            PDFLink(url="file:///etc/passwd", page=1, anchor_text="Local File"),
            PDFLink(url="ftp://ftp.example.com", page=1, anchor_text="FTP"),
        ]
        result = extract_rule_based_fields(text, links=links)
        assert len(result.urls) == 0


class TestEdgeCasesAndSafety:
    """Safety and regression tests for rule extraction."""

    def test_empty_and_none_text_safely_handled(self) -> None:
        res1 = extract_rule_based_fields("")
        assert res1.emails == []
        assert res1.phones == []
        assert res1.urls == []

        res2 = extract_rule_based_fields(None)  # type: ignore[arg-type]
        assert res2.emails == []
        assert res2.phones == []
        assert res2.urls == []

    def test_empty_and_none_links_safely_handled(self) -> None:
        text = "Email: dev@example.com"
        res1 = extract_rule_based_fields(text, links=None)
        assert len(res1.emails) == 1

        res2 = extract_rule_based_fields(text, links=[])
        assert len(res2.emails) == 1

    def test_input_text_and_links_not_mutated(self) -> None:
        original_text = "Developer: test@example.com with https://github.com/test"
        text_copy = str(original_text)
        links = [
            PDFLink(
                url="https://linkedin.com/in/test",
                page=1,
                anchor_text="LinkedIn",
            )
        ]
        links_copy = list(links)

        extract_rule_based_fields(original_text, links=links)

        assert original_text == text_copy
        assert links == links_copy

    def test_candidate_models_extra_forbid(self) -> None:
        with pytest.raises(ValidationError):
            EmailCandidate(value="test@example.com", extra_field="forbidden")  # type: ignore[call-arg]

        with pytest.raises(ValidationError):
            PhoneCandidate(
                value="9876543210",
                normalized="9876543210",
                extra_field="bad",  # type: ignore[call-arg]
            )

        with pytest.raises(ValidationError):
            URLCandidate(
                value="example.com",
                url="https://example.com",
                category=URLCategory.GENERAL,
                extra_field="bad",  # type: ignore[call-arg]
            )

        with pytest.raises(ValidationError):
            SourceEvidence(
                extracted_value="val",
                source_type="text",
                extra_field="bad",  # type: ignore[call-arg]
            )

        with pytest.raises(ValidationError):
            RuleExtractionResult(extra_field="bad")  # type: ignore[call-arg]
