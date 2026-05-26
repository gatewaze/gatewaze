"""Webshare residential proxy provider.

Webshare uses a single gateway endpoint and encodes session/country
controls as suffix flags on the *username* — the inverse of IPRoyal's
password-suffix style. Rotating IP per request is the default; appending
`-rotate-XXX` reuses the same upstream IP for ~10 minutes.

Pricing (May 2026, rotating residential):
  $3.50/GB at 1 GB
  $2.25/GB at 100 GB (most popular)
  $1.40/GB at 3,000 GB

Estimate is the mid-tier 100 GB rate ($2.25/GB) — adjust the constant
when the operator's actual plan tier is known.
"""

from __future__ import annotations

import uuid
from typing import Any

from .base import FetchOutcome, ProxyDecision, ProxyProvider, ProxyUsage


_WEBSHARE_USD_PER_GB_ESTIMATE = 2.25


class WebshareProvider(ProxyProvider):
    name = "webshare"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self._username = config.get("username")
        self._password = config.get("password")
        self._gateway_host = config.get("gateway_host", "p.webshare.io")
        self._gateway_port = int(config.get("gateway_port", 80))
        self._default_country = config.get("default_country")
        if not self._username or not self._password:
            raise ValueError(
                "WebshareProvider requires 'username' and 'password' in "
                "SCRAPLING_PROXY_CONFIG"
            )

    def _build_username(
        self, session_id: str | None, country: str | None
    ) -> str:
        # Webshare auth-string conventions:
        #   {user}-rotate              → IP rotates per request (default
        #                                 when no -rotate flag is unclear;
        #                                 we set it explicitly for clarity)
        #   {user}-CC-{country}        → upper-case country code; e.g. -CC-US
        #   {user}-rotate-{session_id} → sticky session (~10 min by default)
        parts = [self._username]
        if country:
            parts.append(f"CC-{country.upper()}")
        if session_id:
            parts.append(f"rotate-{session_id}")
        else:
            parts.append("rotate")
        return "-".join(parts)

    async def get_proxy_for(
        self, target_url: str, mode: str, opts: dict[str, Any]
    ) -> ProxyDecision:
        country = opts.get("country") or self._default_country
        session_id = uuid.uuid4().hex[:12] if opts.get("sticky") else None
        username = self._build_username(session_id, country)
        proxy_url = (
            f"http://{username}:{self._password}@"
            f"{self._gateway_host}:{self._gateway_port}"
        )
        return {
            "proxy_url": proxy_url,
            "headers": {},
            "sticky_session_id": session_id,
        }

    async def record_usage(
        self, decision: ProxyDecision, outcome: FetchOutcome
    ) -> ProxyUsage:
        gb = (outcome.bytes_in + outcome.bytes_out) / (1024**3)
        return {
            "bytes_in": outcome.bytes_in,
            "bytes_out": outcome.bytes_out,
            "cost_usd_estimate": gb * _WEBSHARE_USD_PER_GB_ESTIMATE,
        }
