"""API Key authentication dependency for ONEVUE LLM Service."""

import logging
import secrets
from typing import Annotated

from fastapi import Depends, Header

from app.api.errors import ServiceAPIError
from app.config import Settings, get_settings
from app.schemas.errors import ErrorCode

logger = logging.getLogger(__name__)


async def verify_api_key(
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,
) -> str:
    """Verify incoming client request authentication via X-API-Key header.

    Supports zero-downtime API credential rotation with constant-time comparison
    across all valid keys in the active rotation window.
    Fails closed if no API keys are configured.
    Strictly forbids accepting METRICS_TOKEN as a service API credential.
    Never logs or exposes submitted credentials, configured keys, or fingerprints.

    Args:
        x_api_key: Value of the incoming X-API-Key header.
        settings: Application settings instance.

    Returns:
        Verified API key string.

    Raises:
        ServiceAPIError: 401 Unauthorized if key is missing, invalid, or unconfigured.
    """
    valid_keys = settings.effective_service_api_keys

    # 1. Fail closed if no valid service API key is configured
    if not valid_keys:
        logger.error("Authentication check failed: service API key is not configured.")
        raise ServiceAPIError(
            status_code=401,
            code=ErrorCode.UNAUTHORIZED,
            message="Service authentication is unconfigured or unavailable.",
        )

    # 2. Check for missing header or empty candidate
    if not x_api_key or not x_api_key.strip():
        logger.warning(
            "Authentication check failed: missing or empty X-API-Key header."
        )
        raise ServiceAPIError(
            status_code=401,
            code=ErrorCode.UNAUTHORIZED,
            message="Missing or invalid API key.",
        )

    clean_key = x_api_key.strip()
    if len(clean_key) > 512:
        logger.warning(
            "Authentication check failed: X-API-Key header exceeds maximum length."
        )
        raise ServiceAPIError(
            status_code=401,
            code=ErrorCode.UNAUTHORIZED,
            message="Missing or invalid API key.",
        )

    # 3. Security Boundary: Metrics token must NEVER be accepted as service API key
    metrics_token = settings.METRICS_TOKEN.strip() if settings.METRICS_TOKEN else ""
    if metrics_token and secrets.compare_digest(clean_key, metrics_token):
        logger.warning(
            "Authentication check failed: metrics token cannot be used as "
            "service API key."
        )
        raise ServiceAPIError(
            status_code=401,
            code=ErrorCode.UNAUTHORIZED,
            message="Missing or invalid API key.",
        )

    # 4. Constant-time comparison across all valid keys
    # Iterate through all configured keys to maintain constant-time behavior
    # regardless of which key in the rotation window matched.
    is_valid = False
    for valid_key in valid_keys:
        if secrets.compare_digest(clean_key, valid_key):
            is_valid = True

    if not is_valid:
        logger.warning("Authentication check failed: invalid X-API-Key header.")
        raise ServiceAPIError(
            status_code=401,
            code=ErrorCode.UNAUTHORIZED,
            message="Missing or invalid API key.",
        )

    return clean_key
