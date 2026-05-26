"""Pluggable proxy provider implementations.

Built-in providers:
  - none          (no-op)
  - rayobyte      (Phase 1 default)
  - brightdata
  - oxylabs
  - decodo
  - iproyal
  - webshare      (mid-market; rotating residential, $1.40-$3.50/GB)
  - dataimpulse   (budget; never-expiring traffic, $0.80-$1.00/GB)

Custom providers loadable via SCRAPLING_PROXY_PROVIDER=mymodule.MyClass.
"""

from __future__ import annotations

import importlib
from typing import Any

from .base import ProxyDecision, ProxyProvider, ProxyUsage


_BUILTIN: dict[str, str] = {
    "none": "app.proxy.none.NoneProvider",
    "rayobyte": "app.proxy.rayobyte.RayobyteProvider",
    "brightdata": "app.proxy.brightdata.BrightDataProvider",
    "oxylabs": "app.proxy.oxylabs.OxylabsProvider",
    "decodo": "app.proxy.decodo.DecodoProvider",
    "iproyal": "app.proxy.iproyal.IPRoyalProvider",
    "webshare": "app.proxy.webshare.WebshareProvider",
    "dataimpulse": "app.proxy.dataimpulse.DataImpulseProvider",
}


def load_provider(name: str, config: dict[str, Any]) -> ProxyProvider:
    """Resolve ``name`` to either a built-in or a custom provider class."""
    target = _BUILTIN.get(name, name)
    module_path, _, class_name = target.rpartition(".")
    if not module_path:
        raise ValueError(
            f"proxy provider {name!r} is not a known built-in and is not a "
            "valid Python module path (expected 'package.module.ClassName')"
        )
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    return cls(config)


__all__ = ["ProxyDecision", "ProxyProvider", "ProxyUsage", "load_provider"]
