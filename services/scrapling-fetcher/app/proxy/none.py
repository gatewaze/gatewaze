"""No-op provider used when SCRAPLING_PROXY_MODE=none."""

from __future__ import annotations

from typing import Any

from .base import FetchOutcome, ProxyDecision, ProxyProvider, ProxyUsage


class NoneProvider(ProxyProvider):
    name = "none"

    async def get_proxy_for(
        self, target_url: str, mode: str, opts: dict[str, Any]
    ) -> ProxyDecision:
        return {"proxy_url": None, "headers": {}, "sticky_session_id": None}

    async def record_usage(
        self, decision: ProxyDecision, outcome: FetchOutcome
    ) -> ProxyUsage:
        return {
            "bytes_in": outcome.bytes_in,
            "bytes_out": outcome.bytes_out,
            "cost_usd_estimate": 0.0,
        }
