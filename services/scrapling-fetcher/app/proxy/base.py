"""ProxyProvider ABC — see spec §4.1.1."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, TypedDict


class ProxyDecision(TypedDict, total=False):
    proxy_url: str | None
    headers: dict[str, str]
    sticky_session_id: str | None


class ProxyUsage(TypedDict, total=False):
    bytes_in: int
    bytes_out: int
    cost_usd_estimate: float | None


@dataclass
class FetchOutcome:
    """The bits the provider needs to derive usage. Filled in by main.py."""

    status: int
    bytes_in: int
    bytes_out: int
    headers: dict[str, str] = field(default_factory=dict)


class ProxyProvider(ABC):
    """Adapter for one residential proxy service."""

    name: str = "abstract"

    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config

    @abstractmethod
    async def get_proxy_for(
        self, target_url: str, mode: str, opts: dict[str, Any]
    ) -> ProxyDecision:
        ...

    @abstractmethod
    async def record_usage(
        self, decision: ProxyDecision, outcome: FetchOutcome
    ) -> ProxyUsage:
        ...

    async def health_check(self) -> dict[str, Any]:
        """Default: always healthy. Override for providers with a quota API."""
        return {"provider": self.name, "status": "ok"}
