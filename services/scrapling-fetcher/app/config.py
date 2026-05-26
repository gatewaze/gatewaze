"""Service configuration loaded once at startup from environment variables."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any


_ENV_REF_RE = re.compile(r"^\$([A-Z_][A-Z0-9_]*)$")


class ProxyConfigError(RuntimeError):
    """Raised when SCRAPLING_PROXY_CONFIG is malformed or references a missing var."""


def _resolve_env_refs(value: Any) -> Any:
    """Apply the $VAR / $$literal interpolation rules from spec §4.1.1.

    Only top-level string values in the config object are scanned; nested
    objects are passed through unchanged.
    """
    if not isinstance(value, str):
        return value
    if value.startswith("$$"):
        return "$" + value[2:]
    match = _ENV_REF_RE.match(value)
    if not match:
        return value
    var_name = match.group(1)
    resolved = os.environ.get(var_name)
    if resolved is None or resolved == "":
        raise ProxyConfigError(
            f"required env var '${var_name}' is unset (referenced by SCRAPLING_PROXY_CONFIG)"
        )
    return resolved


def _parse_proxy_config(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ProxyConfigError(f"SCRAPLING_PROXY_CONFIG is not valid JSON: {e}") from e
    if not isinstance(parsed, dict):
        raise ProxyConfigError("SCRAPLING_PROXY_CONFIG must be a JSON object")
    return {k: _resolve_env_refs(v) for k, v in parsed.items()}


@dataclass(frozen=True)
class Settings:
    internal_token: str
    proxy_provider: str
    proxy_config: dict[str, Any]
    proxy_mode: str
    browser_pool_size: int
    fast_concurrency: int
    per_domain_rps: int
    default_timeout_ms: int
    proxy_daily_gb_cap: float
    log_level: str
    supabase_url: str | None
    supabase_service_key: str | None

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("SCRAPLING_INTERNAL_TOKEN", "")
        if not token:
            raise RuntimeError(
                "SCRAPLING_INTERNAL_TOKEN is required but unset"
            )
        return cls(
            internal_token=token,
            proxy_provider=os.environ.get("SCRAPLING_PROXY_PROVIDER", "none"),
            proxy_config=_parse_proxy_config(
                os.environ.get("SCRAPLING_PROXY_CONFIG")
            ),
            proxy_mode=os.environ.get("SCRAPLING_PROXY_MODE", "none"),
            browser_pool_size=int(
                os.environ.get("SCRAPLING_BROWSER_POOL_SIZE", "4")
            ),
            fast_concurrency=int(
                os.environ.get("SCRAPLING_FAST_CONCURRENCY", "10")
            ),
            per_domain_rps=int(os.environ.get("SCRAPLING_PER_DOMAIN_RPS", "5")),
            default_timeout_ms=int(
                os.environ.get("SCRAPLING_DEFAULT_TIMEOUT_MS", "30000")
            ),
            proxy_daily_gb_cap=float(
                os.environ.get("SCRAPLING_PROXY_DAILY_GB_CAP", "10")
            ),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
            supabase_url=os.environ.get("SUPABASE_URL"),
            supabase_service_key=os.environ.get("SUPABASE_SERVICE_KEY"),
        )
