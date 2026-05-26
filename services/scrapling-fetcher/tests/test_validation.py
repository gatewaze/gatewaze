"""Pydantic validation tests on the /fetch payload."""

from __future__ import annotations


_AUTH = {"X-Internal-Token": "test-token-please-do-not-use-in-prod"}


def test_rejects_invalid_url_scheme(client):
    resp = client.post(
        "/fetch", json={"url": "ftp://example.com"}, headers=_AUTH
    )
    assert resp.status_code == 422


def test_rejects_url_without_host(client):
    resp = client.post(
        "/fetch", json={"url": "https://"}, headers=_AUTH
    )
    assert resp.status_code == 422


def test_rejects_timeout_above_cap(client):
    resp = client.post(
        "/fetch",
        json={"url": "https://example.com", "timeout_ms": 999999},
        headers=_AUTH,
    )
    assert resp.status_code == 422


def test_rejects_invalid_mode(client):
    resp = client.post(
        "/fetch",
        json={"url": "https://example.com", "mode": "telepathy"},
        headers=_AUTH,
    )
    assert resp.status_code == 422


def test_rejects_non_json_content_type(client):
    resp = client.post(
        "/fetch",
        data="url=https://example.com",
        headers={**_AUTH, "Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code in (415, 422)
