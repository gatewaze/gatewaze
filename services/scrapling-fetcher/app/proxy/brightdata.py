"""Bright Data residential proxy provider.

Premium tier. Estimates at PAYG rate $4.00/GB; lower tiers depend on the
operator's plan and aren't visible from here.
"""

from __future__ import annotations

import uuid
from typing import Any

from .base import FetchOutcome, ProxyDecision, ProxyProvider, ProxyUsage


_BRIGHTDATA_USD_PER_GB_ESTIMATE = 4.00


class BrightDataProvider(ProxyProvider):
    name = "brightdata"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self._customer = config.get("customer")
        self._zone = config.get("zone")
        self._password = config.get("password")
        self._gateway_host = config.get("gateway_host", "brd.superproxy.io")
        self._gateway_port = int(config.get("gateway_port", 22225))
        self._default_country = config.get("default_country")
        if not self._customer or not self._zone or not self._password:
            raise ValueError(
                "BrightDataProvider requires 'customer', 'zone', 'password' in config"
            )

    def _build_username(
        self, session_id: str | None, country: str | None
    ) -> str:
        parts = [f"brd-customer-{self._customer}-zone-{self._zone}"]
        if country:
            parts.append(f"country-{country}")
        if session_id:
            parts.append(f"session-{session_id}")
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
            "cost_usd_estimate": gb * _BRIGHTDATA_USD_PER_GB_ESTIMATE,
        }
