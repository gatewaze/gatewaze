"""Internal-token middleware tests."""

from __future__ import annotations


def test_fetch_rejects_missing_token(client):
    resp = client.post("/fetch", json={"url": "https://example.com"})
    assert resp.status_code == 401
    assert resp.json() == {"error": "auth_required"}
    assert resp.headers["WWW-Authenticate"].startswith('InternalToken realm="')


def test_fetch_rejects_wrong_token(client):
    resp = client.post(
        "/fetch",
        json={"url": "https://example.com"},
        headers={"X-Internal-Token": "wrong-token"},
    )
    assert resp.status_code == 401


def test_healthz_does_not_require_token(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200


def test_readyz_does_not_require_token(client):
    resp = client.get("/readyz")
    assert resp.status_code in (200, 503)


def test_metrics_does_not_require_token(client):
    resp = client.get("/metrics")
    assert resp.status_code == 200
