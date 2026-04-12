"""Tests for the SQLite driver."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from wiki_db.drivers.sqlite import SQLiteDriver


@pytest.fixture
def driver():
    return SQLiteDriver()


@pytest.fixture
def conn(driver):
    c = driver.connect({"database": ":memory:"})
    c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT NOT NULL)")
    c.execute("INSERT INTO users VALUES (1, 'Alice', 'alice@test.com')")
    c.execute("INSERT INTO users VALUES (2, 'Bob', 'bob@test.com')")
    c.execute("INSERT INTO users VALUES (3, 'Charlie', 'charlie@test.com')")
    c.commit()
    yield c
    driver.close(c)


class TestConnect:
    def test_connect_in_memory(self, driver):
        c = driver.connect({"database": ":memory:"})
        assert c is not None
        driver.close(c)


class TestExecuteRead:
    def test_returns_result_dict(self, driver, conn):
        result = driver.execute_read(conn, "SELECT * FROM users WHERE id = 1")
        assert result["status"] == "success"
        assert "rows" in result
        assert "row_count" in result
        assert "columns" in result
        assert "execution_time_ms" in result
        assert "truncated" in result

    def test_with_params(self, driver, conn):
        result = driver.execute_read(conn, "SELECT * FROM users WHERE name = ?", ("Alice",))
        assert result["row_count"] == 1
        assert result["rows"][0]["name"] == "Alice"

    def test_max_rows(self, driver, conn):
        result = driver.execute_read(conn, "SELECT * FROM users", max_rows=2)
        assert result["row_count"] == 2
        assert result["truncated"] is True

    def test_empty_result(self, driver, conn):
        result = driver.execute_read(conn, "SELECT * FROM users WHERE id = 999")
        assert result["row_count"] == 0
        assert result["rows"] == []
        assert result["truncated"] is False

    def test_error_returns_error_dict(self, driver, conn):
        result = driver.execute_read(conn, "SELECT * FROM nonexistent_table")
        assert result["status"] == "error"
        assert "error_code" in result
        assert "error" in result


class TestGetSchema:
    def test_returns_tables(self, driver, conn):
        tables = driver.get_schema(conn)
        assert len(tables) >= 1
        names = [t.name for t in tables]
        assert "users" in names

    def test_includes_columns(self, driver, conn):
        tables = driver.get_schema(conn)
        users = [t for t in tables if t.name == "users"][0]
        col_names = [c.name for c in users.columns]
        assert "id" in col_names
        assert "name" in col_names
        assert "email" in col_names

    def test_with_filter(self, driver, conn):
        conn.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY)")
        tables = driver.get_schema(conn, table_filter="user%")
        names = [t.name for t in tables]
        assert "users" in names
        assert "orders" not in names


class TestClose:
    def test_close_connection(self, driver):
        c = driver.connect({"database": ":memory:"})
        driver.close(c)  # should not raise


class TestFullIntegration:
    def test_create_query_verify(self, driver):
        c = driver.connect({"database": ":memory:"})
        c.execute("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)")
        c.execute("INSERT INTO products VALUES (1, 'Widget', 9.99)")
        c.commit()

        result = driver.execute_read(c, "SELECT * FROM products WHERE id = ?", (1,))
        assert result["status"] == "success"
        assert result["rows"][0]["name"] == "Widget"
        assert result["rows"][0]["price"] == 9.99

        tables = driver.get_schema(c)
        assert any(t.name == "products" for t in tables)

        driver.close(c)
