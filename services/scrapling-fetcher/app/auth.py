"""Internal-token authentication middleware."""

from __future__ import annotations

import secrets

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


PUBLIC_PATHS = frozenset({"/healthz", "/readyz", "/metrics"})


class InternalTokenMiddleware(BaseHTTPMiddleware):
    """Reject any request to a non-public path that lacks the matching token.

    Comparison is constant-time to prevent timing attacks. The 401 response
    includes a WWW-Authenticate header per RFC 7235 §4.1.
    """

    def __init__(self, app, *, expected_token: str) -> None:
        super().__init__(app)
        self._expected_token = expected_token

    async def dispatch(self, request: Request, call_next):
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        provided = request.headers.get("X-Internal-Token", "")
        if not provided or not secrets.compare_digest(
            provided, self._expected_token
        ):
            return JSONResponse(
                status_code=401,
                content={"error": "auth_required"},
                headers={
                    "WWW-Authenticate": 'InternalToken realm="scrapling-fetcher"',
                },
            )
        return await call_next(request)
