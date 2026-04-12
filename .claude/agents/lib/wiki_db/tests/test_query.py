"""Exhaustive tests for query.py — parameterized query execution.

All tests mock the driver so no real database is needed.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from wiki_db.policy import Decision, Policy, PolicyResult
from wiki_db.query import execute_query


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_driver(
    rows=None,
    columns=None,
    error=None,
):
    driver = MagicMock()
    if error:
        driver.execute.side_effect = error
    else:
        rows = rows if rows is not None else []
        columns = columns if columns is not None else []
        driver.execute.return_value = {"rows": rows, "columns": columns}
    return driver


def _auto_policy():
    return Policy(approval_mode="auto")


# ===================================================================
# Tests
# ===================================================================

class TestExecuteQuery:

    def test_query_returns_structured_result(self):
        driver = _make_driver(
            rows=[{"id": 1, "name": "Alice"}],
            columns=["id", "name"],
        )
        result = execute_query(
            driver=driver,
            sql="SELECT * FROM users WHERE id = 1",
            policy=_auto_policy(),
        )
        assert result["status"] == "ok"
        assert result["rows"] == [{"id": 1, "name": "Alice"}]
        assert result["columns"] == ["id", "name"]

    def test_query_with_params(self):
        driver = _make_driver(rows=[], columns=[])
        execute_query(
            driver=driver,
            sql="SELECT * FROM users WHERE id = ?",
            policy=_auto_policy(),
            params=[42],
        )
        driver.execute.assert_called_once()
        call_args = driver.execute.call_args
        assert call_args[1].get("params") == [42] or call_args[0][1] == [42]

    def test_query_max_rows_default(self):
        driver = _make_driver(rows=[], columns=[])
        execute_query(
            driver=driver,
            sql="SELECT * FROM users WHERE id = 1",
            policy=_auto_policy(),
        )
        call_kwargs = driver.execute.call_args[1]
        assert call_kwargs.get("max_rows") == 1000

    def test_query_truncated_flag(self):
        rows = [{"id": i} for i in range(5)]
        driver = _make_driver(rows=rows, columns=["id"])
        result = execute_query(
            driver=driver,
            sql="SELECT * FROM users WHERE id > 0",
            policy=_auto_policy(),
            max_rows=5,
        )
        assert result["truncated"] is True

    def test_query_not_truncated(self):
        rows = [{"id": 1}]
        driver = _make_driver(rows=rows, columns=["id"])
        result = execute_query(
            driver=driver,
            sql="SELECT * FROM users WHERE id = 1",
            policy=_auto_policy(),
            max_rows=100,
        )
        assert result["truncated"] is False

    def test_query_error_returns_error_dict(self):
        driver = _make_driver(error=RuntimeError("connection lost"))
        result = execute_query(
            driver=driver,
            sql="SELECT * FROM users WHERE id = 1",
            policy=_auto_policy(),
        )
        assert result["status"] == "error"
        assert "connection lost" in result["error"]

    def test_query_never_raises(self):
        driver = _make_driver(error=Exception("kaboom"))
        result = execute_query(
            driver=driver,
            sql="SELECT * FROM users WHERE id = 1",
            policy=_auto_policy(),
        )
        assert result["status"] == "error"

    def test_query_checks_policy_first(self):
        driver = _make_driver(rows=[], columns=[])
        policy = _auto_policy()
        policy.check_query = MagicMock(
            return_value=PolicyResult(decision=Decision.ALLOW, reason="ok")
        )
        execute_query(driver=driver, sql="SELECT 1", policy=policy)
        policy.check_query.assert_called_once_with("SELECT 1")

    def test_query_denied_by_policy_returns_deny(self):
        driver = _make_driver(rows=[], columns=[])
        policy = _auto_policy()
        policy.check_query = MagicMock(
            return_value=PolicyResult(
                decision=Decision.DENY, reason="DDL not allowed"
            )
        )
        result = execute_query(
            driver=driver, sql="DROP TABLE users", policy=policy
        )
        assert result["status"] == "denied"
        assert "DDL" in result["reason"]
        driver.execute.assert_not_called()

    def test_query_dml_returns_present_only(self):
        driver = _make_driver(rows=[], columns=[])
        policy = _auto_policy()
        policy.check_query = MagicMock(
            return_value=PolicyResult(
                decision=Decision.PRESENT_ONLY,
                reason="DML — display only",
                formatted_sql="INSERT INTO t (a) VALUES (1)",
            )
        )
        result = execute_query(
            driver=driver, sql="INSERT INTO t (a) VALUES (1)", policy=policy
        )
        assert result["status"] == "present_only"
        assert result["formatted_sql"] == "INSERT INTO t (a) VALUES (1)"
        driver.execute.assert_not_called()

    def test_query_escalate_returns_escalate(self):
        driver = _make_driver(rows=[], columns=[])
        policy = _auto_policy()
        policy.check_query = MagicMock(
            return_value=PolicyResult(
                decision=Decision.ESCALATE, reason="needs approval"
            )
        )
        result = execute_query(
            driver=driver, sql="SELECT * FROM users", policy=policy
        )
        assert result["status"] == "escalate"
        driver.execute.assert_not_called()

    def test_query_result_includes_execution_time(self):
        driver = _make_driver(rows=[], columns=[])
        result = execute_query(
            driver=driver,
            sql="SELECT 1",
            policy=_auto_policy(),
        )
        assert "execution_time_ms" in result
        assert isinstance(result["execution_time_ms"], (int, float))
        assert result["execution_time_ms"] >= 0
