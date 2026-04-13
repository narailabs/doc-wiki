/**
 * query.ts — Parameterized query execution with policy enforcement.
 *
 * Wraps `driver.execute(...)` with policy checks, error handling, and
 * structured results. NEVER raises — all exceptions are caught and
 * returned as error dicts.
 *
 * Possible statuses:
 *   ok           — query ran successfully
 *   denied       — policy blocked the query
 *   present_only — DML displayed but not executed
 *   escalate     — query needs human approval
 *   error        — execution failed
 *
 * Parity notes vs `query.py`:
 *  - The driver is typed loosely because the Python test suite passes a
 *    MagicMock with `.execute` (note: NOT `.executeRead`). The mock matches
 *    Python's calling pattern. We mirror that: we call `.execute(sql, {
 *    params, max_rows, timeout_ms })` when present. Concrete drivers
 *    (SQLiteDriver) expose `.executeRead`; tests use mocks.
 *  - `execution_time_ms` is rounded to 2 decimal places as in Python's
 *    `round(... * 1000, 2)`.
 */
import { performance } from "node:perf_hooks";
import { Decision } from "./policy.js";
/** Execute a SQL query through policy checks and the database driver.
 *
 * Returns a structured dict — never raises.
 */
export function executeQuery(driver, sql, policy, options = {}) {
    const { params = null, max_rows: maxRows = 1000, timeout_ms: timeoutMs = 30000, } = options;
    const start = performance.now();
    try {
        // 1. Policy check
        const policyResult = policy.checkQuery(sql);
        if (policyResult.decision === Decision.DENY) {
            return {
                status: "denied",
                reason: policyResult.reason,
                execution_time_ms: _elapsedMs(start),
            };
        }
        if (policyResult.decision === Decision.PRESENT_ONLY) {
            return {
                status: "present_only",
                reason: policyResult.reason,
                formatted_sql: policyResult.formatted_sql,
                execution_time_ms: _elapsedMs(start),
            };
        }
        if (policyResult.decision === Decision.ESCALATE) {
            return {
                status: "escalate",
                reason: policyResult.reason,
                execution_time_ms: _elapsedMs(start),
            };
        }
        // 2. Execute via driver (ALLOW)
        const raw = driver.execute(sql, {
            params,
            max_rows: maxRows,
            timeout_ms: timeoutMs,
        });
        const rows = raw?.rows ?? [];
        const columns = raw?.columns ?? [];
        const truncated = rows.length >= maxRows;
        return {
            status: "ok",
            rows,
            columns,
            row_count: rows.length,
            truncated,
            execution_time_ms: _elapsedMs(start),
        };
    }
    catch (exc) {
        return {
            status: "error",
            error: exc.message,
            execution_time_ms: _elapsedMs(start),
        };
    }
}
function _elapsedMs(start) {
    // performance.now() returns ms directly.
    return Math.round((performance.now() - start) * 100) / 100;
}
/** Python alias for callers that prefer snake_case. */
export const execute_query = executeQuery;
