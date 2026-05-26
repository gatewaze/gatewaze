"""Rayobyte residential proxy provider — Phase 1 default.

Rayobyte uses a gateway endpoint plus user/password auth. Sticky sessions
are obtained by appending a session id to the username field; rotation is
the default when no session id is sent.

Pricing (May 2026):
  $3.50/GB at 1–49 GB
  $2.00/GB at 50–249 GB
  $1.50/GB at 250–999 GB
  $0.70/GB at 1000–4999 GB
  $0.50/GB at 5000+ GB

We can't see the operator's plan tier from here, so we estimate at the
mid-tier $1.50/GB rate. The cost-governance ledger captures the actual
billed cost via the operator's monthly Rayobyte invoice — this estimate
is signal, not source of truth.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

from .base import FetchOutcome, ProxyDecision, ProxyProvider, ProxyUsage


_RAYOBYTE_USD_PER_GB_ESTIMATE = 1.50


class RayobyteProvider(ProxyProvider):
    name = "rayobyte"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self._username = config.get("username")
        self._password = config.get("password")
        self._gateway_host = config.get("gateway_host", "gw.rayobyte.com")
        self._gateway_port = int(config.get("gateway_port", 8080))
        self._default_country = config.get("default_country")
        self._sticky_minutes = int(config.get("session_duration_minutes", 10))
        if not self._username or not self._password:
            raise ValueError(
                "RayobyteProvider requires 'username' and 'password' in "
                "SCRAPLING_PROXY_CONFIG"
            )

    def _build_username(self, session_id: str | None, country: str | None) -> str:
        parts = [self._username]
        if country:
            parts.append(f"country-{country}")
        if session_id:
            parts.append(f"session-{session_id}")
            parts.append(f"sessTime-{self._sticky_minutes}")
        return "-".join(parts)

    async def get_proxy_for(
        self, target_url: str, mode: str, opts: dict[str, Any]
    ) -> ProxyDecision:
        country = opts.get("country") or self._default_country
        session_id: str | None = None
        if opts.get("sticky", False):
            session_id = uuid.uuid4().hex[:12]
        username = self._build_username(session_id, country)
        proxy_url = (
            f"http://{username}:{self._password}@{self._gateway_host}:{self._gateway_port}"
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
            "cost_usd_estimate": gb * _RAYOBYTE_USD_PER_GB_ESTIMATE,
        }
