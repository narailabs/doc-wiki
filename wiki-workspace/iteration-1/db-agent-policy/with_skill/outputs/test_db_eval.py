#!/usr/bin/env python3
"""Database agent policy enforcement evaluation.

Runs 3 scenarios against an in-memory SQLite database to verify:
  1. READ queries (SELECT) are ALLOWED under auto approval mode
  2. DML queries (INSERT) are PRESENT_ONLY -- displayed but never executed
  3. DDL queries (DROP TABLE) are DENIED -- never executed

Uses the real wiki_db Policy and execute_query pipeline.
"""
import sys
import json
import sqlite3

sys.path.insert(0, "/Users/narayan/src/doc-wiki/agents/lib/wiki_db")
sys.path.insert(0, "/Users/narayan/src/doc-wiki/agents/lib")

from wiki_db.policy import Policy, Decision
from wiki_db.query import execute_query


# ---------------------------------------------------------------------------
# Adapter: wraps a raw sqlite3 connection so it satisfies the .execute()
# interface that execute_query() expects from a driver object.
# ---------------------------------------------------------------------------
class SQLiteAdapter:
    """Thin adapter bridging sqlite3.Connection to the driver.execute() contract."""

    def __init__(self, db_path: str = ":memory:"):
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row

    def execute(self, sql, params=None, max_rows=1000, timeout_ms=30000):
        cursor = self.conn.execute(sql, tuple(params or []))
        rows_raw = cursor.fetchmany(max_rows + 1)
        truncated = len(rows_raw) > max_rows
        if truncated:
            rows_raw = rows_raw[:max_rows]
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = [dict(r) for r in rows_raw]
        return {"rows": rows, "columns": columns}

    def close(self):
        self.conn.close()


# ---------------------------------------------------------------------------
# Setup: create in-memory SQLite with test data
# ---------------------------------------------------------------------------
driver = SQLiteAdapter(":memory:")
driver.conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)")
driver.conn.execute("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')")
driver.conn.execute("INSERT INTO users VALUES (2, 'Bob', 'bob@example.com')")
driver.conn.commit()

policy = Policy(approval_mode="auto")

results = {}

# ---------------------------------------------------------------------------
# Eval 1: Schema query (should ALLOW -- returns data)
# ---------------------------------------------------------------------------
print("=== EVAL 1: Schema query (SELECT) ===")
result1 = execute_query(
    driver=driver,
    sql="SELECT * FROM users WHERE 1=1",
    policy=policy,
)
print(json.dumps(result1, indent=2))
results["eval1"] = result1

# ---------------------------------------------------------------------------
# Eval 2: DML -- INSERT (should PRESENT_ONLY, never executed)
# ---------------------------------------------------------------------------
print("\n=== EVAL 2: INSERT attempt ===")
result2 = execute_query(
    driver=driver,
    sql="INSERT INTO users VALUES (3, 'Test', 'test@example.com')",
    policy=policy,
)
print(json.dumps(result2, indent=2))
results["eval2"] = result2

# Verify INSERT was NOT executed
verify = driver.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
print(f"  [verify] Row count after INSERT attempt: {verify} (should be 2)")

# ---------------------------------------------------------------------------
# Eval 3: DDL -- DROP TABLE (should DENY, never executed)
# ---------------------------------------------------------------------------
print("\n=== EVAL 3: DROP TABLE attempt ===")
result3 = execute_query(
    driver=driver,
    sql="DROP TABLE users",
    policy=policy,
)
print(json.dumps(result3, indent=2))
results["eval3"] = result3

# Verify table still exists
try:
    verify2 = driver.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    table_exists = True
    print(f"  [verify] Table still exists with {verify2} rows")
except Exception:
    table_exists = False
    print("  [verify] Table was dropped! (FAILURE)")

driver.close()

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("EVALUATION SUMMARY")
print("=" * 60)

eval1_pass = (
    result1["status"] == "ok"
    and result1["row_count"] == 2
    and len(result1["rows"]) == 2
)
eval2_pass = (
    result2["status"] == "present_only"
    and verify == 2
)
eval3_pass = (
    result3["status"] == "denied"
    and table_exists
)

print(f"  Eval 1 (SELECT -> ALLOW):       {'PASS' if eval1_pass else 'FAIL'}")
print(f"  Eval 2 (INSERT -> PRESENT_ONLY): {'PASS' if eval2_pass else 'FAIL'}")
print(f"  Eval 3 (DROP   -> DENY):         {'PASS' if eval3_pass else 'FAIL'}")

all_pass = eval1_pass and eval2_pass and eval3_pass
print(f"\n  Overall: {'ALL PASSED' if all_pass else 'SOME FAILED'}")

sys.exit(0 if all_pass else 1)
