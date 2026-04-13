/**
 * Tests for connection.ts — the pool registry for wiki_db.
 *
 * We exercise the real SQLiteDriver (no mocks) via an in-memory database,
 * plus a stub driver registered through `registerDriverFactory` to verify
 * the factory-registry shape that Phase E drivers will plug into.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _hasPool,
  _openCount,
  clearDriverFactories,
  getConnection,
  healthCheck,
  listDriverFactories,
  registerDriverFactory,
  releaseConnection,
  shutdownAll,
} from "../connection.js";
import {
  clearEnvironments,
  registerEnvironment,
} from "../environments.js";
import {
  type ExecuteReadResult,
  DatabaseDriver,
  type Table,
} from "../drivers/base.js";
import { SQLiteDriver } from "../drivers/sqlite.js";

/**
 * Reinstate the default `sqlite` factory that connection.ts registers on
 * module load. Tests that call `clearDriverFactories()` must call this
 * helper afterwards so downstream cases still see the baseline.
 */
function restoreSqliteFactory(): void {
  registerDriverFactory("sqlite", () => new SQLiteDriver());
}

describe("wiki_db.connection", () => {
  beforeEach(async () => {
    await shutdownAll();
    clearEnvironments();
    clearDriverFactories();
    restoreSqliteFactory();
  });

  afterEach(async () => {
    await shutdownAll();
    clearEnvironments();
    clearDriverFactories();
    restoreSqliteFactory();
  });

  // -------------------------------------------------------------------
  // Factory registry
  // -------------------------------------------------------------------
  describe("factory registry", () => {
    it("pre-registers a sqlite factory", () => {
      expect(listDriverFactories()).toContain("sqlite");
    });

    it("lets callers register new factories", () => {
      registerDriverFactory("fake", () => new SQLiteDriver());
      expect(listDriverFactories()).toContain("fake");
    });

    it("clearDriverFactories wipes the registry", () => {
      clearDriverFactories();
      expect(listDriverFactories()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // getConnection + releaseConnection
  // -------------------------------------------------------------------
  describe("getConnection / releaseConnection", () => {
    it("opens a sqlite in-memory connection from a registered env", () => {
      registerEnvironment("test", {
        host: "localhost",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      const conn = getConnection("test");
      expect(conn.envName).toBe("test");
      expect(conn.driver).toBeInstanceOf(SQLiteDriver);
      expect(_hasPool("test")).toBe(true);
      expect(_openCount("test")).toBe(1);
      releaseConnection("test", conn);
      expect(_openCount("test")).toBe(0);
    });

    it("reuses the same pool entry across calls", () => {
      registerEnvironment("test", {
        host: "localhost",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      const a = getConnection("test");
      const b = getConnection("test");
      expect(_openCount("test")).toBe(2);
      // Same driver instance, different native handles.
      expect(a.driver).toBe(b.driver);
      expect(a.native).not.toBe(b.native);
      releaseConnection("test", a);
      releaseConnection("test", b);
    });

    it("supports multiple environments side-by-side", () => {
      registerEnvironment("dev", {
        host: "localhost",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      registerEnvironment("prod", {
        host: "localhost",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      const devConn = getConnection("dev");
      const prodConn = getConnection("prod");
      expect(_hasPool("dev")).toBe(true);
      expect(_hasPool("prod")).toBe(true);
      expect(devConn.driver).not.toBe(prodConn.driver);
      releaseConnection("dev", devConn);
      releaseConnection("prod", prodConn);
    });

    it("throws a clear error when the driver is not registered", () => {
      registerEnvironment("weird", {
        host: "h",
        port: 0,
        database: "d",
        driver: "does-not-exist",
      });
      expect(() => getConnection("weird")).toThrow(
        /no driver factory registered for 'does-not-exist'/,
      );
    });

    it("throws when the environment is unknown", () => {
      expect(() => getConnection("nope")).toThrow();
    });

    it("releaseConnection is a no-op for an unknown env", () => {
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      const conn = getConnection("test");
      // Call release against a bogus env — should not throw.
      expect(() =>
        releaseConnection("not-an-env", conn),
      ).not.toThrow();
      // Original pool still tracks the open handle.
      expect(_openCount("test")).toBe(1);
      releaseConnection("test", conn);
    });

    it("releaseConnection tolerates double-release", () => {
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      const conn = getConnection("test");
      releaseConnection("test", conn);
      expect(() => releaseConnection("test", conn)).not.toThrow();
      expect(_openCount("test")).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // healthCheck
  // -------------------------------------------------------------------
  describe("healthCheck", () => {
    it("returns true for a live sqlite env", async () => {
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      expect(await healthCheck("test")).toBe(true);
      // healthCheck must release the connection it opened.
      expect(_openCount("test")).toBe(0);
    });

    it("returns false when the driver's executeRead errors", async () => {
      // Swap the sqlite factory for one that always fails.
      clearDriverFactories();
      class FailingDriver extends DatabaseDriver {
        override connect(): unknown {
          return {};
        }
        override executeRead(): ExecuteReadResult {
          return {
            status: "error",
            error_code: "TEST",
            error: "boom",
            execution_time_ms: 0,
          };
        }
        override getSchema(): Table[] {
          return [];
        }
        override close(): void {}
      }
      registerDriverFactory("fail", () => new FailingDriver());
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: "d",
        driver: "fail",
      });
      expect(await healthCheck("test")).toBe(false);
    });

    it("returns false when getConnection throws", async () => {
      // No environment registered → getConnection throws → healthCheck
      // swallows and returns false.
      expect(await healthCheck("does-not-exist")).toBe(false);
    });

    it("prefers executeReadAsync when the driver provides it", async () => {
      clearDriverFactories();
      const asyncSpy = vi.fn(async () => ({
        status: "success" as const,
        execution_time_ms: 0,
      }));
      const syncSpy = vi.fn(
        (): ExecuteReadResult => ({
          status: "error",
          error_code: "SYNC_UNSUPPORTED",
          execution_time_ms: 0,
        }),
      );
      class AsyncyDriver extends DatabaseDriver {
        override connect(): unknown {
          return { native: "handle" };
        }
        override executeRead(): ExecuteReadResult {
          return syncSpy();
        }
        override getSchema(): Table[] {
          return [];
        }
        override close(): void {}
        executeReadAsync = asyncSpy;
      }
      registerDriverFactory("asyncy", () => new AsyncyDriver());
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: "d",
        driver: "asyncy",
      });
      expect(await healthCheck("test")).toBe(true);
      expect(asyncSpy).toHaveBeenCalledTimes(1);
      expect(syncSpy).not.toHaveBeenCalled();
    });

    it("reports false when executeReadAsync returns status=error", async () => {
      clearDriverFactories();
      class AsyncFailDriver extends DatabaseDriver {
        override connect(): unknown {
          return {};
        }
        override executeRead(): ExecuteReadResult {
          return { status: "success", execution_time_ms: 0 };
        }
        override getSchema(): Table[] {
          return [];
        }
        override close(): void {}
        async executeReadAsync(): Promise<{ status: "success" | "error" }> {
          return { status: "error" };
        }
      }
      registerDriverFactory("asyncfail", () => new AsyncFailDriver());
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: "d",
        driver: "asyncfail",
      });
      expect(await healthCheck("test")).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // shutdownAll
  // -------------------------------------------------------------------
  describe("shutdownAll", () => {
    it("closes every open connection and drops pools", async () => {
      registerEnvironment("a", {
        host: "h",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      registerEnvironment("b", {
        host: "h",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      getConnection("a");
      getConnection("a");
      getConnection("b");
      expect(_openCount("a")).toBe(2);
      expect(_openCount("b")).toBe(1);
      await shutdownAll();
      expect(_hasPool("a")).toBe(false);
      expect(_hasPool("b")).toBe(false);
    });

    it("survives driver close() throwing", async () => {
      clearDriverFactories();
      class ExplodingCloseDriver extends DatabaseDriver {
        override connect(): unknown {
          return { id: Math.random() };
        }
        override executeRead(): ExecuteReadResult {
          return { status: "success", execution_time_ms: 0, rows: [] };
        }
        override getSchema(): Table[] {
          return [];
        }
        override close(): void {
          throw new Error("explode");
        }
      }
      registerDriverFactory("boom", () => new ExplodingCloseDriver());
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: "d",
        driver: "boom",
      });
      getConnection("test");
      await expect(shutdownAll()).resolves.toBeUndefined();
      expect(_hasPool("test")).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // End-to-end with a real driver
  // -------------------------------------------------------------------
  describe("end-to-end sqlite", () => {
    it("opens, queries, and closes cleanly", () => {
      registerEnvironment("test", {
        host: "h",
        port: 0,
        database: ":memory:",
        driver: "sqlite",
      });
      const conn = getConnection("test");
      const result = conn.driver.executeRead(
        conn.native,
        "SELECT 1 AS one",
      );
      expect(result.status).toBe("success");
      expect(result.rows).toEqual([{ one: 1 }]);
      releaseConnection("test", conn);
    });
  });
});
