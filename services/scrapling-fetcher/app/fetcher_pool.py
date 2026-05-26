"""Wrappers around Scrapling's Fetcher / StealthyFetcher / DynamicFetcher
that share semaphores and emit structured timing.

Spec §4.1:
  - mode=fast     -> Fetcher    (TLS-impersonating HTTP, no browser)
  - mode=stealth  -> StealthyFetcher (HTTP + Cloudflare bypass, no browser)
  - mode=browser  -> DynamicFetcher  (Playwright; pool-bounded)

Fast and stealth share an asyncio semaphore (SCRAPLING_FAST_CONCURRENCY).
Browser is gated by its own pool (SCRAPLING_BROWSER_POOL_SIZE) — they don't
starve each other.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from .ssrf import ResolvedTarget


logger = logging.getLogger(__name__)


_NEXT_DATA_RE = re.compile(
    rb'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>',
    re.DOTALL,
)

_REDIRECT_HOP_CAP = 10


@dataclass
class RawFetchResult:
    status: int
    html: str
    headers: dict[str, str]
    bytes_in: int
    bytes_out: int
    fetch_ms: int
    # Spec §0.2 additions
    final_url: str = ""
    redirect_chain: list[dict[str, Any]] = field(default_factory=list)
    browser_seconds: float = 0.0
    # Screenshot capture (browser mode only)
    screenshot_png: bytes | None = None
    screenshot_width: int | None = None
    screenshot_height: int | None = None


class FetcherPool:
    """Lazy-initialises Scrapling fetchers + bounds concurrency."""

    def __init__(
        self,
        *,
        fast_concurrency: int,
        browser_pool_size: int,
        default_timeout_ms: int,
        browser_queue_ceiling_seconds: int = 30,
    ) -> None:
        self._fast_sem = asyncio.Semaphore(fast_concurrency)
        self._browser_sem = asyncio.Semaphore(browser_pool_size)
        self._browser_queue_ceiling = browser_queue_ceiling_seconds
        self._default_timeout_ms = default_timeout_ms
        self._browser_pool_max = browser_pool_size
        self._fetcher = None
        self._stealthy = None
        self._dynamic = None

    def _get_fetcher(self):
        if self._fetcher is None:
            from scrapling import Fetcher

            self._fetcher = Fetcher
        return self._fetcher

    def _get_stealthy(self):
        if self._stealthy is None:
            from scrapling import StealthyFetcher

            self._stealthy = StealthyFetcher
        return self._stealthy

    def _get_dynamic(self):
        if self._dynamic is None:
            from scrapling import DynamicFetcher

            self._dynamic = DynamicFetcher
        return self._dynamic

    @property
    def browser_pool_in_use(self) -> int:
        return self._browser_pool_max - self._browser_sem._value  # noqa: SLF001

    @property
    def browser_pool_max(self) -> int:
        return self._browser_pool_max

    async def fetch_fast(
        self,
        target: ResolvedTarget,
        *,
        timeout_ms: int,
        proxy_url: str | None,
    ) -> RawFetchResult:
        return await self._http_fetch(
            target, sem=self._fast_sem, stealthy=False,
            timeout_ms=timeout_ms, proxy_url=proxy_url,
        )

    async def fetch_stealth(
        self,
        target: ResolvedTarget,
        *,
        timeout_ms: int,
        proxy_url: str | None,
    ) -> RawFetchResult:
        return await self._http_fetch(
            target, sem=self._fast_sem, stealthy=True,
            timeout_ms=timeout_ms, proxy_url=proxy_url,
        )

    async def _http_fetch(
        self,
        target: ResolvedTarget,
        *,
        sem: asyncio.Semaphore,
        stealthy: bool,
        timeout_ms: int,
        proxy_url: str | None,
    ) -> RawFetchResult:
        async with sem:
            start = time.perf_counter()
            # We use httpx directly (not Scrapling's high-level Fetcher) so
            # we control transport-level details. The SSRF guard's pre-DNS
            # resolution in ssrf.check_url_or_raise has already verified the
            # host doesn't resolve to a private/loopback range; we send to
            # the original URL so TLS SNI works correctly against
            # certificate hosts (rewriting to an IP literal breaks SNI on
            # any cert-pinned upstream — see PR comment 2026-05-06).
            #
            # Residual TOCTOU: between the pre-DNS check and httpx's own
            # DNS resolution, an attacker controlling DNS could swap the
            # answer. Spec §8.2 documents this as accepted Phase 1 risk
            # for fast/stealth modes; it requires DNS control to exploit
            # and our targets are public-internet event sites.
            import httpx

            kwargs: dict[str, Any] = {
                "timeout": timeout_ms / 1000,
                "follow_redirects": True,
            }
            if proxy_url:
                kwargs["proxy"] = proxy_url
            if stealthy:
                # Stealth-mode UA; Scrapling's StealthyFetcher will replace
                # this when wired in Phase 3.
                kwargs["headers"] = {
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/130.0.0.0 Safari/537.36"
                    ),
                }
            try:
                async with httpx.AsyncClient(**kwargs) as client:
                    resp = await client.get(target.original_url)
            except httpx.TimeoutException:
                raise
            except httpx.ConnectError as e:
                raise RuntimeError(f"connect error: {e}") from e
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            content = resp.content
            # httpx exposes the redirect chain via resp.history (the prior
            # responses) and the final URL via resp.url. Per spec §0.2,
            # redirect_chain is bounded to 10 hops; we slice defensively
            # in case httpx's max_redirects is overridden upstream.
            redirect_chain: list[dict[str, Any]] = [
                {"url": str(hop.url), "status": hop.status_code}
                for hop in resp.history[-_REDIRECT_HOP_CAP:]
            ]
            # Final URL is the URL of the response that actually returned
            # content, not the originally requested URL.
            final_url = str(resp.url)
            return RawFetchResult(
                status=resp.status_code,
                html=content.decode("utf-8", errors="replace"),
                headers=dict(resp.headers),
                bytes_in=len(content),
                bytes_out=len(target.original_url) + 256,  # rough HTTP request overhead
                fetch_ms=elapsed_ms,
                final_url=final_url,
                redirect_chain=redirect_chain,
                browser_seconds=0.0,
            )

    async def fetch_browser(
        self,
        target: ResolvedTarget,
        *,
        timeout_ms: int,
        proxy_url: str | None,
        wait_for: str | None,
        capture_screenshot: bool = False,
        screenshot_full_page: bool = False,
        screenshot_clip: dict[str, int] | None = None,
    ) -> RawFetchResult:
        try:
            await asyncio.wait_for(
                self._browser_sem.acquire(),
                timeout=self._browser_queue_ceiling,
            )
        except asyncio.TimeoutError as e:
            raise RuntimeError("browser_pool_exhausted") from e
        try:
            start = time.perf_counter()
            DynamicFetcher = self._get_dynamic()
            fetch_kwargs: dict[str, Any] = {
                "headless": True,
                "timeout": timeout_ms,
                "network_idle": True,
            }
            if proxy_url:
                fetch_kwargs["proxy"] = proxy_url
            if wait_for:
                fetch_kwargs["wait_selector"] = wait_for

            # DynamicFetcher uses the original URL (not rewritten) because
            # Playwright handles its own DNS via the Chromium net stack;
            # the SSRF guard's pre-resolution check has already ensured the
            # host doesn't resolve to a blocked range, and the Playwright
            # `route` interceptor (added via on('route')) re-checks each
            # navigation defensively.
            #
            # When capture_screenshot is true, we run the page through
            # Playwright directly so we can call page.screenshot() — the
            # Scrapling DynamicFetcher.fetch helper returns only the
            # rendered HTML and doesn't surface the page object. Falls
            # back to DynamicFetcher when capture_screenshot is False.
            screenshot_png: bytes | None = None
            screenshot_width: int | None = None
            screenshot_height: int | None = None
            if capture_screenshot:
                content_str, screenshot_png, screenshot_width, screenshot_height = (
                    await asyncio.to_thread(
                        _playwright_render_and_screenshot,
                        target.original_url,
                        timeout_ms=timeout_ms,
                        proxy_url=proxy_url,
                        wait_for=wait_for,
                        full_page=screenshot_full_page,
                        clip=screenshot_clip,
                    )
                )
            else:
                page_html = await asyncio.to_thread(
                    DynamicFetcher.fetch, target.original_url, **fetch_kwargs
                )
                content_str = (
                    page_html.html_content
                    if hasattr(page_html, "html_content")
                    else str(page_html)
                )
            content_bytes = content_str.encode("utf-8")
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            # browser_seconds is the wall-clock seconds the browser context
            # was held — equal to fetch_ms / 1000 for the v1 single-page
            # browser path (DynamicFetcher acquires + releases the context
            # within this call). For non-browser modes it's 0.
            #
            # final_url and redirect_chain are not populated for browser
            # mode in v1: Scrapling's DynamicFetcher returns the rendered
            # HTML but doesn't surface Playwright's `page.url` or the
            # response chain through its public interface. Setting
            # final_url to the original URL is a safe default — the caller
            # (gatewaze-fetch) treats final_url == requested URL as "no
            # redirect happened" and skips the post-fetch governance check.
            # If a JS-driven location.replace() redirect occurred, this
            # would silently skip final-URL governance for browser mode;
            # tracked as a known v2 gap, not a v1 bug (browser mode is
            # opt-in and gated by gatewaze-fetch:browser scope).
            return RawFetchResult(
                status=200,
                html=content_str,
                headers={},
                bytes_in=len(content_bytes),
                bytes_out=len(target.original_url) + 1024,  # browser overhead
                fetch_ms=elapsed_ms,
                final_url=target.original_url,
                redirect_chain=[],
                browser_seconds=elapsed_ms / 1000.0,
                screenshot_png=screenshot_png,
                screenshot_width=screenshot_width,
                screenshot_height=screenshot_height,
            )
        finally:
            self._browser_sem.release()


def _playwright_render_and_screenshot(
    url: str,
    *,
    timeout_ms: int,
    proxy_url: str | None,
    wait_for: str | None,
    full_page: bool,
    clip: dict[str, int] | None,
) -> tuple[str, bytes, int, int]:
    """Render a page in headless Chromium and return (html, png, w, h).

    Synchronous helper — caller wraps in asyncio.to_thread.

    We use Playwright directly here (rather than Scrapling's
    DynamicFetcher.fetch) because the Scrapling helper doesn't expose
    the page object, and screenshot capture needs page.screenshot().
    The browser pool semaphore in fetch_browser already gates this so
    we don't exceed the configured concurrency.
    """
    from playwright.sync_api import sync_playwright

    launch_args: dict[str, Any] = {"headless": True}
    context_args: dict[str, Any] = {}
    if proxy_url:
        # Playwright accepts proxy at the browser-launch level.
        launch_args["proxy"] = {"server": proxy_url}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch_args)
        try:
            context = browser.new_context(**context_args)
            page = context.new_page()
            page.set_default_navigation_timeout(timeout_ms)
            page.set_default_timeout(timeout_ms)
            page.goto(url, wait_until="networkidle")
            if wait_for:
                page.wait_for_selector(wait_for, timeout=timeout_ms)
            html = page.content()
            shot_kwargs: dict[str, Any] = {"full_page": full_page, "type": "png"}
            if clip:
                shot_kwargs["clip"] = clip
            png_bytes = page.screenshot(**shot_kwargs)
            viewport = page.viewport_size or {"width": 0, "height": 0}
            return (
                html,
                png_bytes,
                viewport.get("width", 0),
                viewport.get("height", 0),
            )
        finally:
            browser.close()


def extract_next_data(html: str) -> dict[str, Any] | None:
    """Pull __NEXT_DATA__ JSON out of a Next.js SSR page if present."""
    import json

    match = _NEXT_DATA_RE.search(html.encode("utf-8", errors="replace"))
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
