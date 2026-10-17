"""API exceptions and HTTP error mappings for ONEVUE LLM Service."""

from app.schemas.errors import ErrorCode


class ServiceAPIError(Exception):
    """Custom API exception representing client or service errors.

    Encapsulates structured error payloads without exposing internal details.

    Attributes:
        status_code: HTTP status code (e.g., 400, 401, 413, 422, 500, 502, 503).
        code: ErrorCode enum identifying the nature of the failure.
        message: Sanitized error description without raw document content or secrets.
    """

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers
