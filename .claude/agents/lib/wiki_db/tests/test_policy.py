"""Exhaustive tests for policy.py — the guard-rail mechanism.

Tests are grouped into:
  1. SQL classification (keyword -> OperationType)
  2. Decision logic (OperationType + environment -> Decision)
"""
from __future__ import annotations

import pytest

from wiki_db.policy import (
    Decision,
    OperationType,
    Policy,
    PolicyResult,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def policy_auto():
    return Policy(approval_mode="auto")


@pytest.fixture
def policy_confirm_once():
    return Policy(approval_mode="confirm_once")


@pytest.fixture
def policy_confirm_each():
    return Policy(approval_mode="confirm_each")


@pytest.fixture
def policy_grant_required():
    return Policy(approval_mode="grant_required")


# ===================================================================
# 1. SQL Classification
# ===================================================================

class TestClassifySQL:

    def test_classify_select(self, policy_auto):
        assert policy_auto.classify_sql("SELECT 1") == OperationType.READ

    def test_classify_select_with_joins(self, policy_auto):
        sql = "SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id"
        assert policy_auto.classify_sql(sql) == OperationType.READ

    def test_classify_explain(self, policy_auto):
        assert policy_auto.classify_sql("EXPLAIN SELECT * FROM t") == OperationType.READ

    def test_classify_insert(self, policy_auto):
        assert policy_auto.classify_sql("INSERT INTO t (a) VALUES (1)") == OperationType.DML

    def test_classify_update(self, policy_auto):
        assert policy_auto.classify_sql("UPDATE t SET a=1 WHERE id=2") == OperationType.DML

    def test_classify_delete(self, policy_auto):
        assert policy_auto.classify_sql("DELETE FROM t WHERE id=3") == OperationType.DML

    def test_classify_drop(self, policy_auto):
        assert policy_auto.classify_sql("DROP TABLE users") == OperationType.DDL

    def test_classify_create_table(self, policy_auto):
        assert policy_auto.classify_sql("CREATE TABLE t (id INT)") == OperationType.DDL

    def test_classify_alter(self, policy_auto):
        assert policy_auto.classify_sql("ALTER TABLE t ADD COLUMN x INT") == OperationType.DDL

    def test_classify_truncate(self, policy_auto):
        assert policy_auto.classify_sql("TRUNCATE TABLE t") == OperationType.DDL

    def test_classify_grant(self, policy_auto):
        assert policy_auto.classify_sql("GRANT SELECT ON t TO user1") == OperationType.PRIVILEGE

    def test_classify_revoke(self, policy_auto):
        assert policy_auto.classify_sql("REVOKE ALL ON t FROM user1") == OperationType.PRIVILEGE

    def test_classify_with_leading_whitespace(self, policy_auto):
        assert policy_auto.classify_sql("   SELECT * FROM t") == OperationType.READ

    def test_classify_with_comment_prefix(self, policy_auto):
        sql = "-- fetch all users\nSELECT * FROM users"
        assert policy_auto.classify_sql(sql) == OperationType.READ

    def test_classify_cte(self, policy_auto):
        sql = "WITH cte AS (SELECT 1) SELECT * FROM cte"
        assert policy_auto.classify_sql(sql) == OperationType.READ


# ===================================================================
# 2. Decision Logic
# ===================================================================

class TestDecisionLogic:

    def test_ddl_always_denied(self, policy_auto):
        result = policy_auto.check_query("DROP TABLE users")
        assert result.decision == Decision.DENY
        assert result.reason

    def test_privilege_always_denied(self, policy_auto):
        result = policy_auto.check_query("GRANT SELECT ON t TO u")
        assert result.decision == Decision.DENY

    def test_dml_always_present_only(self, policy_auto):
        result = policy_auto.check_query("INSERT INTO t (a) VALUES (1)")
        assert result.decision == Decision.PRESENT_ONLY

    def test_read_auto_env_allowed(self, policy_auto):
        result = policy_auto.check_query("SELECT 1")
        assert result.decision == Decision.ALLOW

    def test_read_confirm_once_first_time(self, policy_confirm_once):
        result = policy_confirm_once.check_query("SELECT 1")
        assert result.decision == Decision.ESCALATE

    def test_read_confirm_once_after_approval(self, policy_confirm_once):
        policy_confirm_once.approve_session()
        result = policy_confirm_once.check_query("SELECT 1")
        assert result.decision == Decision.ALLOW

    def test_read_confirm_each_always_escalates(self, policy_confirm_each):
        result = policy_confirm_each.check_query("SELECT 1")
        assert result.decision == Decision.ESCALATE
        policy_confirm_each.approve_session()
        result2 = policy_confirm_each.check_query("SELECT 1")
        assert result2.decision == Decision.ESCALATE

    def test_read_grant_required_no_grant(self, policy_grant_required):
        result = policy_grant_required.check_query("SELECT 1")
        assert result.decision == Decision.DENY

    def test_read_grant_required_with_grant(self, policy_grant_required):
        policy_grant_required.add_grant("read", ttl_seconds=300)
        result = policy_grant_required.check_query("SELECT 1")
        assert result.decision == Decision.ALLOW

    def test_unbounded_select_escalates(self, policy_auto):
        result = policy_auto.check_query("SELECT * FROM users")
        assert result.decision == Decision.ESCALATE

    def test_bounded_select_allowed(self, policy_auto):
        result = policy_auto.check_query("SELECT * FROM users WHERE id = 1")
        assert result.decision == Decision.ALLOW

    def test_empty_sql_denied(self, policy_auto):
        result = policy_auto.check_query("")
        assert result.decision == Decision.DENY

    def test_present_only_includes_formatted_sql(self, policy_auto):
        result = policy_auto.check_query("update t set a=1 where id=2")
        assert result.decision == Decision.PRESENT_ONLY
        assert result.formatted_sql is not None
        assert "UPDATE" in result.formatted_sql.upper()

    def test_grant_active_after_add(self, policy_grant_required):
        policy_grant_required.add_grant("read", ttl_seconds=300)
        assert policy_grant_required.is_grant_active("read") is True

    def test_grant_not_active_by_default(self, policy_grant_required):
        assert policy_grant_required.is_grant_active("read") is False

    def test_grant_expired(self, policy_grant_required):
        policy_grant_required.add_grant("read", ttl_seconds=0)
        assert policy_grant_required.is_grant_active("read") is False
