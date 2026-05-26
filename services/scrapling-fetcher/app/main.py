"""scrapling-fetcher FastAPI app — entry point.

Spec: gatewaze-environments/specs/spec-scrapling-fetcher-service.md
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from .auth import InternalTokenMiddleware
from .config import Settings
from .cost_ledger import CostLedgerClient
from .fetcher_pool import FetcherPool, extract_next_data
from .models import ErrorBody, FetchRequest, FetchResponse, FetchTiming, RedirectHop
from .proxy import load_provider
from .proxy.base import FetchOutcome
from .ssrf import SsrfBlockedError, check_url_or_raise


logger = logging.getLogger("scrapling-fetcher")


_FETCH_TOTAL = Counter(
    "scrapling_fetch_total",
    "Fetch attempts grouped by mode and upstream status class",
    ["mode", "status_class"],
)
_FETCH_DURATION = Histogram(
    "scrapling_fetch_duration_seconds",
    "End-to-end fetch latency by mode",
    ["mode"],
)
_BROWSER_POOL_SIZE = Gauge(
    "scrapling_browser_pool_size",
    "Browser contexts currently in use",
)
_BROWSER_POOL_MAX = Gauge(
    "scrapling_browser_pool_max",
    "Maximum browser pool size",
)
_PROXY_BYTES = Counter(
    "scrapling_proxy_bytes_total",
    "Bytes through the proxy provider",
    ["direction"],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    logging.basicConfig(level=settings.log_level)
    pool = FetcherPool(
        fast_concurrency=settings.fast_concurrency,
        browser_pool_size=settings.browser_pool_size,
        default_timeout_ms=settings.default_timeout_ms,
    )
    provider = load_provider(settings.proxy_provider, settings.proxy_config)
    ledger = CostLedgerClient(settings.supabase_url, settings.supabase_service_key)
    _BROWSER_POOL_MAX.set(pool.browser_pool_max)
    app.state.settings = settings
    app.state.pool = pool
    app.state.provider = provider
    app.state.ledger = ledger
    logger.info(
        "scrapling-fetcher ready: provider=%s mode=%s pool=%d concurrency=%d",
        provider.name,
        settings.proxy_mode,
        settings.browser_pool_size,
        settings.fast_concurrency,
    )
    try:
        yield
    finally:
        await ledger.aclose()


# Per spec §8.7: 30 req/sec per source IP, defence in depth. Implemented
# as ASGI middleware (not the @limiter.limit route decorator) because the
# decorator's wrapper interacts poorly with FastAPI 0.115's body parsing
# when both `request: Request` and a Pydantic body model are on the same
# handler — manifests as 422 "missing query field 'payload'".
limiter = Limiter(key_func=get_remote_address, default_limits=["30/second"])

app = FastAPI(lifespan=lifespan, openapi_url=None, docs_url=None, redoc_url=None)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"error": "rate_limited"},
        headers={"Retry-After": "1"},
    )


# Order matters: middlewares run outer-to-inner in registration order, so
# rate-limiting (outer) runs before auth (inner) — an unauthenticated
# attacker still consumes the rate-limit budget.
app.add_middleware(SlowAPIMiddleware)
import os as _os
app.add_middleware(
    InternalTokenMiddleware,
    expected_token=_os.environ.get("SCRAPLING_INTERNAL_TOKEN", ""),
)


def _status_class(status: int) -> str:
    if 200 <= status < 300:
        return "2xx"
    if 300 <= status < 400:
        return "3xx"
    if 400 <= status < 500:
        return "4xx"
    if 500 <= status < 600:
        return "5xx"
    return "other"


def _should_use_proxy(
    proxy_choice: str, mode: str, settings: Settings
) -> bool:
    if proxy_choice == "force":
        return True
    if proxy_choice == "never":
        return False
    # auto: defer to SCRAPLING_PROXY_MODE
    if settings.proxy_mode == "always":
        return True
    if settings.proxy_mode == "stealth-only":
        return mode in ("stealth", "browser")
    return False


@app.post("/fetch", response_model=FetchResponse, responses={
    400: {"model": ErrorBody},
    401: {"model": ErrorBody},
    403: {"model": ErrorBody},
    415: {"model": ErrorBody},
    422: {"model": ErrorBody},
    500: {"model": ErrorBody},
    502: {"model": ErrorBody},
    503: {"model": ErrorBody},
    504: {"model": ErrorBody},
})
async def fetch(request: Request, payload: Annotated[FetchRequest, Body()]):
    request_id = uuid.uuid4().hex
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        return JSONResponse(
            status_code=415,
            content={"error": "unsupported_media_type", "request_id": request_id},
        )

    settings: Settings = app.state.settings
    pool: FetcherPool = app.state.pool
    provider = app.state.provider
    ledger: CostLedgerClient = app.state.ledger

    overall_start = time.perf_counter()

    try:
        target = check_url_or_raise(payload.url)
    except SsrfBlockedError as e:
        logger.error(
            "ssrf_blocked request_id=%s host=%s ip=%s reason=%s",
            request_id, e.host, e.ip, e.reason,
        )
        return JSONResponse(
            status_code=403,
            content={"error": "ssrf_blocked", "request_id": request_id, "detail": e.reason},
        )

    use_proxy = _should_use_proxy(payload.proxy, payload.mode, settings)
    proxy_decision = None
    if use_proxy:
        proxy_decision = await provider.get_proxy_for(
            payload.url, payload.mode, {}
        )

    proxy_url = proxy_decision.get("proxy_url") if proxy_decision else None

    if payload.capture_screenshot and payload.mode != "browser":
        return JSONResponse(
            status_code=400,
            content={
                "error": "screenshot_requires_browser_mode",
                "request_id": request_id,
            },
        )

    try:
        if payload.mode == "fast":
            raw = await pool.fetch_fast(
                target, timeout_ms=payload.timeout_ms, proxy_url=proxy_url,
            )
        elif payload.mode == "stealth":
            raw = await pool.fetch_stealth(
                target, timeout_ms=payload.timeout_ms, proxy_url=proxy_url,
            )
        else:  # browser
            raw = await pool.fetch_browser(
                target,
                timeout_ms=payload.timeout_ms,
                proxy_url=proxy_url,
                wait_for=payload.wait_for,
                capture_screenshot=payload.capture_screenshot,
                screenshot_full_page=payload.screenshot_full_page,
                screenshot_clip=payload.screenshot_clip,
            )
    except httpx.TimeoutException:
        logger.warning("upstream_timeout request_id=%s url=%s", request_id, payload.url)
        return JSONResponse(
            status_code=504,
            content={"error": "upstream_timeout", "request_id": request_id},
        )
    except RuntimeError as e:
        msg = str(e)
        if msg == "browser_pool_exhausted":
            return JSONResponse(
                status_code=503,
                content={"error": "browser_pool_exhausted", "request_id": request_id},
            )
        logger.warning(
            "upstream_connect_error request_id=%s url=%s err=%s",
            request_id, payload.url, msg,
        )
        return JSONResponse(
            status_code=502,
            content={"error": "upstream_connect_error", "request_id": request_id, "detail": msg},
        )

    next_data = extract_next_data(raw.html) if payload.extract_next_data else None

    _FETCH_TOTAL.labels(mode=payload.mode, status_class=_status_class(raw.status)).inc()
    _FETCH_DURATION.labels(mode=payload.mode).observe(raw.fetch_ms / 1000)
    _BROWSER_POOL_SIZE.set(pool.browser_pool_in_use)

    proxy_bytes = 0
    if proxy_decision and proxy_url:
        outcome = FetchOutcome(
            status=raw.status,
            bytes_in=raw.bytes_in,
            bytes_out=raw.bytes_out,
            headers=raw.headers,
        )
        usage = await provider.record_usage(proxy_decision, outcome)
        # Per spec §0.2: when the provider's bytes-counter API returns the
        # billed figure, that's authoritative; otherwise fall back to
        # bytes_in + bytes_out for the proxied portion.
        proxy_bytes = usage.get("bytes_in", 0) + usage.get("bytes_out", 0)
        _PROXY_BYTES.labels(direction="in").inc(usage.get("bytes_in", 0))
        _PROXY_BYTES.labels(direction="out").inc(usage.get("bytes_out", 0))
        # Best-effort cost-ledger insert; brand_id has to come from the
        # caller's environment — for now we use SCRAPLING_BRAND_ID.
        brand_id = _os.environ.get("SCRAPLING_BRAND_ID", "unknown")
        await ledger.record(
            brand_id=brand_id,
            provider=provider.name,
            product="residential-proxy",
            feature="scraper:fetch",
            units_in=usage.get("bytes_in", 0),
            units_out=usage.get("bytes_out", 0),
            cost_usd=usage.get("cost_usd_estimate") or 0.0,
            request_id=request_id,
            context={"target_host": target.host, "mode": payload.mode},
        )

    total_ms = int((time.perf_counter() - overall_start) * 1000)

    import base64
    screenshot_b64 = (
        base64.b64encode(raw.screenshot_png).decode("ascii")
        if raw.screenshot_png is not None
        else None
    )
    return FetchResponse(
        status=raw.status,
        html=raw.html,
        next_data=next_data,
        headers=raw.headers,
        timing=FetchTiming(fetch_ms=raw.fetch_ms, total_ms=total_ms),
        mode_used=payload.mode,
        bytes_in=raw.bytes_in,
        bytes_out=raw.bytes_out,
        proxy_bytes=proxy_bytes,
        browser_seconds=raw.browser_seconds,
        final_url=raw.final_url or payload.url,
        redirect_chain=[RedirectHop(**hop) for hop in raw.redirect_chain],
        screenshot_png_b64=screenshot_b64,
        screenshot_width=raw.screenshot_width,
        screenshot_height=raw.screenshot_height,
    )


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    pool: FetcherPool | None = getattr(app.state, "pool", None)
    if pool is None:
        return JSONResponse(status_code=503, content={"status": "warming"})
    return {"status": "ready", "browser_pool_max": pool.browser_pool_max}


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
