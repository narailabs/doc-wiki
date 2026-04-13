/**
 * Tests for query.ts — ported 1:1 from `test_query.py`.
 *
 * All tests mock the driver so no real database is needed.
 */
import { describe, expect, it, vi } from "vitest";

import { Decision, Policy, type PolicyResult } from "../policy.js";
import { executeQuery, type QueryableDriver } from "../query.js";

interface MakeDriverOptions {
  rows?: Record<string, unknown>[];
  columns?: string[];
  error?: Error;
}

function _makeDriver(
  opts: MakeDriverOptions = {},
): {
  driver: QueryableDriver;
  executeSpy: ReturnType<typeof vi.fn>;
} {
  const executeSpy = vi.fn();
  if (opts.error) {
    executeSpy.mockImplementation(() => {
      throw opts.error;
    });
  } else {
    const rows = opts.rows ?? [];
    const columns = opts.columns ?? [];
    executeSpy.mockReturnValue({ rows, columns });
  }
  const driver: QueryableDriver = {
    execute: executeSpy as unknown as QueryableDriver["execute"],
  };
  return { driver, executeSpy };
}

function _autoPolicy(): Policy {
  return new Policy("auto");
}

describe("TestExecuteQuery", () => {
  it("test_query_returns_structured_result", () => {
    const { driver } = _makeDriver({
      rows: [{ id: 1, name: "Alice" }],
      columns: ["id", "name"],
    });
    const result = executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    expect(result["status"]).toBe("ok");
    expect(result["rows"]).toEqual([{ id: 1, name: "Alice" }]);
    expect(result["columns"]).toEqual(["id", "name"]);
  });

  it("test_query_with_params", () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    executeQuery(
      driver,
      "SELECT * FROM users WHERE id = ?",
      _autoPolicy(),
      { params: [42] },
    );
    expect(executeSpy).toHaveBeenCalledTimes(1);
    const call = executeSpy.mock.calls[0]!;
    // (sql, {params, max_rows, timeout_ms}) — mirrors Python's kwargs style.
    const kwargs = call[1] as { params?: unknown[] };
    expect(kwargs.params).toEqual([42]);
  });

  it("test_query_max_rows_default", () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    const call = executeSpy.mock.calls[0]!;
    const kwargs = call[1] as { max_rows?: number };
    expect(kwargs.max_rows).toBe(1000);
  });

  it("test_query_truncated_flag", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const { driver } = _makeDriver({ rows, columns: ["id"] });
    const result = executeQuery(
      driver,
      "SELECT * FROM users WHERE id > 0",
      _autoPolicy(),
      { max_rows: 5 },
    );
    expect(result["truncated"]).toBe(true);
  });

  it("test_query_not_truncated", () => {
    const rows = [{ id: 1 }];
    const { driver } = _makeDriver({ rows, columns: ["id"] });
    const result = executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
      { max_rows: 100 },
    );
    expect(result["truncated"]).toBe(false);
  });

  it("test_query_error_returns_error_dict", () => {
    const { driver } = _makeDriver({
      error: new Error("connection lost"),
    });
    const result = executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    expect(result["status"]).toBe("error");
    expect(result["error"]).toContain("connection lost");
  });

  it("test_query_never_raises", () => {
    const { driver } = _makeDriver({ error: new Error("kaboom") });
    const result = executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    expect(result["status"]).toBe("error");
  });

  it("test_query_checks_policy_first", () => {
    const { driver } = _makeDriver({ rows: [], columns: [] });
    const policy = _autoPolicy();
    const checkSpy = vi
      .fn<(sql: string) => PolicyResult>()
      .mockReturnValue({ decision: Decision.ALLOW, reason: "ok" });
    policy.checkQuery = checkSpy as unknown as Policy["checkQuery"];
    executeQuery(driver, "SELECT 1", policy);
    expect(checkSpy).toHaveBeenCalledWith("SELECT 1");
  });

  it("test_query_denied_by_policy_returns_deny", () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    const policy = _autoPolicy();
    const checkSpy = vi
      .fn<(sql: string) => PolicyResult>()
      .mockReturnValue({
        decision: Decision.DENY,
        reason: "DDL not allowed",
      });
    policy.checkQuery = checkSpy as unknown as Policy["checkQuery"];
    const result = executeQuery(driver, "DROP TABLE users", policy);
    expect(result["status"]).toBe("denied");
    expect(result["reason"] as string).toContain("DDL");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("test_query_dml_returns_present_only", () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    const policy = _autoPolicy();
    const checkSpy = vi
      .fn<(sql: string) => PolicyResult>()
      .mockReturnValue({
        decision: Decision.PRESENT_ONLY,
        reason: "DML — display only",
        formatted_sql: "INSERT INTO t (a) VALUES (1)",
      });
    policy.checkQuery = checkSpy as unknown as Policy["checkQuery"];
    const result = executeQuery(
      driver,
      "INSERT INTO t (a) VALUES (1)",
      policy,
    );
    expect(result["status"]).toBe("present_only");
    expect(result["formatted_sql"]).toBe("INSERT INTO t (a) VALUES (1)");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("test_query_escalate_returns_escalate", () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    const policy = _autoPolicy();
    const checkSpy = vi
      .fn<(sql: string) => PolicyResult>()
      .mockReturnValue({
        decision: Decision.ESCALATE,
        reason: "needs approval",
      });
    policy.checkQuery = checkSpy as unknown as Policy["checkQuery"];
    const result = executeQuery(driver, "SELECT * FROM users", policy);
    expect(result["status"]).toBe("escalate");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("test_query_result_includes_execution_time", () => {
    const { driver } = _makeDriver({ rows: [], columns: [] });
    const result = executeQuery(driver, "SELECT 1", _autoPolicy());
    expect(result).toHaveProperty("execution_time_ms");
    expect(typeof result["execution_time_ms"]).toBe("number");
    expect(result["execution_time_ms"] as number).toBeGreaterThanOrEqual(0);
  });
});
