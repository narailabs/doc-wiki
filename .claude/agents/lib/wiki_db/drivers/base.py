"""Abstract base class for database drivers."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class Column:
    """Represents a database column."""

    def __init__(self, name: str, data_type: str, nullable: bool = True,
                 is_primary_key: bool = False, default: Optional[str] = None):
        self.name = name
        self.data_type = data_type
        self.nullable = nullable
        self.is_primary_key = is_primary_key
        self.default = default

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name, "data_type": self.data_type,
            "nullable": self.nullable, "is_primary_key": self.is_primary_key,
            "default": self.default,
        }


class Table:
    """Represents a database table with its columns."""

    def __init__(self, name: str, schema: str = "", columns: Optional[List[Column]] = None):
        self.name = name
        self.schema = schema
        self.columns = columns or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name, "schema": self.schema,
            "columns": [c.to_dict() for c in self.columns],
        }


class DatabaseDriver(ABC):
    """Abstract base for all database drivers."""

    @abstractmethod
    def connect(self, env_config: dict) -> Any:
        """Create a connection to the database."""

    @abstractmethod
    def execute_read(self, conn: Any, query: str, params: Optional[tuple] = None,
                     max_rows: int = 1000, timeout_ms: int = 30000) -> dict:
        """Execute a read query. Returns structured result dict."""

    @abstractmethod
    def get_schema(self, conn: Any, schema_name: str = "",
                   table_filter: Optional[str] = None) -> List[Table]:
        """Get schema information (tables + columns)."""

    @abstractmethod
    def close(self, conn: Any) -> None:
        """Close a connection."""
