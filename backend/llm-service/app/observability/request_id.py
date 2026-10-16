"""Request correlation ID utilities for ONEVUE LLM Service."""

import re
import uuid
from contextvars import ContextVar

# Standard request correlation header
REQUEST_ID_HEADER = "X-Request-ID"

# Strict alphanumeric, hyphen, underscore pattern; length 1 to 64 chars
_REQUEST_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")

# Task-isolated context variable for current request ID
_request_id_ctx: ContextVar[str | None] = ContextVar("request_id_ctx", default=None)


def get_request_id() -> str | None:
    """Return the active request ID from the current async execution context."""
    return _request_id_ctx.get()


def set_request_id(request_id: str | None) -> None:
    """Set the active request ID in the current async execution context."""
    _request_id_ctx.set(request_id)


def is_valid_request_id(value: str | None) -> bool:
    """Validate incoming request ID against strict length and character constraints.

    Must be non-empty, between 1 and 64 characters, and consist solely of
    ASCII alphanumeric characters, underscores, and hyphens.
    """
    if not value or not isinstance(value, str):
        return False
    return bool(_REQUEST_ID_PATTERN.match(value))


def resolve_request_id(incoming: str | None) -> str:
    """Validate incoming request ID header or generate a cryptographically random UUID.

    Never trusts arbitrary or malformed incoming header values.
    """
    if incoming is not None:
        cleaned = incoming.strip()
        if is_valid_request_id(cleaned):
            return cleaned
    return str(uuid.uuid4())
