/**
 * Unit tests for MysqlDriver — pure mocks, no container required.
 *
 * Live-integration tests live in `live_mysql.test.ts` and are skipped
 * unless `TEST_LIVE_MYSQL` is set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type MockConn = {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
  };
  class MockPool {
    public readonly config: Record<string, unknown>;
    public readonly conns: MockConn[];
    public readonly endSpy: ReturnType<typeof vi.fn>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.conns = [];
      this.endSpy = vi.fn(() => Promise.resolve());
    }
    async getConnection(): Promise<MockConn> {
      const c: MockConn = {
        query: vi.fn(async () => [[], []]),
        execute: vi.fn(async () => [[], []]),
        release: vi.fn(),
        beginTransaction: vi.fn(async () => undefined),
        commit: vi.fn(async () => undefined),
        rollback: vi.fn(async () => undefined),
      };
      this.conns.push(c);
      return c;
    }
    async query(sql: string, params?: unknown[]): Promise<unknown> {
      // Not used by the driver under test; present for parity with mysql2.
      if (this.conns.length === 0) {
        await this.getConnection();
      }
      return this.conns[0]!.query(sql, params);
    }
    end(): Promise<void> {
      return this.endSpy();
    }
  }
  const instances: MockPool[] = [];
  return { MockPool, instances };
});

vi.mock("mysql2/promise", () => ({
  createPool: (config: Record<string, unknown>) => {
    const p = new mocks.MockPool(config);
    mocks.instances.push(p);
    return p;
  },
  default: {
    createPool: (config: Record<string, unknown>) => {
      const p = new mocks.MockPool(config);
      mocks.instances.push(p);
      return p;
    },
  },
}));

import { MysqlDriver } from "../mysql.js";

function latest(): InstanceType<typeof mocks.MockPool> {
  const p = mocks.instances[mocks.instances.length - 1];
  if (!p) throw new Error("no pool instantiated");
  return p;
}

function lastConn(): InstanceType<typeof mocks.MockPool>["conns"][number] {
  const pool = latest();
  const c = pool.conns[pool.conns.length - 1];
  if (!c) throw new Error("no conn checked out");
  return c;
}

describe("wiki_db.drivers.mysql (unit)", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connect builds a pool with the env config", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({
      host: "h",
      port: 3307,
      database: "app",
      user: "u",
      password: "p",
    });
    const pool = latest();
    expect(pool.config["host"]).toBe("h");
    expect(pool.config["port"]).toBe(3307);
    expect(pool.config["database"]).toBe("app");
    expect(handle.client).toBe(lastConn());
    expect(handle.database).toBe("app");
  });

  it("connect() reuses the pool across calls — one pool, many conns", async () => {
    const drv = new MysqlDriver();
    await drv.connect({ database: "app" });
    await drv.connect({ database: "app" });
    await drv.connect({ database: "app" });
    expect(mocks.instances).toHaveLength(1);
    expect(latest().conns).toHaveLength(3);
  });

  it("executeRead sync path returns SYNC_UNSUPPORTED", () => {
    const drv = new MysqlDriver();
    const r = drv.executeRead(null as unknown, "SELECT 1");
    expect(r.status).toBe("error");
    expect(r.error_code).toBe("SYNC_UNSUPPORTED");
  });

  it("executeReadAsync runs inside a READ ONLY session with truncation", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "app" });
    const conn = lastConn();
    conn.query.mockImplementation(async (sql: string) => {
      if (/SET SESSION/.test(sql)) return [[], []];
      return [
        [{ id: 1 }, { id: 2 }, { id: 3 }],
        [{ name: "id" }],
      ];
    });
    const res = await drv.executeReadAsync(handle, "SELECT id FROM t", null, 2);
    expect(res.status).toBe("success");
    expect(res.row_count).toBe(2);
    expect(res.truncated).toBe(true);
    expect(res.columns).toEqual(["id"]);
    const setSqls = conn.query.mock.calls
      .map((c) => String(c[0]))
      .filter((s: string) => /SET SESSION/.test(s));
    expect(setSqls.some((s: string) => /READ ONLY/.test(s))).toBe(true);
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
  });

  // G-LIMIT-WRAP: the LIMIT injector wraps the user query as a
  // subquery so bounded semantics hold regardless of where LIMIT
  // appears (or doesn't) in the original.
  describe("G-LIMIT-WRAP", () => {
    function userSqlOf(conn: {
      query: ReturnType<typeof vi.fn>;
    }): string {
      const calls = conn.query.mock.calls.map((c) => String(c[0]));
      const user = calls.find((s) => !/SET SESSION/.test(s));
      if (user === undefined)
        throw new Error(`no user query in: ${calls.join(" | ")}`);
      return user;
    }

    async function runWith(query: string, maxRows = 5): Promise<string> {
      const drv = new MysqlDriver();
      const handle = await drv.connect({ database: "app" });
      const conn = lastConn();
      conn.query.mockImplementation(async () => [[], []]);
      await drv.executeReadAsync(handle, query, null, maxRows);
      return userSqlOf(conn);
    }

    it("wraps a CTE without outer LIMIT", async () => {
      const sql = await runWith(
        "WITH t AS (SELECT 1 AS x LIMIT 10) SELECT * FROM t",
      );
      expect(sql).toMatch(/^SELECT \* FROM \(WITH t AS/);
      expect(sql).toMatch(/\) AS _limited LIMIT 6$/);
    });

    it("wraps a query with a trailing -- limit comment", async () => {
      const sql = await runWith("SELECT 1 -- limit me");
      expect(sql).toMatch(
        /^SELECT \* FROM \(SELECT 1 -- limit me\) AS _limited LIMIT 6$/,
      );
    });

    it("wraps a query that already has LIMIT — outer still bounds", async () => {
      const sql = await runWith("SELECT 1 LIMIT 10");
      expect(sql).toBe(
        "SELECT * FROM (SELECT 1 LIMIT 10) AS _limited LIMIT 6",
      );
    });

    it("strips a trailing semicolon before wrapping", async () => {
      const sql = await runWith("SELECT 1;");
      expect(sql).toBe("SELECT * FROM (SELECT 1) AS _limited LIMIT 6");
    });
  });

  it("executeReadAsync rolls back and surfaces SQL_ERROR on throw", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "app" });
    const conn = lastConn();
    conn.query.mockImplementation(async (sql: string) => {
      if (/SET SESSION/.test(sql)) return [[], []];
      throw new Error("kaboom");
    });
    const res = await drv.executeReadAsync(handle, "SELECT 1");
    expect(res.status).toBe("error");
    expect(res.error_code).toBe("SQL_ERROR");
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("getSchemaAsync returns tables + columns + PK flags", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "shop" });
    const conn = lastConn();
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return [[{ table_name: "orders" }], [{ name: "table_name" }]];
      }
      if (sql.includes("information_schema.columns")) {
        return [
          [
            {
              table_name: "orders",
              column_name: "id",
              data_type: "int",
              is_nullable: "NO",
              column_default: null,
              column_key: "PRI",
            },
            {
              table_name: "orders",
              column_name: "total",
              data_type: "decimal",
              is_nullable: "YES",
              column_default: null,
              column_key: "",
            },
          ],
          [],
        ];
      }
      return [[], []];
    });
    const tables = await drv.getSchemaAsync(handle);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("orders");
    expect(tables[0]!.columns[0]!.is_primary_key).toBe(true);
    expect(tables[0]!.columns[1]!.is_primary_key).toBe(false);
  });

  // G-SCHEMA-BATCH: for N tables we now issue exactly 2 queries (tables
  // list + one batched columns query) instead of N+1.
  it("getSchemaAsync: batched queries — 2 round-trips regardless of N", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "shop" });
    const conn = lastConn();
    conn.query.mockImplementation(async (sql: string) => {
      if (/SET SESSION/.test(sql)) return [[], []];
      if (sql.includes("information_schema.tables")) {
        return [
          [
            { table_name: "users" },
            { table_name: "posts" },
            { table_name: "comments" },
          ],
          [],
        ];
      }
      if (sql.includes("information_schema.columns")) {
        return [
          [
            { table_name: "users", column_name: "id", data_type: "int", is_nullable: "NO", column_default: null, column_key: "PRI" },
            { table_name: "posts", column_name: "id", data_type: "int", is_nullable: "NO", column_default: null, column_key: "PRI" },
            { table_name: "comments", column_name: "id", data_type: "int", is_nullable: "NO", column_default: null, column_key: "PRI" },
          ],
          [],
        ];
      }
      return [[], []];
    });
    const tables = await drv.getSchemaAsync(handle);
    expect(tables).toHaveLength(3);
    expect(tables.map((t) => t.name)).toEqual(["users", "posts", "comments"]);
    // Filter out any SET SESSION calls — they're bookkeeping, not schema.
    const schemaCalls = conn.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && !/SET SESSION/.test(c[0] as string),
    );
    expect(schemaCalls.length).toBe(2);
  });

  it("getSchemaAsync escapes _ and % wildcards in tableFilter", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "shop" });
    const conn = lastConn();
    conn.query.mockResolvedValue([[], []]);
    await drv.getSchemaAsync(handle, "", "user_data%");
    const tableQuery = conn.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("information_schema.tables"),
    );
    expect(tableQuery).toBeDefined();
    expect(tableQuery![0]).toContain("LIKE ? ESCAPE '!'");
    expect(tableQuery![1]).toEqual(["shop", "user!_data!%"]);
  });

  it("close() releases the client — pool stays open", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "app" });
    const conn = lastConn();
    await drv.closeAsync(handle);
    expect(conn.release).toHaveBeenCalled();
    expect(latest().endSpy).not.toHaveBeenCalled();
  });

  it("healthCheck returns true on successful SELECT 1", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "app" });
    const conn = lastConn();
    conn.query.mockImplementation(async () => [[{ one: 1 }], []]);
    expect(await drv.healthCheck(handle)).toBe(true);
  });

  it("healthCheck returns false when query rejects", async () => {
    const drv = new MysqlDriver();
    const handle = await drv.connect({ database: "app" });
    lastConn().query.mockImplementation(async () => {
      throw new Error("dead");
    });
    expect(await drv.healthCheck(handle)).toBe(false);
  });

  it("shutdown() drains the pool exactly once", async () => {
    const drv = new MysqlDriver();
    await drv.connect({ database: "app" });
    const pool = latest();
    await drv.shutdown();
    expect(pool.endSpy).toHaveBeenCalledTimes(1);
    await drv.shutdown();
    expect(pool.endSpy).toHaveBeenCalledTimes(1);
  });
});
