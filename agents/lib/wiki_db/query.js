/**
 * query.ts — Parameterized query execution with policy enforcement.
 *
 * Wraps `driver.executeReadAsync(conn, sql, params, maxRows, timeoutMs)`
 * with policy checks, error handling, and structured results.
 * NEVER raises — all exceptions are caught and returned as error dicts.
 *
 * Possible statuses:
 *   ok           — query ran successfully
 *   denied       — policy blocked the query
 *   present_only — DML displayed but not executed
 *   escalate     — query needs human approval
 *   error        — execution failed
 *
 * Driver contract: callers supply a `QueryableDriver` whose
 * `executeReadAsync` maps onto the public result format. Sync drivers
 * (SQLite, legacy test stubs) wrap their `executeRead` into an async
 * shim at the call site — see `adaptDriver` in
 * `agents/wiki-db-agent/scripts/db_query.ts`.
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
        // 2. Execute via driver (ALLOW). G-QUERY-ASYNC-ONLY: every driver
        // must expose executeReadAsync. Sync drivers (SQLite, legacy test
        // stubs) get wrapped by `adaptDriver` at the call site.
        if (typeof driver.executeReadAsync !== "function") {
            throw new Error("driver.executeReadAsync is required — wrap sync drivers at the call site");
        }
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
