"""Best-effort cost-ledger client.

Calls the Postgres RPC `record_external_api_usage` from the cost-governance
module. Failure is non-fatal — we never break a fetch because the ledger
write failed.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx


logger = logging.getLogger(__name__)


class CostLedgerClient:
    """Talks to Supabase via REST (no psycopg dep needed for one RPC).

    Disabled entirely when supabase_url or supabase_service_key is unset —
    the constructor stores ``enabled = False`` and ``record`` becomes a
    no-op. This keeps local dev painless when the operator hasn't wired
    Supabase env vars into the service yet.
    """

    def __init__(self, supabase_url: str | None, service_key: str | None) -> None:
        self.enabled = bool(supabase_url and service_key)
        if self.enabled:
            self._url = f"{supabase_url}/rest/v1/rpc/record_external_api_usage"
            self._headers = {
                "apikey": service_key or "",
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
            self._client = httpx.AsyncClient(timeout=5.0)
        else:
            self._client = None

    async def record(
        self,
        *,
        brand_id: str,
        provider: str,
        product: str,
        feature: str,
        units_in: int,
        units_out: int,
        cost_usd: float,
        request_id: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        if not self.enabled or self._client is None:
            return
        payload = {
            "p_brand_id": brand_id,
            "p_provider": provider,
            "p_product": product,
            "p_feature": feature,
            "p_units_in": units_in,
            "p_units_out": units_out,
            "p_cost_usd": cost_usd,
            "p_request_id": request_id,
            "p_context": context or {},
        }
        try:
            resp = await self._client.post(
                self._url, headers=self._headers, json=payload
            )
            if resp.status_code >= 400:
                logger.warning(
                    "cost-ledger insert failed: %s %s", resp.status_code, resp.text[:300]
                )
        except Exception as e:  # noqa: BLE001 — never let cost-tracking break a fetch
            logger.warning("cost-ledger insert exception (non-fatal): %s", e)

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
