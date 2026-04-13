/**
 * query.ts — Parameterized query execution with policy enforcement.
 *
 * Wraps either `driver.executeReadAsync(...)` (Phase E drivers: pg, mysql,
 * mssql, mongo, dynamo — all genuinely async) or `driver.execute(sql, kwargs)`
 * (legacy sync path used by the mocked test drivers and the SQLite adapter
 * in db_query.ts) with policy checks, error handling, and structured
 * results. NEVER raises — all exceptions are caught and returned as error
 * dicts.
 *
 * Possible statuses:
 *   ok           — query ran successfully
 *   denied       — policy blocked the query
 *   present_only — DML displayed but not executed
 *   escalate     — query needs human approval
 *   error        — execution failed
 *
 * Driver detection:
 *  - If `typeof driver.executeReadAsync === "function"`, we await it with
 *    the positional signature `(conn, sql, params, maxRows, timeoutMs)` and
 *    map its {status, rows, columns, truncated, error_code, error} shape
 *    onto the public result format.
 *  - Otherwise we call the legacy sync `driver.execute(sql, kwargs)` with a
 *    snake_case kwargs bag — this is what the existing test suite mocks.
 */
import { performance } from "node:perf_hooks";
import { Decision } from "./policy.js";
/** Execute a SQL query through policy checks and the database driver.
 *
 * Returns a structured dict — never raises.
 */
export async function executeQuery(driver, sql, policy, options = {}) {
    const { conn, params = null, max_rows: maxRows = 1000, timeout_ms: timeoutMs = 30000, } = options;
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
        if (typeof driver.executeReadAsync === "function") {
            // Async path: Phase E drivers (pg, mysql, mssql, mongo, dynamo).
            const raw = await driver.executeReadAsync(conn, sql, params, maxRows, timeoutMs);
            if (raw.status === "error") {
                return {
                    status: "error",
                    error: `${raw.error_code ?? "SQL_ERROR"}: ${raw.error ?? "unknown driver error"}`,
                    execution_time_ms: _elapsedMs(start),
                };
            }
            const rows = raw.rows ?? [];
            const columns = raw.columns ?? [];
            const truncated = raw.truncated ?? rows.length >= maxRows;
            return {
                status: "ok",
                rows,
                columns,
                row_count: rows.length,
                truncated,
                execution_time_ms: _elapsedMs(start),
            };
        }
        // Sync path: legacy mocked test drivers + db_query.ts adapter.
        if (typeof driver.execute !== "function") {
            throw new Error("driver exposes neither executeReadAsync nor execute");
        }
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
