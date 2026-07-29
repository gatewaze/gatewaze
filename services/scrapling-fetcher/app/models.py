"""Pydantic request/response models for /fetch and /egress/*."""

from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


FetchMode = Literal["fast", "stealth", "browser"]
ProxyChoice = Literal["auto", "force", "never"]

# Bare lowercase hostname: no scheme/path/port/userinfo/wildcard/IP literal
# (spec §5.1). Total length 1-253; each label starts+ends alphanumeric.
_TARGET_HOST_RE = re.compile(
    r"^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*)(\.[a-z0-9](-?[a-z0-9])*)+$"
)
_CONSUMER_RE = re.compile(r"^[a-z0-9-]{1,64}$")
_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
_JOB_ID_RE = re.compile(r"^[a-z0-9:_-]{1,128}$")


class FetchRequest(BaseModel):
    url: str = Field(..., description="Absolute http(s) URL to fetch")
    mode: FetchMode = "fast"
    extract_next_data: bool = True
    wait_for: str | None = None
    timeout_ms: int = Field(30000, ge=1000, le=60000)
    proxy: ProxyChoice = "auto"
    # Screenshot capture in browser mode. When true, response includes
    # `screenshot_png_b64` (base64 PNG bytes). Ignored for non-browser
    # modes — scrapling-fetcher returns 400 if requested with mode!=browser.
    capture_screenshot: bool = False
    # Screenshot options when capture_screenshot=true.
    screenshot_full_page: bool = False
    screenshot_clip: dict[str, int] | None = None  # {x, y, width, height}

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("url scheme must be http or https")
        if not parsed.hostname:
            raise ValueError("url must include a host")
        return v


class FetchTiming(BaseModel):
    fetch_ms: int
    total_ms: int


class RedirectHop(BaseModel):
    url: str
    status: int


class FetchResponse(BaseModel):
    status: int
    html: str
    next_data: dict[str, Any] | None
    headers: dict[str, str]
    timing: FetchTiming
    mode_used: FetchMode
    # Spec-gatewaze-fetch §0.2 additions — required by gatewaze-fetch
    # for billing accounting and final-URL governance.
    bytes_in: int = 0
    bytes_out: int = 0
    proxy_bytes: int = 0  # bytes billed by residential proxy; 0 when no proxy
    browser_seconds: float = 0.0  # browser context hold time; 0 for non-browser
    final_url: str = ""  # post-redirect URL; equals input URL when no redirects
    redirect_chain: list[RedirectHop] = []  # bounded to 10 hops
    # Screenshot — base64 PNG bytes when capture_screenshot was true.
    screenshot_png_b64: str | None = None
    screenshot_width: int | None = None
    screenshot_height: int | None = None


class ErrorBody(BaseModel):
    error: str
    request_id: str | None = None
    detail: str | None = None


# ---------------------------------------------------------------------------
# Egress lease models (spec §5)
# ---------------------------------------------------------------------------


class EgressLeaseRequest(BaseModel):
    """POST /egress/lease body (§5.1)."""

    consumer: str = Field(..., description="cost-ledger feature; ^[a-z0-9-]{1,64}$")
    target_host: str = Field(..., description="bare lowercase hostname")
    sticky: bool = True
    country: str | None = None
    ttl_seconds: int | None = Field(None, description="clamped to [60, 900]")
    job_id: str | None = None

    @field_validator("consumer")
    @classmethod
    def _validate_consumer(cls, v: str) -> str:
        if not _CONSUMER_RE.match(v):
            raise ValueError("consumer must match ^[a-z0-9-]{1,64}$")
        return v

    @field_validator("target_host")
    @classmethod
    def _validate_target_host(cls, v: str) -> str:
        if not _TARGET_HOST_RE.match(v):
            raise ValueError(
                "target_host must be a bare lowercase hostname (no scheme, "
                "path, port, userinfo, wildcard, or IP literal)"
            )
        return v

    @field_validator("country")
    @classmethod
    def _validate_country(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _COUNTRY_RE.match(v):
            raise ValueError("country must be ISO-3166 alpha-2 (^[A-Z]{2}$) or null")
        return v

    @field_validator("job_id")
    @classmethod
    def _validate_job_id(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _JOB_ID_RE.match(v):
            raise ValueError("job_id must match ^[a-z0-9:_-]{1,128}$")
        return v


class EgressLeaseResponse(BaseModel):
    lease_id: str
    proxy_url: str | None  # SECRET — never logged server-side (§10.3)
    sticky_session_id: str | None
    expires_at: str  # ISO-8601 UTC, e.g. 2026-07-28T12:34:56Z
    ttl_seconds: int
    provider: str
    byte_cap_bytes: int


class EgressReportRequest(BaseModel):
    """POST /egress/report body (§5.2)."""

    lease_id: str = Field(..., min_length=1)
    bytes_in: int = Field(0, ge=0)
    bytes_out: int = Field(0, ge=0)
    requests: int = Field(0, ge=0)
    final: bool = False


class EgressReportResponse(BaseModel):
    accepted: bool
    bytes_total_for_lease: int
    cap_remaining_bytes: int
    cap_exceeded: bool = False


class EgressHealthResponse(BaseModel):
    provider: str
    status: Literal["ok", "degraded", "unavailable"]
    provider_health: dict[str, Any]
    daily_gb_used: float
    daily_gb_cap: float
    active_leases: int
