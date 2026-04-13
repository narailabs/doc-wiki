/**
 * Tests for schema.ts — ported 1:1 from `test_schema.py`, extended with
 * async-path coverage for Phase E drivers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SQLiteDriver } from "../drivers/sqlite.js";
import { SchemaManager } from "../schema.js";
import {
  Column,
  Table,
  type DatabaseDriver,
  type ExecuteReadResult,
} from "../drivers/base.js";

describe("wiki_db.schema", () => {
  let driver: SQLiteDriver;
  let conn: unknown;

  beforeEach(() => {
    driver = new SQLiteDriver();
    const c = driver.connect({ database: ":memory:" });
    c.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    c.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER)");
    conn = c;
  });
  afterEach(() => {
    if (conn) driver.close(conn);
  });

  function schemaMgr(d: DatabaseDriver = driver): SchemaManager {
    return new SchemaManager(d, 300.0);
  }

  // --- TestGetSchema ---
  describe("TestGetSchema", () => {
    it("test_returns_tables", async () => {
      const tables = await schemaMgr().getSchema(conn, "dev");
      const names = tables.map((t) => t.name);
      expect(names).toContain("users");
      expect(names).toContain("orders");
    });

    it("test_includes_columns", async () => {
      const tables = await schemaMgr().getSchema(conn, "dev");
      const users = tables.filter((t) => t.name === "users")[0];
      expect(users).toBeDefined();
      const colNames = users!.columns.map((c) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("name");
    });

    it("test_with_filter", async () => {
      const tables = await schemaMgr().getSchema(conn, "dev", "", "user%");
      const names = tables.map((t) => t.name);
      expect(names).toContain("users");
      expect(names).not.toContain("orders");
    });
  });

  // --- TestCache ---
  describe("TestCache", () => {
    /** Wrap the real driver in a Vitest spy so we can count getSchema calls. */
    function spyDriver(base: DatabaseDriver): {
      driver: DatabaseDriver;
      getSchemaSpy: ReturnType<typeof vi.fn>;
    } {
      const getSchemaSpy = vi.fn((
        c: unknown,
        s?: string,
        f?: string | null,
      ) => base.getSchema(c, s, f ?? null));
      const wrapped: DatabaseDriver = {
        connect: (cfg) => base.connect(cfg),
        executeRead: (c, q, p, m, t) => base.executeRead(c, q, p, m, t),
        getSchema: getSchemaSpy as unknown as DatabaseDriver["getSchema"],
        close: (c) => base.close(c),
        execute_read: (c, q, p, m, t) =>
          base.executeRead(c, q, p ?? null, m, t),
        get_schema: (c, s, f) => base.getSchema(c, s, f ?? null),
      } as DatabaseDriver;
      return { driver: wrapped, getSchemaSpy };
    }

    it("test_cache_hit", async () => {
      const { driver: mock, getSchemaSpy } = spyDriver(driver);
      const mgr = new SchemaManager(mock, 300.0);
      await mgr.getSchema(conn, "dev");
      await mgr.getSchema(conn, "dev"); // should hit cache
      expect(getSchemaSpy).toHaveBeenCalledTimes(1);
    });

    it("test_cache_miss_after_ttl", async () => {
      const { driver: mock, getSchemaSpy } = spyDriver(driver);
      const mgr = new SchemaManager(mock, 0.01); // 10ms TTL
      await mgr.getSchema(conn, "dev");
      await new Promise((r) => setTimeout(r, 20)); // wait for TTL to expire
      await mgr.getSchema(conn, "dev");
      expect(getSchemaSpy).toHaveBeenCalledTimes(2);
    });

    it("test_clear_cache", async () => {
      const { driver: mock, getSchemaSpy } = spyDriver(driver);
      const mgr = new SchemaManager(mock, 300.0);
      await mgr.getSchema(conn, "dev");
      mgr.clearCache();
      await mgr.getSchema(conn, "dev");
      expect(getSchemaSpy).toHaveBeenCalledTimes(2);
    });

    it("test_cache_key_per_env", async () => {
      const { driver: mock, getSchemaSpy } = spyDriver(driver);
      const mgr = new SchemaManager(mock, 300.0);
      await mgr.getSchema(conn, "dev");
      await mgr.getSchema(conn, "qa"); // different env = different cache key
      expect(getSchemaSpy).toHaveBeenCalledTimes(2);
    });

    it("test_error_handling", async () => {
      const errorDriver: DatabaseDriver = {
        connect: () => null,
        executeRead: () => ({ status: "success", execution_time_ms: 0 }),
        getSchema: (): Table[] => {
          throw new Error("connection failed");
        },
        close: () => {},
        execute_read: () => ({ status: "success", execution_time_ms: 0 }),
        get_schema: (): Table[] => {
          throw new Error("connection failed");
        },
      } as DatabaseDriver;
      const mgr = new SchemaManager(errorDriver);
      const result = await mgr.getSchema(null, "dev");
      expect(result).toEqual([]); // returns empty, doesn't raise
    });
  });

  // --- Async-path (Phase E drivers) ---
  describe("TestAsyncPath", () => {
    /** Driver with both sync and async getSchema — async should win. */
    function asyncPathDriver(): {
      driver: DatabaseDriver;
      asyncSpy: ReturnType<typeof vi.fn>;
      syncSpy: ReturnType<typeof vi.fn>;
    } {
      const stubTable = new Table({
        name: "widgets",
        schema: "public",
        columns: [
          new Column({ name: "id", data_type: "int", is_primary_key: true }),
        ],
      });
      const asyncSpy = vi.fn(async () => [stubTable]);
      const syncSpy = vi.fn((): Table[] => []);
      const wrapped: DatabaseDriver & {
        getSchemaAsync: (
          c: unknown,
          s?: string,
          f?: string | null,
        ) => Promise<Table[]>;
      } = {
        connect: () => null,
        executeRead: (): ExecuteReadResult => ({
          status: "success",
          execution_time_ms: 0,
        }),
        getSchema: syncSpy as unknown as DatabaseDriver["getSchema"],
        close: () => {},
        execute_read: (): ExecuteReadResult => ({
          status: "success",
          execution_time_ms: 0,
        }),
        get_schema: (): Table[] => [],
        getSchemaAsync: asyncSpy as unknown as (
          c: unknown,
          s?: string,
          f?: string | null,
        ) => Promise<Table[]>,
      };
      return { driver: wrapped, asyncSpy, syncSpy };
    }

    it("prefers getSchemaAsync over getSchema when both are present", async () => {
      const { driver: mock, asyncSpy, syncSpy } = asyncPathDriver();
      const mgr = new SchemaManager(mock, 300.0);
      const tables = await mgr.getSchema(null, "dev", "public");
      expect(asyncSpy).toHaveBeenCalledTimes(1);
      expect(syncSpy).not.toHaveBeenCalled();
      expect(tables.map((t) => t.name)).toEqual(["widgets"]);
    });

    it("passes schemaName and tableFilter through to getSchemaAsync", async () => {
      const { driver: mock, asyncSpy } = asyncPathDriver();
      const mgr = new SchemaManager(mock, 300.0);
      await mgr.getSchema(null, "dev", "reporting", "fact_%");
      expect(asyncSpy).toHaveBeenCalledWith(null, "reporting", "fact_%");
    });

    it("caches the async-path result alongside the sync path", async () => {
      const { driver: mock, asyncSpy } = asyncPathDriver();
      const mgr = new SchemaManager(mock, 300.0);
      await mgr.getSchema(null, "dev");
      await mgr.getSchema(null, "dev"); // cache hit → no second call
      expect(asyncSpy).toHaveBeenCalledTimes(1);
    });

    it("returns [] when getSchemaAsync rejects", async () => {
      const asyncSpy = vi.fn(async () => {
        throw new Error("driver blew up");
      });
      const driverLike: DatabaseDriver & {
        getSchemaAsync: () => Promise<Table[]>;
      } = {
        connect: () => null,
        executeRead: (): ExecuteReadResult => ({
          status: "success",
          execution_time_ms: 0,
        }),
        getSchema: (): Table[] => {
          throw new Error("sync also broken");
        },
        close: () => {},
        execute_read: (): ExecuteReadResult => ({
          status: "success",
          execution_time_ms: 0,
        }),
        get_schema: (): Table[] => [],
        getSchemaAsync: asyncSpy as unknown as () => Promise<Table[]>,
      };
      const mgr = new SchemaManager(driverLike);
      const result = await mgr.getSchema(null, "dev");
      expect(result).toEqual([]);
    });
  });
});
