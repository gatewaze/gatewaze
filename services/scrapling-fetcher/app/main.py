"""scrapling-fetcher FastAPI app — entry point.

Spec: gatewaze-environments/specs/spec-scrapling-fetcher-service.md
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
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
from .lease import LeaseManager
from .models import (
    EgressHealthResponse,
    EgressLeaseRequest,
    EgressLeaseResponse,
    EgressReportRequest,
    EgressReportResponse,
    ErrorBody,
    FetchRequest,
    FetchResponse,
    FetchTiming,
    RedirectHop,
)
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

# Egress-lease metrics (spec §13.1).
_EGRESS_LEASES_TOTAL = Counter(
    "scrapling_egress_leases_total",
    "Egress lease attempts by consumer and result",
    ["consumer", "result"],
)
_EGRESS_LEASES_ACTIVE = Gauge(
    "scrapling_egress_leases_active",
    "Currently-held, un-expired egress leases",
)
_EGRESS_BYTES = Counter(
    "scrapling_egress_bytes_total",
    "Bytes reported against egress leases",
    ["consumer", "direction"],
)
_EGRESS_DAILY_GB_USED = Gauge(
    "scrapling_egress_daily_gb_used",
    "Residential-egress GB used so far in the current UTC day",
)
_EGRESS_DAILY_GB_CAP = Gauge(
    "scrapling_egress_daily_gb_cap",
    "Configured residential-egress daily GB soft cap",
)
_EGRESS_PROVIDER_HEALTHY = Gauge(
    "scrapling_egress_provider_healthy",
    "1 when the active proxy provider health_check reports ok, else 0",
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
    lease_manager = LeaseManager()
    _BROWSER_POOL_MAX.set(pool.browser_pool_max)
    _EGRESS_DAILY_GB_CAP.set(settings.proxy_daily_gb_cap)
    _EGRESS_LEASES_ACTIVE.set(0)
    app.state.settings = settings
    app.state.pool = pool
    app.state.provider = provider
    app.state.ledger = ledger
    app.state.lease_manager = lease_manager
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


def _host_allowlisted(host: str, allowlist: tuple[str, ...]) -> bool:
    """Suffix-match ``host`` against the configured allowlist (§8.4).

    An empty allowlist denies everything — nothing is explicitly allowed. A
    suffix matches only on a label boundary, so ``evil-youtube.com`` does NOT
    match the ``youtube.com`` suffix.
    """
    host = host.lower()
    for suffix in allowlist:
        if host == suffix or host.endswith("." + suffix):
            return True
    return False


def _source_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _audit_denied(
    *, request_id: str, source_ip: str, consumer: str, target_host: str, reason: str
) -> None:
    """Structured WARN for a denied lease attempt (§10.5). Never logs proxy_url."""
    logger.warning(
        "egress_lease_denied request_id=%s source_ip=%s consumer=%s "
        "target_host=%s reason=%s",
        request_id, source_ip, consumer, target_host, reason,
    )


def _iso_utc(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _health_status(health: dict) -> str:
    raw = str(health.get("status", "ok")).lower()
    if raw in ("ok", "degraded", "unavailable"):
        return raw
    return "ok"


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


@app.post("/egress/lease", response_model=EgressLeaseResponse, responses={
    400: {"model": ErrorBody},
    401: {"model": ErrorBody},
    403: {"model": ErrorBody},
    415: {"model": ErrorBody},
    422: {"model": ErrorBody},
    503: {"model": ErrorBody},
    507: {"model": ErrorBody},
    500: {"model": ErrorBody},
})
async def egress_lease(request: Request, payload: Annotated[EgressLeaseRequest, Body()]):
    request_id = uuid.uuid4().hex
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        return JSONResponse(
            status_code=415,
            content={"error": "unsupported_media_type", "request_id": request_id},
        )

    settings: Settings = app.state.settings
    provider = app.state.provider
    lease_manager: LeaseManager = app.state.lease_manager
    lease_manager.sweep_expired()
    source_ip = _source_ip(request)
    host = payload.target_host

    # (1) allowlist suffix-match (§8.4) — empty allowlist denies everything.
    if not _host_allowlisted(host, settings.egress_host_allowlist):
        _audit_denied(
            request_id=request_id, source_ip=source_ip, consumer=payload.consumer,
            target_host=host, reason="host_not_allowlisted",
        )
        _EGRESS_LEASES_TOTAL.labels(consumer=payload.consumer, result="denied_allowlist").inc()
        return JSONResponse(
            status_code=400,
            content={"error": "host_not_allowlisted", "request_id": request_id},
        )

    # (2) SSRF DNS-resolution guard (§5.1), reusing app/ssrf.py.
    try:
        check_url_or_raise(f"https://{host}/")
    except SsrfBlockedError as e:
        _audit_denied(
            request_id=request_id, source_ip=source_ip, consumer=payload.consumer,
            target_host=host, reason="ssrf_blocked",
        )
        _EGRESS_LEASES_TOTAL.labels(consumer=payload.consumer, result="denied_ssrf").inc()
        return JSONResponse(
            status_code=403,
            content={"error": "ssrf_blocked", "request_id": request_id, "detail": e.reason},
        )

    # (3) daily GB soft-cap already exhausted (§9.4).
    if lease_manager.daily_gb_used() >= settings.proxy_daily_gb_cap:
        _audit_denied(
            request_id=request_id, source_ip=source_ip, consumer=payload.consumer,
            target_host=host, reason="daily_cap_exceeded",
        )
        _EGRESS_LEASES_TOTAL.labels(consumer=payload.consumer, result="denied_cap").inc()
        return JSONResponse(
            status_code=507,
            content={"error": "daily_cap_exceeded", "request_id": request_id},
        )

    # (4) provider health gate — a failing provider means "egress down".
    try:
        health = await provider.health_check()
        healthy = _health_status(health) != "unavailable"
    except Exception as e:  # noqa: BLE001 — a provider fault must not 500 here
        health, healthy = None, False
        logger.warning(
            "egress_provider_health_error request_id=%s err=%s", request_id, e
        )
    _EGRESS_PROVIDER_HEALTHY.set(1 if healthy else 0)
    if not healthy:
        return JSONResponse(
            status_code=503,
            content={"error": "provider_unavailable", "request_id": request_id},
        )

    try:
        proxy_decision = await provider.get_proxy_for(
            f"https://{host}/", "lease", {"sticky": payload.sticky, "country": payload.country},
        )
    except Exception as e:  # noqa: BLE001
        logger.error("egress_lease_error request_id=%s err=%s", request_id, e)
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "request_id": request_id},
        )

    lease = lease_manager.issue(
        consumer=payload.consumer,
        target_host=host,
        sticky=payload.sticky,
        country=payload.country,
        ttl_seconds=payload.ttl_seconds,
        job_id=payload.job_id,
        proxy_decision=proxy_decision,
        provider_name=provider.name,
        byte_cap_bytes=settings.egress_lease_byte_cap_bytes,
    )

    _EGRESS_LEASES_TOTAL.labels(consumer=payload.consumer, result="issued").inc()
    _EGRESS_LEASES_ACTIVE.set(lease_manager.active_count())
    # Never log proxy_url (§10.3) — lease_id + host + consumer + job_id only.
    logger.info(
        "egress_lease_issued request_id=%s lease_id=%s consumer=%s target_host=%s job_id=%s",
        request_id, lease.lease_id, payload.consumer, host, payload.job_id,
    )

    return EgressLeaseResponse(
        lease_id=lease.lease_id,
        proxy_url=lease.proxy_url,
        sticky_session_id=lease.sticky_session_id,
        expires_at=_iso_utc(lease.expires_at),
        ttl_seconds=int(round(lease.expires_at - lease.issued_at)),
        provider=lease.provider_name,
        byte_cap_bytes=lease.byte_cap_bytes,
    )


@app.post("/egress/report", response_model=EgressReportResponse, responses={
    400: {"model": ErrorBody},
    401: {"model": ErrorBody},
    404: {"model": ErrorBody},
    415: {"model": ErrorBody},
    422: {"model": ErrorBody},
})
async def egress_report(request: Request, payload: Annotated[EgressReportRequest, Body()]):
    request_id = uuid.uuid4().hex
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        return JSONResponse(
            status_code=415,
            content={"error": "unsupported_media_type", "request_id": request_id},
        )

    settings: Settings = app.state.settings
    provider = app.state.provider
    ledger: CostLedgerClient = app.state.ledger
    lease_manager: LeaseManager = app.state.lease_manager

    lease = lease_manager.get(payload.lease_id)
    if lease is None:
        return JSONResponse(
            status_code=404,
            content={"error": "lease_not_found", "request_id": request_id},
        )

    consumer = lease.consumer
    target_host = lease.target_host
    job_id = lease.job_id
    proxy_url = lease.proxy_url

    result = lease_manager.report(
        payload.lease_id, payload.bytes_in, payload.bytes_out, payload.requests, payload.final,
    )
    if result is None:  # raced with expiry/sweep between get() and report()
        return JSONResponse(
            status_code=404,
            content={"error": "lease_not_found", "request_id": request_id},
        )
    bytes_total, cap_remaining, cap_exceeded = result

    _EGRESS_BYTES.labels(consumer=consumer, direction="in").inc(payload.bytes_in)
    _EGRESS_BYTES.labels(consumer=consumer, direction="out").inc(payload.bytes_out)
    _PROXY_BYTES.labels(direction="in").inc(payload.bytes_in)
    _PROXY_BYTES.labels(direction="out").inc(payload.bytes_out)
    _EGRESS_DAILY_GB_USED.set(lease_manager.daily_gb_used())
    _EGRESS_LEASES_ACTIVE.set(lease_manager.active_count())

    # Cost-ledger row per report (§5.2): provider estimate over the reported bytes.
    cost_usd = 0.0
    try:
        usage = await provider.record_usage(
            {"proxy_url": proxy_url},
            FetchOutcome(
                status=200,
                bytes_in=payload.bytes_in,
                bytes_out=payload.bytes_out,
                headers={},
            ),
        )
        cost_usd = usage.get("cost_usd_estimate") or 0.0
    except Exception as e:  # noqa: BLE001 — pricing estimate must not break a report
        logger.warning("egress_cost_estimate_error request_id=%s err=%s", request_id, e)

    brand_id = _os.environ.get("SCRAPLING_BRAND_ID", "unknown")
    await ledger.record(
        brand_id=brand_id,
        provider=provider.name,
        product="residential-proxy",
        feature=consumer,
        units_in=payload.bytes_in,
        units_out=payload.bytes_out,
        cost_usd=cost_usd,
        request_id=request_id,
        context={"target_host": target_host, "job_id": job_id, "lease_id": payload.lease_id},
    )

    return EgressReportResponse(
        accepted=True,
        bytes_total_for_lease=bytes_total,
        cap_remaining_bytes=cap_remaining,
        cap_exceeded=cap_exceeded,
    )


@app.get("/egress/health", response_model=EgressHealthResponse, responses={
    401: {"model": ErrorBody},
    503: {"model": ErrorBody},
})
async def egress_health():
    settings: Settings = app.state.settings
    provider = app.state.provider
    lease_manager: LeaseManager = app.state.lease_manager

    try:
        health = await provider.health_check()
    except Exception as e:  # noqa: BLE001
        _EGRESS_PROVIDER_HEALTHY.set(0)
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "error": str(e)},
        )

    status = _health_status(health)
    _EGRESS_PROVIDER_HEALTHY.set(1 if status == "ok" else 0)
    _EGRESS_DAILY_GB_USED.set(lease_manager.daily_gb_used())

    return EgressHealthResponse(
        provider=provider.name,
        status=status,
        provider_health=health,
        daily_gb_used=lease_manager.daily_gb_used(),
        daily_gb_cap=settings.proxy_daily_gb_cap,
        active_leases=lease_manager.active_count(),
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
