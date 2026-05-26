"""Shared pytest fixtures."""

from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    """Every test runs with a known token; tests can override per-case."""
    monkeypatch.setenv("SCRAPLING_INTERNAL_TOKEN", "test-token-please-do-not-use-in-prod")
    monkeypatch.setenv("SCRAPLING_PROXY_PROVIDER", "none")
    monkeypatch.setenv("SCRAPLING_PROXY_MODE", "none")
    monkeypatch.delenv("SCRAPLING_PROXY_CONFIG", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)


@pytest.fixture
def client(monkeypatch):
    """A TestClient against the FastAPI app, with the lifespan run.

    Imports happen inside the fixture so the autouse env fixture has
    already populated SCRAPLING_INTERNAL_TOKEN before app construction.
    """
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
