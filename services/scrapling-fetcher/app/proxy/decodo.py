"""Decodo (formerly Smartproxy) residential proxy provider."""

from __future__ import annotations

import uuid
from typing import Any

from .base import FetchOutcome, ProxyDecision, ProxyProvider, ProxyUsage


_DECODO_USD_PER_GB_ESTIMATE = 2.50


class DecodoProvider(ProxyProvider):
    name = "decodo"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self._username = config.get("username")
        self._password = config.get("password")
        self._gateway_host = config.get("gateway_host", "gate.decodo.com")
        self._gateway_port = int(config.get("gateway_port", 7000))
        self._default_country = config.get("default_country")
        if not self._username or not self._password:
            raise ValueError(
                "DecodoProvider requires 'username' and 'password' in config"
            )

    def _build_username(
        self, session_id: str | None, country: str | None
    ) -> str:
        parts = [f"user-{self._username}"]
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
            "cost_usd_estimate": gb * _DECODO_USD_PER_GB_ESTIMATE,
        }
