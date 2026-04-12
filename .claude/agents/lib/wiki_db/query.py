"""query.py -- Parameterized query execution with policy enforcement.

Wraps driver.execute with policy checks, error handling, and structured results.
Never raises -- all exceptions are caught and returned as error dicts.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from wiki_db.policy import Decision, Policy, PolicyResult


def execute_query(
    driver: Any,
    sql: str,
    policy: Policy,
    params: Optional[List[Any]] = None,
    max_rows: int = 1000,
    timeout_ms: int = 30000,
) -> Dict[str, Any]:
    """Execute a SQL query through policy checks and the database driver.

    Returns a structured dict -- never raises.

    Possible statuses:
        ok           -- query ran successfully
        denied       -- policy blocked the query
        present_only -- DML displayed but not executed
        escalate     -- query needs human approval
        error        -- execution failed
    """
    start = time.monotonic()

    try:
        # 1. Policy check
        policy_result: PolicyResult = policy.check_query(sql)

        if policy_result.decision == Decision.DENY:
            return {
                "status": "denied",
                "reason": policy_result.reason,
                "execution_time_ms": _elapsed_ms(start),
            }

        if policy_result.decision == Decision.PRESENT_ONLY:
            return {
                "status": "present_only",
                "reason": policy_result.reason,
                "formatted_sql": policy_result.formatted_sql,
                "execution_time_ms": _elapsed_ms(start),
            }

        if policy_result.decision == Decision.ESCALATE:
            return {
                "status": "escalate",
                "reason": policy_result.reason,
                "execution_time_ms": _elapsed_ms(start),
            }

        # 2. Execute via driver (ALLOW)
        raw = driver.execute(
            sql,
            params=params,
            max_rows=max_rows,
            timeout_ms=timeout_ms,
        )

        rows: List[Dict[str, Any]] = raw.get("rows", [])
        columns: List[str] = raw.get("columns", [])
        truncated = len(rows) >= max_rows

        return {
            "status": "ok",
            "rows": rows,
            "columns": columns,
            "row_count": len(rows),
            "truncated": truncated,
            "execution_time_ms": _elapsed_ms(start),
        }

    except Exception as exc:
        return {
            "status": "error",
            "error": str(exc),
            "execution_time_ms": _elapsed_ms(start),
        }


def _elapsed_ms(start: float) -> float:
    """Milliseconds elapsed since *start* (monotonic)."""
    return round((time.monotonic() - start) * 1000, 2)
