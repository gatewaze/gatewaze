"""SSRF guard: reject URLs that resolve to private/loopback/link-local IPs.

Implements spec §8.2 — DNS pre-resolution against an IP allowlist, with
TOCTOU mitigation via IP-rewrite + Host header for non-browser modes. For
browser mode, a Playwright `route` interceptor re-checks each navigation.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse


_BLOCKED_NETWORKS_V4 = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
]

_BLOCKED_NETWORKS_V6 = [
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


class SsrfBlockedError(ValueError):
    """Raised when a URL resolves to a blocked address range."""

    def __init__(self, host: str, ip: str, reason: str) -> None:
        super().__init__(f"Host {host!r} resolves to {ip} ({reason})")
        self.host = host
        self.ip = ip
        self.reason = reason


@dataclass(frozen=True)
class ResolvedTarget:
    """A URL that has passed the SSRF guard, with its resolved IP cached."""

    original_url: str
    host: str
    port: int | None
    resolved_ip: str
    rewritten_url: str  # IP-literal URL to use for the actual connection
    is_ipv6: bool


def _is_blocked(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    """Return the reason string if the address is blocked, else None."""
    if isinstance(addr, ipaddress.IPv4Address):
        for net in _BLOCKED_NETWORKS_V4:
            if addr in net:
                return f"blocked range {net}"
    else:
        for net in _BLOCKED_NETWORKS_V6:
            if addr in net:
                return f"blocked range {net}"
    return None


def _resolve_all(host: str, port: int | None) -> list[tuple[str, int]]:
    """Best-effort DNS resolution returning all (ip, family) tuples."""
    try:
        infos = socket.getaddrinfo(
            host,
            port,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as e:
        raise SsrfBlockedError(host, "?", f"dns lookup failed: {e}") from e
    return [(info[4][0], info[0]) for info in infos]


def check_url_or_raise(url: str) -> ResolvedTarget:
    """Validate the URL doesn't resolve to a blocked range.

    Returns a ResolvedTarget with the IP-literal URL pre-computed for use
    by the non-browser fetchers. Raises SsrfBlockedError if any A/AAAA
    record resolves to a blocked range — we reject on ANY blocked match,
    not just the first resolved IP, to defend against DNS load-balancing
    that mixes public and private addresses.
    """
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise SsrfBlockedError("?", "?", "url has no host component")
    port = parsed.port

    resolved = _resolve_all(host, port)
    chosen_ip: str | None = None
    chosen_family: int | None = None
    for ip_str, family in resolved:
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        reason = _is_blocked(addr)
        if reason:
            raise SsrfBlockedError(host, ip_str, reason)
        if chosen_ip is None:
            chosen_ip = ip_str
            chosen_family = family

    if chosen_ip is None:
        raise SsrfBlockedError(host, "?", "no usable A/AAAA records")

    is_ipv6 = chosen_family == socket.AF_INET6
    if is_ipv6:
        host_part = f"[{chosen_ip}]"
    else:
        host_part = chosen_ip
    if port:
        netloc = f"{host_part}:{port}"
    else:
        netloc = host_part

    rewritten = urlunparse(
        (
            parsed.scheme,
            netloc,
            parsed.path or "/",
            parsed.params,
            parsed.query,
            parsed.fragment,
        )
    )

    return ResolvedTarget(
        original_url=url,
        host=host,
        port=port,
        resolved_ip=chosen_ip,
        rewritten_url=rewritten,
        is_ipv6=is_ipv6,
    )
