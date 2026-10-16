"""Unit tests for text cleaning and normalization pipeline."""

import pytest

from app.extraction.cleaner import clean_text


class TestTextCleaner:
    """Test suite for clean_text function."""

    def test_empty_and_whitespace_input(self):
        """Verify handling of empty or purely whitespace strings."""
        assert clean_text("") == ""
        assert clean_text("   \n\t  \n  ") == ""

    def test_control_characters_removed_preserving_newlines_and_tabs(self):
        """Verify harmful control characters are stripped while whitespace remains."""
        raw = "Name:\x00 John\x07 Doe\x08\tTitle:\x0b Lead\nLocation:\x1f London"
        cleaned = clean_text(raw)
        assert "\x00" not in cleaned
        assert "\x07" not in cleaned
        assert "\x08" not in cleaned
        assert "\x0b" not in cleaned
        assert "\x1f" not in cleaned
        assert "Name: John Doe\tTitle: Lead\nLocation: London" in cleaned

    def test_unicode_normalization_nfkc(self):
        """Verify Unicode normalization handles fullwidth and ligature characters."""
        # Fullwidth Latin letters and ligatures
        raw = "Ｆｕｌｌｗｉｄｔｈ Ｔｅｘｔ and ﬁrst-class"
        cleaned = clean_text(raw)
        assert cleaned == "Fullwidth Text and first-class"

    def test_bullet_normalization(self):
        """Verify various Unicode bullets are normalized uniformly to bullet point."""
        bullets = [
            "• Bullet One",
            "‣ Bullet Two",
            "⁃ Bullet Three",
            "∙ Bullet Four",
            "◦ Bullet Five",
            "▪ Bullet Six",
            "▫ Bullet Seven",
            "★ Bullet Eight",
        ]
        raw = "\n".join(bullets)
        cleaned = clean_text(raw)
        for line in cleaned.split("\n"):
            assert line.startswith("• ")

    def test_dash_variants_normalized_to_hyphen(self):
        """Verify various dash characters are normalized to standard hyphens."""
        raw = "Jan 2020 – Dec 2022\n2018 — 2019\nMinus: 5 − 3"
        cleaned = clean_text(raw)
        assert "Jan 2020 - Dec 2022" in cleaned
        assert "2018 - 2019" in cleaned
        assert "5 - 3" in cleaned

    def test_hyphenated_line_breaks_repaired_conservatively(self):
        """Verify broken words across linebreaks are rejoined, preserving compounds."""
        raw = (
            "During the implemen-\n  tation of the distributed archi-\n"
            "  tecture, we built a cross-\n  platform, high-\n  level framework."
        )
        cleaned = clean_text(raw)
        assert "implementation" in cleaned
        assert "architecture" in cleaned
        assert "cross-platform" in cleaned
        assert "high-level" in cleaned

    def test_excessive_whitespace_and_newlines_collapsed(self):
        """Verify multiple spaces and runs of 3+ newlines are collapsed cleanly."""
        raw = (
            "Section Header\n\n\n\n\n"
            "This   is   a    paragraph   with   wide   spacing.\n\n\n\n"
            "Next   paragraph."
        )
        cleaned = clean_text(raw)
        assert "\n\n\n" not in cleaned
        assert "This is a paragraph with wide spacing." in cleaned
        assert "Next paragraph." in cleaned

    def test_paragraph_boundaries_and_headings_preserved(self):
        """Verify separate lines and paragraph boundaries are preserved."""
        raw = (
            "EXPERIENCE\n\n"
            "Software Engineer - Acme Corp\n"
            "2020 - Present\n\n"
            "• Built microservices\n"
            "• Managed deployments"
        )
        cleaned = clean_text(raw)
        lines = cleaned.split("\n")
        assert len(lines) >= 5
        assert "EXPERIENCE" in lines[0]
        assert "Software Engineer - Acme Corp" in lines[2]

    def test_preserves_technical_terms_and_grades(self):
        """Verify skill names, emails, URLs, and grades remain intact."""
        raw = (
            "Skills: C++, C#, .NET, Node.js, Python 3.12, Vue.js\n"
            "Email: dev.lead+testing@example.co.uk\n"
            "Portfolio: https://github.com/onevue/core-api\n"
            "Education: CGPA 3.85/4.00, Grade: 92.5%"
        )
        cleaned = clean_text(raw)
        assert "C++" in cleaned
        assert "C#" in cleaned
        assert ".NET" in cleaned
        assert "Node.js" in cleaned
        assert "Python 3.12" in cleaned
        assert "Vue.js" in cleaned
        assert "dev.lead+testing@example.co.uk" in cleaned
        assert "https://github.com/onevue/core-api" in cleaned
        assert "3.85/4.00" in cleaned
        assert "92.5%" in cleaned

    @pytest.mark.parametrize(
        "sample",
        [
            "Simple single line text.",
            "Heading\n\n• Bullet 1\n• Bullet 2\n\nParagraph text here.",
            "Special characters: C++, C#, .NET, test@example.com, https://example.com",
            "Hyphenated implemen-\n  tation and cross-\n  platform solutions.",
        ],
    )
    def test_clean_text_idempotency(self, sample: str):
        """Verify repeated cleaning produces the exact same output (idempotence)."""
        first_pass = clean_text(sample)
        second_pass = clean_text(first_pass)
        third_pass = clean_text(second_pass)
        assert first_pass == second_pass
        assert second_pass == third_pass
