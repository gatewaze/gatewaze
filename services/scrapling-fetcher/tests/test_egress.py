"""Egress-lease endpoint + LeaseManager tests (spec §5, §14).

Mirrors the existing test conventions: the FastAPI ``client`` fixture with the
internal-token header, and DNS monkeypatched (never touches the network).
"""

from __future__ import annotations

import contextlib
import socket

import pytest

from app.lease import (
    DEFAULT_BYTE_CAP_BYTES,
    TTL_DEFAULT_SECONDS,
    LeaseManager,
    clamp_ttl,
)


_AUTH = {"X-Internal-Token": "test-token-please-do-not-use-in-prod"}


@contextlib.contextmanager
def _egress_client(
    monkeypatch,
    *,
    provider: str = "dataimpulse",
    allowlist: str = "youtube.com,youtu.be",
    byte_cap: int | None = None,
    daily_gb_cap: str | None = None,
    resolved_ip: str | None = "203.0.113.5",
):
    """A TestClient whose lifespan reads egress-configured env.

    ``app`` is a module singleton, so entering the context re-runs the
    lifespan against the env set here (fresh LeaseManager per block).
    """
    monkeypatch.setenv("SCRAPLING_PROXY_PROVIDER", provider)
    if provider == "dataimpulse":
        monkeypatch.setenv("SCRAPLING_PROXY_CONFIG", '{"username":"u","password":"p"}')
    monkeypatch.setenv("SCRAPLING_EGRESS_HOST_ALLOWLIST", allowlist)
    if byte_cap is not None:
        monkeypatch.setenv("SCRAPLING_EGRESS_LEASE_BYTE_CAP_BYTES", str(byte_cap))
    if daily_gb_cap is not None:
        monkeypatch.setenv("SCRAPLING_PROXY_DAILY_GB_CAP", daily_gb_cap)
    if resolved_ip is not None:
        def fake_getaddrinfo(host, port, *args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (resolved_ip, port or 0))]
        monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# POST /egress/lease
# ---------------------------------------------------------------------------


