"""Tests for schema introspection with TTL cache."""
from __future__ import annotations

import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from wiki_db.drivers.sqlite import SQLiteDriver
from wiki_db.schema import SchemaManager


@pytest.fixture
def driver():
    return SQLiteDriver()


@pytest.fixture
def conn(driver):
    c = driver.connect({"database": ":memory:"})
    c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    c.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER)")
    c.commit()
    yield c
    driver.close(c)


@pytest.fixture
def schema_mgr(driver):
    return SchemaManager(driver, ttl=300.0)


class TestGetSchema:
    def test_returns_tables(self, schema_mgr, conn):
        tables = schema_mgr.get_schema(conn, "dev")
        names = [t.name for t in tables]
        assert "users" in names
        assert "orders" in names

    def test_includes_columns(self, schema_mgr, conn):
        tables = schema_mgr.get_schema(conn, "dev")
        users = [t for t in tables if t.name == "users"][0]
        col_names = [c.name for c in users.columns]
        assert "id" in col_names
        assert "name" in col_names

    def test_with_filter(self, schema_mgr, conn):
        tables = schema_mgr.get_schema(conn, "dev", table_filter="user%")
        names = [t.name for t in tables]
        assert "users" in names
        assert "orders" not in names


class TestCache:
    def test_cache_hit(self, driver, conn):
        mock_driver = MagicMock(wraps=driver)
        mgr = SchemaManager(mock_driver, ttl=300.0)

        mgr.get_schema(conn, "dev")
        mgr.get_schema(conn, "dev")  # should hit cache

        assert mock_driver.get_schema.call_count == 1

    def test_cache_miss_after_ttl(self, driver, conn):
        mock_driver = MagicMock(wraps=driver)
        mgr = SchemaManager(mock_driver, ttl=0.01)  # 10ms TTL

        mgr.get_schema(conn, "dev")
        time.sleep(0.02)  # wait for TTL to expire
        mgr.get_schema(conn, "dev")

        assert mock_driver.get_schema.call_count == 2

    def test_clear_cache(self, driver, conn):
        mock_driver = MagicMock(wraps=driver)
        mgr = SchemaManager(mock_driver, ttl=300.0)

        mgr.get_schema(conn, "dev")
        mgr.clear_cache()
        mgr.get_schema(conn, "dev")

        assert mock_driver.get_schema.call_count == 2

    def test_cache_key_per_env(self, driver, conn):
        mock_driver = MagicMock(wraps=driver)
        mgr = SchemaManager(mock_driver, ttl=300.0)

        mgr.get_schema(conn, "dev")
        mgr.get_schema(conn, "qa")  # different env = different cache key

        assert mock_driver.get_schema.call_count == 2

    def test_error_handling(self):
        mock_driver = MagicMock()
        mock_driver.get_schema.side_effect = Exception("connection failed")
        mgr = SchemaManager(mock_driver)

        result = mgr.get_schema(None, "dev")
        assert result == []  # returns empty, doesn't raise
