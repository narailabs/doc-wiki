"""Environment configuration registry for wiki_db."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

_VALID_APPROVAL_MODES = frozenset({
    "auto",
    "confirm-once",
    "confirm-each",
    "grant-required",
})

_registry: Dict[str, EnvironmentConfig] = {}


@dataclass(frozen=True)
class EnvironmentConfig:
    """Immutable configuration for a database environment."""
    host: str
    port: int
    database: str
    schema: str = "public"
    approval_mode: str = "auto"
    driver: str = "postgresql"


def register_environment(
    name: str,
    *,
    host: str,
    port: int,
    database: str,
    schema: str = "public",
    approval_mode: str = "auto",
    driver: str = "postgresql",
) -> None:
    """Register a named environment configuration."""
    if approval_mode not in _VALID_APPROVAL_MODES:
        raise ValueError(
            f"approval_mode must be one of {sorted(_VALID_APPROVAL_MODES)}, "
            f"got {approval_mode!r}"
        )
    _registry[name] = EnvironmentConfig(
        host=host,
        port=port,
        database=database,
        schema=schema,
        approval_mode=approval_mode,
        driver=driver,
    )


def get_environment(name: str) -> EnvironmentConfig:
    """Return the config for *name*, or raise KeyError."""
    return _registry[name]


def list_environments() -> List[str]:
    """Return a list of registered environment names."""
    return list(_registry.keys())


def clear_environments() -> None:
    """Remove all registered environments."""
    _registry.clear()
