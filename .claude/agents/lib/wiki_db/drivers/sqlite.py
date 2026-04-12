"""SQLite driver — used for fast unit tests and local/embedded databases."""
from __future__ import annotations

import sqlite3
import time
from typing import Any, Dict, List, Optional

from .base import Column, DatabaseDriver, Table


class SQLiteDriver(DatabaseDriver):
    """SQLite implementation of DatabaseDriver."""

    def connect(self, env_config: dict) -> sqlite3.Connection:
        db_path = env_config.get("database", ":memory:")
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def execute_read(self, conn: sqlite3.Connection, query: str,
                     params: Optional[tuple] = None,
                     max_rows: int = 1000, timeout_ms: int = 30000) -> dict:
        start = time.monotonic()
        try:
            cursor = conn.execute(query, params or ())
            # Fetch one extra row to detect truncation
            rows_raw = cursor.fetchmany(max_rows + 1)
            truncated = len(rows_raw) > max_rows
            if truncated:
                rows_raw = rows_raw[:max_rows]

            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = [dict(r) for r in rows_raw]
            elapsed = (time.monotonic() - start) * 1000

            return {
                "status": "success",
                "rows": rows,
                "row_count": len(rows),
                "columns": columns,
                "execution_time_ms": round(elapsed, 2),
                "truncated": truncated,
            }
        except sqlite3.Error as e:
            elapsed = (time.monotonic() - start) * 1000
            return {
                "status": "error",
                "error_code": "SQL_ERROR",
                "error": str(e),
                "execution_time_ms": round(elapsed, 2),
            }

    def get_schema(self, conn: sqlite3.Connection, schema_name: str = "",
                   table_filter: Optional[str] = None) -> List[Table]:
        try:
            # Get table names
            query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            if table_filter:
                query += f" AND name LIKE ?"
                cursor = conn.execute(query, (table_filter,))
            else:
                cursor = conn.execute(query)

            tables = []
            for row in cursor.fetchall():
                table_name = row[0]
                # Get columns via PRAGMA
                col_cursor = conn.execute(f"PRAGMA table_info({table_name})")
                columns = []
                for col_row in col_cursor.fetchall():
                    columns.append(Column(
                        name=col_row[1],           # name
                        data_type=col_row[2],       # type
                        nullable=not col_row[3],    # notnull (inverted)
                        is_primary_key=bool(col_row[5]),  # pk
                        default=col_row[4],         # dflt_value
                    ))
                tables.append(Table(name=table_name, schema=schema_name, columns=columns))
            return tables
        except sqlite3.Error:
            return []

    def close(self, conn: sqlite3.Connection) -> None:
        conn.close()
