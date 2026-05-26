"""Pydantic request/response models for /fetch."""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


FetchMode = Literal["fast", "stealth", "browser"]
ProxyChoice = Literal["auto", "force", "never"]


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
