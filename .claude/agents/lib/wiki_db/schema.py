"""Schema introspection with TTL cache."""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

from .drivers.base import DatabaseDriver, Table


class SchemaManager:
    """Cached schema introspection via a database driver."""

    def __init__(self, driver: DatabaseDriver, ttl: float = 300.0):
        self._driver = driver
        self._ttl = ttl
        self._cache: Dict[Tuple, Dict[str, Any]] = {}

    def get_schema(self, conn: Any, env: str, schema_name: str = "",
                   table_filter: Optional[str] = None) -> List[Table]:
        """Get schema, using cache if within TTL."""
        cache_key = (env, schema_name, table_filter)
        now = time.monotonic()

        if cache_key in self._cache:
            entry = self._cache[cache_key]
            if now - entry["ts"] < self._ttl:
                return entry["data"]

        try:
            tables = self._driver.get_schema(conn, schema_name, table_filter)
        except Exception:
            return []

        self._cache[cache_key] = {"ts": now, "data": tables}
        return tables

    def clear_cache(self) -> None:
        """Force re-query on next call."""
        self._cache.clear()
