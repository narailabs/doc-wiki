/**
 * Tests for query.ts — ported 1:1 from `test_query.py`, extended with
 * async-path coverage for Phase E drivers.
 *
 * All tests mock the driver so no real database is needed.
 */
import { describe, expect, it, vi } from "vitest";

import { Decision, Policy, type PolicyResult } from "../policy.js";
import { executeQuery, type QueryableDriver } from "../query.js";
import type { ExecuteReadResult } from "../drivers/base.js";

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

interface MakeAsyncDriverOptions {
  result?: ExecuteReadResult;
  error?: Error;
}

function _makeAsyncDriver(
  opts: MakeAsyncDriverOptions = {},
): {
  driver: QueryableDriver;
  asyncSpy: ReturnType<typeof vi.fn>;
  syncSpy: ReturnType<typeof vi.fn>;
} {
  const asyncSpy = vi.fn();
  if (opts.error) {
    asyncSpy.mockImplementation(() => Promise.reject(opts.error));
  } else {
    const result: ExecuteReadResult = opts.result ?? {
      status: "success",
      rows: [],
      columns: [],
      execution_time_ms: 0,
      truncated: false,
    };
    asyncSpy.mockResolvedValue(result);
  }
  // Also attach a sync spy to verify the async path is preferred when both
  // methods exist on the driver.
  const syncSpy = vi.fn().mockReturnValue({ rows: [], columns: [] });
  const driver: QueryableDriver = {
    execute: syncSpy as unknown as QueryableDriver["execute"],
    executeReadAsync:
      asyncSpy as unknown as QueryableDriver["executeReadAsync"],
  };
  return { driver, asyncSpy, syncSpy };
}

function _autoPolicy(): Policy {
  return new Policy("auto");
}

