"""ASGI middleware for request correlation, structured access logging, and metrics."""

import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.observability.logging import log_event
from app.observability.metrics import _normalize_route, record_http_request
from app.observability.request_id import (
    REQUEST_ID_HEADER,
    resolve_request_id,
    set_request_id,
)


class ObservabilityMiddleware:
    """ASGI middleware providing request correlation, logs, and metrics."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # 1. Extract incoming request ID header if present
        incoming_header: str | None = None
        for name_bytes, val_bytes in scope.get("headers", []):
            if name_bytes.decode("latin1", errors="ignore").lower() == "x-request-id":
                incoming_header = val_bytes.decode("latin1", errors="ignore")
                break

        # 2. Strict validation and cryptographically random fallback
        request_id = resolve_request_id(incoming_header)
        set_request_id(request_id)

        method = scope.get("method", "GET").upper()
        raw_path = scope.get("path", "/")
        normalized_route = _normalize_route(raw_path)

        start_time = time.perf_counter()
        status_code = 500  # Default if an exception crashes before response start

        log_event(
            event="request_started",
            method=method,
            route=normalized_route,
            request_id=request_id,
        )

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 200)
                # Attach X-Request-ID response header
                headers = list(message.get("headers", []))
                # Avoid duplicate if already present
                has_req_id = any(
                    h[0].decode("latin1", errors="ignore").lower() == "x-request-id"
                    for h in headers
                )
                if not has_req_id:
                    headers.append(
                        (
                            REQUEST_ID_HEADER.encode("ascii"),
                            request_id.encode("ascii"),
                        )
                    )
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - start_time
            duration_ms = round(elapsed * 1000, 2)

            # Record Prometheus metrics safely
            record_http_request(
                route=normalized_route,
                method=method,
                status_code=status_code,
                duration_seconds=elapsed,
            )

            # Log completion or failure event
            if status_code < 400:
                log_event(
                    event="request_completed",
                    method=method,
                    route=normalized_route,
                    http_status=status_code,
                    duration_ms=duration_ms,
                    request_id=request_id,
                )
            else:
                log_event(
                    event="request_failed",
                    method=method,
                    route=normalized_route,
                    http_status=status_code,
                    duration_ms=duration_ms,
                    request_id=request_id,
                )

            set_request_id(None)
