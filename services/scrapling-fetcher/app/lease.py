"""In-memory egress-lease table — see spec-residential-egress-proxy.md §5.

A ``LeaseManager`` mints short-lived residential-egress leases (Shape B),
tracks per-lease byte usage against a hard cap, and maintains a shared
daily-GB accumulator that resets on UTC day rollover. No DB, no disk — leases
are ephemeral per service replica (OQ5 defers a shared Redis table).

The clock is injectable (``now_fn``) so expiry and the daily rollover are unit
testable without ``sleep``.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable


# Lease TTL bounds (§5.1). Default = the provider sticky window (10 min).
TTL_MIN_SECONDS = 60
TTL_MAX_SECONDS = 900
TTL_DEFAULT_SECONDS = 600

# Per-lease hard byte ceiling (§9.4): 500 MB.
DEFAULT_BYTE_CAP_BYTES = 524_288_000


def clamp_ttl(ttl_seconds: int | None) -> int:
    """Clamp a requested TTL to [60, 900]; ``None`` → the 600 s default."""
    if ttl_seconds is None:
        return TTL_DEFAULT_SECONDS
    return max(TTL_MIN_SECONDS, min(TTL_MAX_SECONDS, int(ttl_seconds)))


@dataclass
class Lease:
    """One issued residential-egress lease. ``proxy_url`` is SECRET (§10.3) —
    never log it; log ``lease_id`` + ``target_host`` only."""

    lease_id: str
    consumer: str
    target_host: str
    job_id: str | None
    provider_name: str
    proxy_url: str | None
    sticky_session_id: str | None
    issued_at: float
    expires_at: float
    byte_cap_bytes: int
    bytes_so_far: int = 0
    requests: int = 0

    def is_expired(self, now: float) -> bool:
        return now >= self.expires_at


@dataclass
class ReportResult:
    """Return shape of :meth:`LeaseManager.report`. Unpacks as a 3-tuple of
    ``(bytes_total, cap_remaining, cap_exceeded)``."""

    bytes_total: int
    cap_remaining: int
    cap_exceeded: bool

    def __iter__(self):
        yield self.bytes_total
        yield self.cap_remaining
        yield self.cap_exceeded


class LeaseManager:
    """In-memory lease registry + shared daily-GB accumulator.

    Not thread-safe by design: the service is single-worker asyncio; all
    mutation happens on the event loop thread.
    """

    def __init__(self, now_fn: Callable[[], float] | None = None) -> None:
        self._now_fn = now_fn or time.time
        self._leases: dict[str, Lease] = {}
        self._daily_bytes: int = 0
        self._daily_date: date = self._utc_date()

    # -- clock helpers ------------------------------------------------------

    def _now(self) -> float:
        return self._now_fn()

    def _utc_date(self) -> date:
        return datetime.fromtimestamp(self._now(), tz=timezone.utc).date()

    def _maybe_roll_day(self) -> None:
        today = self._utc_date()
        if today != self._daily_date:
            self._daily_date = today
            self._daily_bytes = 0

    # -- lifecycle ----------------------------------------------------------

    def issue(
        self,
        *,
        consumer: str,
        target_host: str,
        sticky: bool,
        country: str | None,
        ttl_seconds: int | None,
        job_id: str | None,
        proxy_decision: dict[str, Any],
        provider_name: str,
        byte_cap_bytes: int = DEFAULT_BYTE_CAP_BYTES,
    ) -> Lease:
        """Mint and store a new lease. ``sticky``/``country`` are accepted for
        completeness (the provider already embedded them in ``proxy_decision``)."""
        self.sweep_expired()
        now = self._now()
        ttl = clamp_ttl(ttl_seconds)
        lease = Lease(
            lease_id="lz_" + uuid.uuid4().hex,
            consumer=consumer,
            target_host=target_host,
            job_id=job_id,
            provider_name=provider_name,
            proxy_url=proxy_decision.get("proxy_url"),
            sticky_session_id=proxy_decision.get("sticky_session_id"),
            issued_at=now,
            expires_at=now + ttl,
            byte_cap_bytes=byte_cap_bytes,
        )
        self._leases[lease.lease_id] = lease
        return lease

    def get(self, lease_id: str) -> Lease | None:
        self.sweep_expired()
        return self._leases.get(lease_id)

    def report(
        self,
        lease_id: str,
        bytes_in: int,
        bytes_out: int,
        requests: int,
        final: bool,
    ) -> ReportResult | None:
        """Accumulate reported bytes against a lease and the daily total.

        Returns ``None`` if the lease is unknown, already expired, or revoked.
        Releases the lease when ``final`` is true or the byte cap is hit.
        """
        self.sweep_expired()
        lease = self._leases.get(lease_id)
        if lease is None:
            return None
        added = max(0, bytes_in) + max(0, bytes_out)
        self._maybe_roll_day()
        lease.bytes_so_far += added
        lease.requests += max(0, requests)
        self._daily_bytes += added
        bytes_total = lease.bytes_so_far
        cap_remaining = max(0, lease.byte_cap_bytes - bytes_total)
        cap_exceeded = bytes_total >= lease.byte_cap_bytes
        if final or cap_exceeded:
            self._leases.pop(lease_id, None)
        return ReportResult(bytes_total, cap_remaining, cap_exceeded)

    def release(self, lease_id: str) -> bool:
        """Drop a lease. Returns True if it existed."""
        return self._leases.pop(lease_id, None) is not None

    def sweep_expired(self) -> int:
        """Drop every lease past its ``expires_at``. Returns how many were dropped."""
        now = self._now()
        expired = [lid for lid, l in self._leases.items() if l.is_expired(now)]
        for lid in expired:
            self._leases.pop(lid, None)
        return len(expired)

    def active_count(self) -> int:
        self.sweep_expired()
        return len(self._leases)

    # -- daily accumulator --------------------------------------------------

    def daily_gb_used(self) -> float:
        self._maybe_roll_day()
        return self._daily_bytes / (1024 ** 3)

    def add_daily_bytes(self, n: int) -> None:
        """Directly bump the daily accumulator (used by report; exposed for
        symmetry with the Shape-A roll-up)."""
        self._maybe_roll_day()
        self._daily_bytes += max(0, n)
