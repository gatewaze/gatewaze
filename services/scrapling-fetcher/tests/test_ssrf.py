"""SSRF guard unit tests — mocks DNS, never touches the network.

Spec §12.1: "monkey-patched per test to return controlled IP results."
"""

from __future__ import annotations

import socket

import pytest

from app.ssrf import SsrfBlockedError, check_url_or_raise


def _patch_dns(monkeypatch, fake_ip: str, family: int = socket.AF_INET):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(family, socket.SOCK_STREAM, 0, "", (fake_ip, port or 0))]
    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)


@pytest.mark.parametrize("ip,reason_substr", [
    ("10.1.2.3", "10.0.0.0/8"),
    ("172.16.0.1", "172.16.0.0/12"),
    ("192.168.10.20", "192.168.0.0/16"),
    ("127.0.0.1", "127.0.0.0/8"),
    ("169.254.169.254", "169.254.0.0/16"),
    ("100.64.0.5", "100.64.0.0/10"),
    ("0.0.0.1", "0.0.0.0/8"),
])
def test_blocks_ipv4_ranges(monkeypatch, ip, reason_substr):
    _patch_dns(monkeypatch, ip)
    with pytest.raises(SsrfBlockedError) as exc:
        check_url_or_raise("https://internal.example/foo")
    assert reason_substr in str(exc.value)


@pytest.mark.parametrize("ip,reason_substr", [
    ("::1", "::1/128"),
    ("fc00::1", "fc00::/7"),
    ("fe80::1", "fe80::/10"),
])
def test_blocks_ipv6_ranges(monkeypatch, ip, reason_substr):
    _patch_dns(monkeypatch, ip, family=socket.AF_INET6)
    with pytest.raises(SsrfBlockedError) as exc:
        check_url_or_raise("https://internal.example/foo")
    assert reason_substr in str(exc.value)


def test_allows_public_ipv4(monkeypatch):
    _patch_dns(monkeypatch, "203.0.113.5")
    target = check_url_or_raise("https://example.com/path?a=1")
    assert target.host == "example.com"
    assert target.resolved_ip == "203.0.113.5"
    assert target.rewritten_url == "https://203.0.113.5/path?a=1"
    assert target.is_ipv6 is False


def test_allows_public_ipv6(monkeypatch):
    _patch_dns(monkeypatch, "2606:4700:4700::1111", family=socket.AF_INET6)
    target = check_url_or_raise("https://example.com/")
    assert target.is_ipv6 is True
    assert target.rewritten_url == "https://[2606:4700:4700::1111]/"


def test_dns_failure_raises(monkeypatch):
    def boom(*args, **kwargs):
        raise socket.gaierror(socket.EAI_NONAME, "no such host")
    monkeypatch.setattr(socket, "getaddrinfo", boom)
    with pytest.raises(SsrfBlockedError) as exc:
        check_url_or_raise("https://nope.example/")
    assert "dns lookup failed" in str(exc.value)


def test_url_without_host_rejected():
    with pytest.raises(SsrfBlockedError):
        check_url_or_raise("https://")


def test_mixed_resolution_blocks_on_any_blocked(monkeypatch):
    """If DNS returns one public + one private IP, we still reject."""
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("203.0.113.5", 0)),
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("10.0.0.5", 0)),
        ]
    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(SsrfBlockedError):
        check_url_or_raise("https://mixed.example/")