def test_lease_happy_path(monkeypatch):
    with _egress_client(monkeypatch) as c:
        resp = c.post(
            "/egress/lease",
            json={"consumer": "conference-recap", "target_host": "youtube.com", "sticky": True},
            headers=_AUTH,
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["lease_id"].startswith("lz_")
    assert body["provider"] == "dataimpulse"
    assert body["byte_cap_bytes"] == DEFAULT_BYTE_CAP_BYTES
    assert body["ttl_seconds"] == TTL_DEFAULT_SECONDS
    assert body["sticky_session_id"] is not None
    # proxy_url embeds the sticky session; it is the credential-bearing string.
    assert body["proxy_url"] and "@" in body["proxy_url"]
    assert body["expires_at"].endswith("Z")


def test_lease_host_not_allowlisted(monkeypatch):
    with _egress_client(monkeypatch, allowlist="youtube.com") as c:
        resp = c.post(
            "/egress/lease",
            json={"consumer": "conference-recap", "target_host": "example.com"},
            headers=_AUTH,
        )
    assert resp.status_code == 400
    assert resp.json()["error"] == "host_not_allowlisted"


def test_lease_empty_allowlist_denies_all(monkeypatch):
    # Empty allowlist → nothing explicitly allowed → deny (§8.4).
    with _egress_client(monkeypatch, allowlist="") as c:
        resp = c.post(
            "/egress/lease",
            json={"consumer": "conference-recap", "target_host": "youtube.com"},
            headers=_AUTH,
        )
    assert resp.status_code == 400
    assert resp.json()["error"] == "host_not_allowlisted"


@pytest.mark.parametrize("bad_host", ["youtube", "YouTube.com", "http://youtube.com", "youtube.com/x", "youtube.com:443", "user@youtube.com"])
def test_lease_malformed_target_host_422(monkeypatch, bad_host):
    with _egress_client(monkeypatch) as c:
        resp = c.post(
            "/egress/lease",
            json={"consumer": "conference-recap", "target_host": bad_host},
            headers=_AUTH,
        )
    assert resp.status_code == 422


def test_lease_ssrf_private_host_403(monkeypatch):
    # Host is allowlisted but resolves to a private IP → SSRF guard rejects.
    with _egress_client(monkeypatch, allowlist="youtube.com", resolved_ip="10.0.0.5") as c:
        resp = c.post(
            "/egress/lease",
            json={"consumer": "conference-recap", "target_host": "youtube.com"},
            headers=_AUTH,
        )
    assert resp.status_code == 403
    assert resp.json()["error"] == "ssrf_blocked"


def test_lease_missing_token_401(monkeypatch):
    with _egress_client(monkeypatch) as c:
        resp = c.post(
            "/egress/lease",
            json={"consumer": "conference-recap", "target_host": "youtube.com"},
        )
    assert resp.status_code == 401
    assert resp.json() == {"error": "auth_required"}


def test_lease_daily_cap_exceeded_507(monkeypatch):
    # daily cap of 0 GB means the first attempt is already over the cap.
    with _egress_client(monkeypatch, daily_gb_cap="0") as c:
        resp = c.post(
            "/egress/lease",
            json={"consumer": "conference-recap", "target_host": "youtube.com"},
            headers=_AUTH,
        )
    assert resp.status_code == 507
    assert resp.json()["error"] == "daily_cap_exceeded"


# ---------------------------------------------------------------------------
# POST /egress/report
# ---------------------------------------------------------------------------


def _issue(c) -> str:
    resp = c.post(
        "/egress/lease",
        json={"consumer": "conference-recap", "target_host": "youtube.com", "job_id": "recap:abc"},
        headers=_AUTH,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["lease_id"]


def test_report_accumulates_then_cap_exceeds_and_revokes(monkeypatch):
    with _egress_client(monkeypatch, byte_cap=1000) as c:
        lease_id = _issue(c)

        r1 = c.post(
            "/egress/report",
            json={"lease_id": lease_id, "bytes_in": 600, "bytes_out": 0, "requests": 1},
            headers=_AUTH,
        )
        assert r1.status_code == 200
        b1 = r1.json()
        assert b1["bytes_total_for_lease"] == 600
        assert b1["cap_remaining_bytes"] == 400
        assert b1["cap_exceeded"] is False

        r2 = c.post(
            "/egress/report",
            json={"lease_id": lease_id, "bytes_in": 600, "bytes_out": 0, "requests": 1},
            headers=_AUTH,
        )
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["bytes_total_for_lease"] == 1200
        assert b2["cap_exceeded"] is True
        assert b2["cap_remaining_bytes"] == 0

        # Cap hit → lease revoked → further reports rejected.
        r3 = c.post(
            "/egress/report",
            json={"lease_id": lease_id, "bytes_in": 1, "bytes_out": 0, "requests": 1},
            headers=_AUTH,
        )
        assert r3.status_code == 404
        assert r3.json()["error"] == "lease_not_found"


def test_report_final_releases(monkeypatch):
    with _egress_client(monkeypatch) as c:
        lease_id = _issue(c)
        r = c.post(
            "/egress/report",
            json={"lease_id": lease_id, "bytes_in": 100, "bytes_out": 10, "requests": 2, "final": True},
            headers=_AUTH,
        )
        assert r.status_code == 200
        assert r.json()["bytes_total_for_lease"] == 110

        again = c.post(
            "/egress/report",
            json={"lease_id": lease_id, "bytes_in": 1, "bytes_out": 0, "requests": 1},
            headers=_AUTH,
        )
        assert again.status_code == 404


def test_report_unknown_lease_404(monkeypatch):
    with _egress_client(monkeypatch) as c:
        r = c.post(
            "/egress/report",
            json={"lease_id": "lz_does_not_exist", "bytes_in": 1, "bytes_out": 0, "requests": 1},
            headers=_AUTH,
        )
        assert r.status_code == 404


def test_report_missing_token_401(monkeypatch):
    with _egress_client(monkeypatch) as c:
        r = c.post(
            "/egress/report",
            json={"lease_id": "lz_x", "bytes_in": 1, "bytes_out": 0, "requests": 1},
        )
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# GET /egress/health
# ---------------------------------------------------------------------------


def test_health_shape(client):
    # Default fixture provider is `none`, which is always healthy.
    resp = client.get("/egress/health", headers=_AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "none"
    assert body["status"] == "ok"
    assert isinstance(body["provider_health"], dict)
    assert body["daily_gb_used"] == 0.0
    assert body["daily_gb_cap"] == pytest.approx(10.0)
    assert body["active_leases"] == 0


def test_health_requires_token(client):
    resp = client.get("/egress/health")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# LeaseManager unit tests (time-based, no sleeps)
# ---------------------------------------------------------------------------


def test_clamp_ttl_bounds():
    assert clamp_ttl(None) == TTL_DEFAULT_SECONDS
    assert clamp_ttl(10) == 60
    assert clamp_ttl(99999) == 900
    assert clamp_ttl(300) == 300


def test_lease_expiry_with_injected_clock():
    now = {"t": 1000.0}
    mgr = LeaseManager(now_fn=lambda: now["t"])
    lease = mgr.issue(
        consumer="c", target_host="youtube.com", sticky=True, country=None,
        ttl_seconds=60, job_id=None, proxy_decision={"proxy_url": "http://x"},
        provider_name="dataimpulse",
    )
    assert mgr.get(lease.lease_id) is not None
    assert mgr.active_count() == 1

    now["t"] = 1000.0 + 61  # past the 60s TTL
    assert mgr.get(lease.lease_id) is None
    assert mgr.active_count() == 0
    # A report against an expired (swept) lease is rejected.
    assert mgr.report(lease.lease_id, 1, 1, 1, False) is None


def test_daily_accumulator_resets_on_utc_day_rollover():
    # Two timestamps in different UTC days.
    day1 = 1_700_000_000.0          # some instant
    day2 = day1 + 86_400            # +24h → next UTC day
    now = {"t": day1}
    mgr = LeaseManager(now_fn=lambda: now["t"])
    lease = mgr.issue(
        consumer="c", target_host="youtube.com", sticky=False, country=None,
        ttl_seconds=900, job_id=None, proxy_decision={"proxy_url": None},
        provider_name="none", byte_cap_bytes=10 ** 12,
    )
    mgr.report(lease.lease_id, 1024 ** 3, 0, 1, False)  # 1 GB
    assert mgr.daily_gb_used() == pytest.approx(1.0)

    now["t"] = day2
    assert mgr.daily_gb_used() == pytest.approx(0.0)  # rolled over → reset
