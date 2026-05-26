"""Settings.from_env / proxy-config interpolation tests."""

from __future__ import annotations

import json

import pytest

from app.config import ProxyConfigError, Settings, _resolve_env_refs


def test_resolves_simple_env_ref(monkeypatch):
    monkeypatch.setenv("MY_VAR", "value-from-env")
    assert _resolve_env_refs("$MY_VAR") == "value-from-env"


def test_double_dollar_escapes_to_literal():
    assert _resolve_env_refs("$$literal") == "$literal"


def test_partial_dollar_passes_through_unchanged():
    # "prefix-$X" is not interpolated — only ^\$VAR$ matches
    assert _resolve_env_refs("prefix-$X") == "prefix-$X"


def test_missing_env_var_raises(monkeypatch):
    monkeypatch.delenv("UNSET_VAR", raising=False)
    with pytest.raises(ProxyConfigError, match=r"\$UNSET_VAR"):
        _resolve_env_refs("$UNSET_VAR")


def test_empty_env_var_raises(monkeypatch):
    monkeypatch.setenv("EMPTY_VAR", "")
    with pytest.raises(ProxyConfigError):
        _resolve_env_refs("$EMPTY_VAR")


def test_non_string_passes_through():
    assert _resolve_env_refs(42) == 42
    assert _resolve_env_refs(None) is None
    assert _resolve_env_refs([1, 2]) == [1, 2]


def test_settings_from_env_round_trip(monkeypatch):
    monkeypatch.setenv("SCRAPLING_INTERNAL_TOKEN", "abc")
    monkeypatch.setenv("RAYOBYTE_PW", "real-password")
    monkeypatch.setenv(
        "SCRAPLING_PROXY_CONFIG",
        json.dumps({"username": "u", "password": "$RAYOBYTE_PW"}),
    )
    monkeypatch.setenv("SCRAPLING_PROXY_PROVIDER", "rayobyte")
    s = Settings.from_env()
    assert s.proxy_config["password"] == "real-password"
    assert s.proxy_provider == "rayobyte"


def test_settings_requires_token(monkeypatch):
    monkeypatch.delenv("SCRAPLING_INTERNAL_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="SCRAPLING_INTERNAL_TOKEN"):
        Settings.from_env()
