"""Tests for wiki_db.audit module."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from wiki_db.audit import disable_audit, enable_audit, log_event, log_query


@pytest.fixture(autouse=True)
def _clean_audit():
    """Disable audit before and after every test."""
    disable_audit()
    yield
    disable_audit()


# ---------- 1. enable_disable ----------
def test_enable_disable(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    enable_audit(str(log_path), session_id="abc123")
    log_query(env="dev", query="SELECT 1", status="ok", row_count=1,
              execution_time_ms=5)
    disable_audit()
    # After disable, further writes should be no-ops
    log_query(env="dev", query="SELECT 2", status="ok", row_count=1,
              execution_time_ms=3)
    lines = log_path.read_text().strip().splitlines()
    assert len(lines) == 1


# ---------- 2. disabled_by_default ----------
def test_disabled_by_default(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    # Should not raise and should not create the file
    log_query(env="dev", query="SELECT 1", status="ok", row_count=0,
              execution_time_ms=1)
    assert not log_path.exists()


# ---------- 3. log_query_event ----------
def test_log_query_event(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    enable_audit(str(log_path), session_id="sess01")
    log_query(env="dev", query="SELECT * FROM t", status="ok",
              row_count=42, execution_time_ms=120, error=None,
              context="unit-test")
    record = json.loads(log_path.read_text().strip())
    assert record["event_type"] == "query"
    assert record["env"] == "dev"
    assert record["query"] == "SELECT * FROM t"
    assert record["status"] == "ok"
    assert record["row_count"] == 42
    assert record["execution_time_ms"] == 120
    assert record["session_id"] == "sess01"
    assert record["context"] == "unit-test"
    assert "timestamp" in record


# ---------- 4. query_truncated_2000 ----------
def test_query_truncated_2000(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    enable_audit(str(log_path), session_id="trunc")
    long_query = "X" * 3000
    log_query(env="dev", query=long_query, status="ok", row_count=0,
              execution_time_ms=1)
    record = json.loads(log_path.read_text().strip())
    assert len(record["query"]) == 2000


# ---------- 5. session_id_auto ----------
def test_session_id_auto(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    enable_audit(str(log_path))  # no explicit session_id
    log_query(env="dev", query="SELECT 1", status="ok", row_count=0,
              execution_time_ms=1)
    record = json.loads(log_path.read_text().strip())
    sid = record["session_id"]
    assert isinstance(sid, str)
    assert len(sid) == 12
    # Must be valid hex
    int(sid, 16)


# ---------- 6. custom_session_id ----------
def test_custom_session_id(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    enable_audit(str(log_path), session_id="my-custom-id")
    log_query(env="dev", query="SELECT 1", status="ok", row_count=0,
              execution_time_ms=1)
    record = json.loads(log_path.read_text().strip())
    assert record["session_id"] == "my-custom-id"


# ---------- 7. non_failing_write_error ----------
def test_non_failing_write_error(tmp_path: Path):
    # Point audit to a path that cannot be written (directory does not exist)
    bad_path = tmp_path / "no" / "such" / "dir" / "audit.jsonl"
    enable_audit(str(bad_path), session_id="fail-safe")
    # Should NOT raise
    log_query(env="dev", query="SELECT 1", status="ok", row_count=0,
              execution_time_ms=1)


# ---------- 8. log_non_query_event ----------
def test_log_non_query_event(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    enable_audit(str(log_path), session_id="evt01")
    log_event(event_type="schema_inspect", details={"table": "users"})
    record = json.loads(log_path.read_text().strip())
    assert record["event_type"] == "schema_inspect"
    assert record["details"] == {"table": "users"}
    assert record["session_id"] == "evt01"
    assert "timestamp" in record


# ---------- 9. multiple_append ----------
def test_multiple_append(tmp_path: Path):
    log_path = tmp_path / "audit.jsonl"
    enable_audit(str(log_path), session_id="multi")
    log_query(env="dev", query="Q1", status="ok", row_count=1,
              execution_time_ms=1)
    log_query(env="dev", query="Q2", status="ok", row_count=2,
              execution_time_ms=2)
    log_event(event_type="connect", details={"host": "localhost"})
    lines = log_path.read_text().strip().splitlines()
    assert len(lines) == 3
    # Verify each line is valid JSON
    for line in lines:
        json.loads(line)