describe("TestExecuteQuery", () => {
  it("test_query_returns_structured_result", async () => {
    const { driver } = _makeDriver({
      rows: [{ id: 1, name: "Alice" }],
      columns: ["id", "name"],
    });
    const result = await executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    expect(result["status"]).toBe("ok");
    expect(result["rows"]).toEqual([{ id: 1, name: "Alice" }]);
    expect(result["columns"]).toEqual(["id", "name"]);
  });

  it("test_query_with_params", async () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    await executeQuery(
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

  it("test_query_max_rows_default", async () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    await executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    const call = executeSpy.mock.calls[0]!;
    const kwargs = call[1] as { max_rows?: number };
    expect(kwargs.max_rows).toBe(1000);
  });

  it("test_query_truncated_flag", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const { driver } = _makeDriver({ rows, columns: ["id"] });
    const result = await executeQuery(
      driver,
      "SELECT * FROM users WHERE id > 0",
      _autoPolicy(),
      { max_rows: 5 },
    );
    expect(result["truncated"]).toBe(true);
  });

  it("test_query_not_truncated", async () => {
    const rows = [{ id: 1 }];
    const { driver } = _makeDriver({ rows, columns: ["id"] });
    const result = await executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
      { max_rows: 100 },
    );
    expect(result["truncated"]).toBe(false);
  });

  it("test_query_error_returns_error_dict", async () => {
    const { driver } = _makeDriver({
      error: new Error("connection lost"),
    });
    const result = await executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    expect(result["status"]).toBe("error");
    expect(result["error"]).toContain("connection lost");
  });

  it("test_query_never_raises", async () => {
    const { driver } = _makeDriver({ error: new Error("kaboom") });
    const result = await executeQuery(
      driver,
      "SELECT * FROM users WHERE id = 1",
      _autoPolicy(),
    );
    expect(result["status"]).toBe("error");
  });

  it("test_query_checks_policy_first", async () => {
    const { driver } = _makeDriver({ rows: [], columns: [] });
    const policy = _autoPolicy();
    const checkSpy = vi
      .fn<(sql: string) => PolicyResult>()
      .mockReturnValue({ decision: Decision.ALLOW, reason: "ok" });
    policy.checkQuery = checkSpy as unknown as Policy["checkQuery"];
    await executeQuery(driver, "SELECT 1", policy);
    expect(checkSpy).toHaveBeenCalledWith("SELECT 1");
  });

  it("test_query_denied_by_policy_returns_deny", async () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    const policy = _autoPolicy();
    const checkSpy = vi
      .fn<(sql: string) => PolicyResult>()
      .mockReturnValue({
        decision: Decision.DENY,
        reason: "DDL not allowed",
      });
    policy.checkQuery = checkSpy as unknown as Policy["checkQuery"];
    const result = await executeQuery(driver, "DROP TABLE users", policy);
    expect(result["status"]).toBe("denied");
    expect(result["reason"] as string).toContain("DDL");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("test_query_dml_returns_present_only", async () => {
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
    const result = await executeQuery(
      driver,
      "INSERT INTO t (a) VALUES (1)",
      policy,
    );
    expect(result["status"]).toBe("present_only");
    expect(result["formatted_sql"]).toBe("INSERT INTO t (a) VALUES (1)");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("test_query_escalate_returns_escalate", async () => {
    const { driver, executeSpy } = _makeDriver({ rows: [], columns: [] });
    const policy = _autoPolicy();
    const checkSpy = vi
      .fn<(sql: string) => PolicyResult>()
      .mockReturnValue({
        decision: Decision.ESCALATE,
        reason: "needs approval",
      });
    policy.checkQuery = checkSpy as unknown as Policy["checkQuery"];
    const result = await executeQuery(driver, "SELECT * FROM users", policy);
    expect(result["status"]).toBe("escalate");
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("test_query_result_includes_execution_time", async () => {
    const { driver } = _makeDriver({ rows: [], columns: [] });
    const result = await executeQuery(driver, "SELECT 1", _autoPolicy());
    expect(result).toHaveProperty("execution_time_ms");
    expect(typeof result["execution_time_ms"]).toBe("number");
    expect(result["execution_time_ms"] as number).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Phase E async-driver path
// ---------------------------------------------------------------------------

describe("TestExecuteQueryAsyncPath", () => {
  it("prefers executeReadAsync over execute when both are present", async () => {
    const { driver, asyncSpy, syncSpy } = _makeAsyncDriver({
      result: {
        status: "success",
        rows: [{ id: 1 }],
        columns: ["id"],
        execution_time_ms: 0,
        truncated: false,
      },
    });
    const result = await executeQuery(
      driver,
      "SELECT id FROM t WHERE id = 1",
      _autoPolicy(),
    );
    expect(asyncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).not.toHaveBeenCalled();
    expect(result["status"]).toBe("ok");
    expect(result["rows"]).toEqual([{ id: 1 }]);
  });

  it("passes positional args (conn, sql, params, maxRows, timeoutMs) to async driver", async () => {
    const { driver, asyncSpy } = _makeAsyncDriver();
    const fakeConn = { marker: "conn-handle" };
    await executeQuery(driver, "SELECT 1", _autoPolicy(), {
      conn: fakeConn,
      params: [7, "abc"],
      max_rows: 250,
      timeout_ms: 4500,
    });
    expect(asyncSpy).toHaveBeenCalledTimes(1);
    const call = asyncSpy.mock.calls[0]!;
    expect(call[0]).toBe(fakeConn);
    expect(call[1]).toBe("SELECT 1");
    expect(call[2]).toEqual([7, "abc"]);
    expect(call[3]).toBe(250);
    expect(call[4]).toBe(4500);
  });

  it("maps executeReadAsync success result onto the public shape", async () => {
    const { driver } = _makeAsyncDriver({
      result: {
        status: "success",
        rows: [{ a: 1 }, { a: 2 }],
        columns: ["a"],
        row_count: 2,
        execution_time_ms: 1.5,
        truncated: true,
      },
    });
    const result = await executeQuery(driver, "SELECT 1", _autoPolicy());
    expect(result["status"]).toBe("ok");
    expect(result["rows"]).toEqual([{ a: 1 }, { a: 2 }]);
    expect(result["columns"]).toEqual(["a"]);
    expect(result["row_count"]).toBe(2);
    expect(result["truncated"]).toBe(true);
  });

  it("maps executeReadAsync error result to status=error with error_code", async () => {
    const { driver } = _makeAsyncDriver({
      result: {
        status: "error",
        error_code: "SQL_ERROR",
        error: "relation does not exist",
        execution_time_ms: 0,
      },
    });
    const result = await executeQuery(driver, "SELECT 1", _autoPolicy());
    expect(result["status"]).toBe("error");
    expect(result["error"] as string).toContain("SQL_ERROR");
    expect(result["error"] as string).toContain("relation does not exist");
  });

  it("catches thrown promises from executeReadAsync", async () => {
    const { driver } = _makeAsyncDriver({
      error: new Error("pool exhausted"),
    });
    const result = await executeQuery(driver, "SELECT 1", _autoPolicy());
    expect(result["status"]).toBe("error");
    expect(result["error"] as string).toContain("pool exhausted");
  });

  it("runs policy check before calling executeReadAsync", async () => {
    const { driver, asyncSpy } = _makeAsyncDriver();
    const policy = _autoPolicy();
    policy.checkQuery = (() => ({
      decision: Decision.DENY,
      reason: "blocked",
    })) as unknown as Policy["checkQuery"];
    const result = await executeQuery(driver, "DROP TABLE x", policy);
    expect(result["status"]).toBe("denied");
    expect(asyncSpy).not.toHaveBeenCalled();
  });

  it("throws error dict when neither execute nor executeReadAsync exists", async () => {
    const bareDriver: QueryableDriver = {};
    const result = await executeQuery(bareDriver, "SELECT 1", _autoPolicy());
    expect(result["status"]).toBe("error");
    expect(result["error"] as string).toContain("executeReadAsync");
  });
});
