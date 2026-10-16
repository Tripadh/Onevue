"""Field path helpers for structured resume schema navigation."""

import re
from collections.abc import Sequence

_PATH_TOKEN_REGEX = re.compile(r"([a-zA-Z_][a-zA-Z0-9_]*)|\[(\d+)\]")


def build_field_path(*segments: str | int | Sequence[str | int]) -> str:
    """Produce consistent, robust field paths for nested values and list indices.

    Examples:
        build_field_path("profile", "email") -> "profile.email"
        build_field_path("education", 0, "institution")
        build_field_path("experience", 1, "bullets", 2)
        build_field_path("skills", 4, "name") -> "skills[4].name"
        build_field_path("projects", 0, "technologies", 1)

    Args:
        *segments: Positional segments (str or int) or an iterable of segments.

    Returns:
        Formatted field path string using dot notation and bracketed zero-based indices.

    Raises:
        ValueError: If a list index is negative or a string segment is empty.
        TypeError: If a segment is not a string, integer, or sequence of those.
    """
    flat: list[str | int] = []
    for item in segments:
        if isinstance(item, (list, tuple)):
            flat.extend(item)
        else:
            flat.append(item)

    if not flat:
        return ""

    parts: list[str] = []
    for seg in flat:
        if isinstance(seg, int):
            if seg < 0:
                raise ValueError(f"List index cannot be negative: {seg}")
            parts.append(f"[{seg}]")
        elif isinstance(seg, str):
            clean = seg.strip()
            if not clean:
                raise ValueError("Path segment cannot be empty or whitespace-only")
            if clean.startswith("[") and clean.endswith("]"):
                parts.append(clean)
            elif parts:
                parts.append(f".{clean}")
            else:
                parts.append(clean)
        else:
            raise TypeError(
                f"Path segments must be str or int, got {type(seg).__name__}: {seg!r}"
            )

    return "".join(parts)


def parse_field_path(path: str) -> list[str | int]:
    """Parse a field path string into individual property names and integer indices.

    Examples:
        parse_field_path("profile.email") -> ["profile", "email"]
        parse_field_path("education[0].institution") -> ["education", 0, "institution"]
        parse_field_path("experience[1].bullets[2]") -> ["experience", 1, "bullets", 2]
    """
    if not path:
        return []
    if ".." in path or path.startswith(".") or path.endswith("."):
        raise ValueError(f"Invalid field path syntax: {path!r}")

    tokens: list[str | int] = []
    pos = 0
    while pos < len(path):
        if path[pos] == ".":
            pos += 1
        match = _PATH_TOKEN_REGEX.match(path, pos)
        if not match:
            raise ValueError(f"Invalid field path syntax at position {pos}: {path!r}")
        prop, idx = match.groups()
        if prop is not None:
            tokens.append(prop)
        elif idx is not None:
            tokens.append(int(idx))
        pos = match.end()

    if pos != len(path):
        raise ValueError(f"Invalid field path syntax: {path!r}")

    return tokens
