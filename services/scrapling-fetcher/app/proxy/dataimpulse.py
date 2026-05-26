"""DataImpulse residential proxy provider.

DataImpulse encodes session/country flags as `__key.value` suffixes on
the *username* — distinctive double-underscore + dot delimiter that
nothing else in the built-in set uses.

Pricing (May 2026):
  $1.00/GB at 5-50 GB (the entry tier)
  $0.80/GB at 1 TB (advanced tier)

Notable: traffic does not expire on DataImpulse, which makes it a
good fit for the "bursty, low-volume, never-expiring" scraper workload
the spec describes. We estimate at the entry-tier $1.00/GB rate; the
operator's actual rate is known to them and to their DataImpulse
dashboard but isn't visible here.
"""

from __future__ import annotations

import uuid
from typing import Any

from .base import FetchOutcome, ProxyDecision, ProxyProvider, ProxyUsage


_DATAIMPULSE_USD_PER_GB_ESTIMATE = 1.00


class DataImpulseProvider(ProxyProvider):
    name = "dataimpulse"

    def __init__(self, config: dict[str, Any]) -> None:
        super().__init__(config)
        self._username = config.get("username")
        self._password = config.get("password")
        self._gateway_host = config.get("gateway_host", "gw.dataimpulse.com")
        self._gateway_port = int(config.get("gateway_port", 823))
        self._default_country = config.get("default_country")
        if not self._username or not self._password:
            raise ValueError(
                "DataImpulseProvider requires 'username' and 'password' in "
                "SCRAPLING_PROXY_CONFIG"
            )

    def _build_username(
        self, session_id: str | None, country: str | None
    ) -> str:
        # DataImpulse suffix conventions on the username:
        #   {user}__cr.{lowercase-country}  → country targeting
        #   {user}__sid.{session_id}        → sticky session id
        parts = [self._username]
        if country:
            parts.append(f"__cr.{country.lower()}")
        if session_id:
            parts.append(f"__sid.{session_id}")
        return "".join(parts)

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
            "cost_usd_estimate": gb * _DATAIMPULSE_USD_PER_GB_ESTIMATE,
        }
