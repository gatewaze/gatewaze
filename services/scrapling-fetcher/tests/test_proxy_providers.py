"""Tests covering the pluggable proxy provider abstraction."""

from __future__ import annotations

import pytest

from app.proxy import load_provider
from app.proxy.base import FetchOutcome


def test_none_provider_returns_no_url():
    p = load_provider("none", {})
    import asyncio
    decision = asyncio.run(p.get_proxy_for("https://x.test", "fast", {}))
    assert decision["proxy_url"] is None


def test_rayobyte_requires_credentials():
    with pytest.raises(ValueError, match="username"):
        load_provider("rayobyte", {})


def test_rayobyte_builds_url_with_session(monkeypatch):
    p = load_provider(
        "rayobyte",
        {"username": "alice", "password": "s3cret", "default_country": "us"},
    )
    import asyncio
    decision = asyncio.run(
        p.get_proxy_for("https://x.test", "fast", {"sticky": True})
    )
    assert "alice-country-us-session-" in decision["proxy_url"]
    assert "sessTime-10" in decision["proxy_url"]
    assert decision["sticky_session_id"] is not None


def test_rayobyte_rotating_omits_session(monkeypatch):
    p = load_provider("rayobyte", {"username": "u", "password": "p"})
    import asyncio
    decision = asyncio.run(p.get_proxy_for("https://x.test", "fast", {}))
    assert "session-" not in decision["proxy_url"]
    assert decision["sticky_session_id"] is None


def test_record_usage_estimates_cost(monkeypatch):
    p = load_provider("rayobyte", {"username": "u", "password": "p"})
    import asyncio
    outcome = FetchOutcome(status=200, bytes_in=1024 ** 3, bytes_out=0, headers={})
    usage = asyncio.run(p.record_usage({"proxy_url": "x"}, outcome))
    # 1 GB at $1.50/GB estimate
    assert usage["cost_usd_estimate"] == pytest.approx(1.50)


def test_unknown_provider_raises():
    with pytest.raises(Exception):
        load_provider("not.a.real.module.NoSuchClass", {})


def test_iproyal_appends_country_to_password():
    p = load_provider(
        "iproyal",
        {"username": "u", "password": "p", "default_country": "gb"},
    )
    import asyncio
    decision = asyncio.run(
        p.get_proxy_for("https://x.test", "fast", {"sticky": True})
    )
    assert "country-gb" in decision["proxy_url"]
    assert "lifetime-10m" in decision["proxy_url"]


def test_brightdata_builds_brd_username():
    p = load_provider(
        "brightdata",
        {"customer": "abc", "zone": "res1", "password": "pw"},
    )
    import asyncio
    decision = asyncio.run(p.get_proxy_for("https://x.test", "fast", {}))
    assert "brd-customer-abc-zone-res1" in decision["proxy_url"]


# ---------------------------------------------------------------------------
# Webshare
# ---------------------------------------------------------------------------

def test_webshare_requires_credentials():
    with pytest.raises(ValueError, match="username"):
        load_provider("webshare", {})


def test_webshare_rotating_default_appends_rotate_flag():
    p = load_provider("webshare", {"username": "u", "password": "pw"})
    import asyncio
    decision = asyncio.run(p.get_proxy_for("https://x.test", "fast", {}))
    # No sticky session: username ends in -rotate (no session id),
    # followed by `:` separating it from the password.
    assert "u-rotate:" in decision["proxy_url"]
    assert "-rotate-" not in decision["proxy_url"]  # no session-id segment
    assert decision["sticky_session_id"] is None


def test_webshare_sticky_session_appends_id():
    p = load_provider("webshare", {"username": "u", "password": "pw"})
    import asyncio
    decision = asyncio.run(
        p.get_proxy_for("https://x.test", "fast", {"sticky": True}),
    )
    assert "-rotate-" in decision["proxy_url"]
    assert decision["sticky_session_id"] is not None


def test_webshare_country_uppercases():
    # Country code MUST be upper-case in the Webshare CC suffix; the
    # operator may pass either case so the provider normalises it.
    p = load_provider(
        "webshare", {"username": "u", "password": "pw", "default_country": "us"},
    )
    import asyncio
    decision = asyncio.run(p.get_proxy_for("https://x.test", "fast", {}))
    assert "CC-US-rotate" in decision["proxy_url"]


def test_webshare_record_usage_estimates_cost():
    p = load_provider("webshare", {"username": "u", "password": "pw"})
    import asyncio
    outcome = FetchOutcome(status=200, bytes_in=1024 ** 3, bytes_out=0, headers={})
    usage = asyncio.run(p.record_usage({"proxy_url": "x"}, outcome))
    # 1 GB at $2.25/GB mid-tier estimate.
    assert usage["cost_usd_estimate"] == pytest.approx(2.25)


# ---------------------------------------------------------------------------
# DataImpulse
# ---------------------------------------------------------------------------

def test_dataimpulse_requires_credentials():
    with pytest.raises(ValueError, match="username"):
        load_provider("dataimpulse", {})


def test_dataimpulse_uses_double_underscore_dot_suffix():
    p = load_provider(
        "dataimpulse",
        {"username": "u", "password": "pw", "default_country": "GB"},
    )
    import asyncio
    decision = asyncio.run(
        p.get_proxy_for("https://x.test", "fast", {"sticky": True}),
    )
    # Country lowercased + double-underscore-dot delimiter; sticky session
    # id appended in the same format.
    assert "__cr.gb" in decision["proxy_url"]
    assert "__sid." in decision["proxy_url"]
    assert decision["sticky_session_id"] is not None


def test_dataimpulse_no_country_no_session_is_bare_username():
    p = load_provider("dataimpulse", {"username": "u", "password": "pw"})
    import asyncio
    decision = asyncio.run(p.get_proxy_for("https://x.test", "fast", {}))
    # Username has no suffixes when neither country nor sticky was asked for.
    assert "u:pw@" in decision["proxy_url"]
    assert "__cr." not in decision["proxy_url"]
    assert "__sid." not in decision["proxy_url"]


def test_dataimpulse_record_usage_estimates_cost():
    p = load_provider("dataimpulse", {"username": "u", "password": "pw"})
    import asyncio
    outcome = FetchOutcome(status=200, bytes_in=1024 ** 3, bytes_out=0, headers={})
    usage = asyncio.run(p.record_usage({"proxy_url": "x"}, outcome))
    # 1 GB at $1.00/GB entry-tier estimate.
    assert usage["cost_usd_estimate"] == pytest.approx(1.00)
