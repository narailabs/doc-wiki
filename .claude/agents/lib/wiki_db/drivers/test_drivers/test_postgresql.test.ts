/**
 * Unit tests for PostgresDriver.
 *
 * Uses `vi.hoisted` to build the mock registry so the `vi.mock("pg")`
 * factory can read it at hoist time. Live integration tests live in
 * `live_postgresql.test.ts` and are gated by `TEST_LIVE_PG`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — accessible from the vi.mock factory.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  type MockClient = {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  class MockPool {
    public readonly config: Record<string, unknown>;
    public readonly clients: MockClient[];
    public readonly connectSpy: ReturnType<typeof vi.fn>;
    public readonly endSpy: ReturnType<typeof vi.fn>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.clients = [];
      this.connectSpy = vi.fn();
      this.endSpy = vi.fn(() => Promise.resolve());
    }
    async connect(): Promise<MockClient> {
      this.connectSpy();
      const client: MockClient = {
        query: vi.fn(async () => ({ rows: [], rowCount: 0, fields: [] })),
        release: vi.fn(),
      };
      this.clients.push(client);
      return client;
    }
    end(): Promise<void> {
      return this.endSpy();
    }
  }
  const instances: MockPool[] = [];
  return { MockPool, instances };
});

vi.mock("pg", () => ({
  Pool: class {
    constructor(config: Record<string, unknown>) {
      const p = new mocks.MockPool(config);
      mocks.instances.push(p);
      return p as unknown;
    }
  },
}));

import { PostgresDriver } from "../postgresql.js";

function latestPool(): InstanceType<typeof mocks.MockPool> {
  const p = mocks.instances[mocks.instances.length - 1];
  if (!p) throw new Error("no pool instantiated yet");
  return p;
}

function lastClient(): {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const pool = latestPool();
  const c = pool.clients[pool.clients.length - 1];
  if (!c) throw new Error("no client checked out");
  return c;
}

describe("wiki_db.drivers.postgresql (unit)", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connect() instantiates a pg.Pool with the env config", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({
      host: "db.example.com",
      port: 5433,
      database: "app",
      user: "svc",
      password: "secret",
      ssl: true,
      schema: "public",
    });
    const pool = latestPool();
    expect(pool.config["host"]).toBe("db.example.com");
    expect(pool.config["port"]).toBe(5433);
    expect(pool.config["database"]).toBe("app");
    expect(pool.config["user"]).toBe("svc");
    expect(pool.config["password"]).toBe("secret");
    expect(pool.config["ssl"]).toEqual({ rejectUnauthorized: false });
    expect(handle.schema).toBe("public");
    expect(handle.client).toBe(lastClient());
    expect(pool.connectSpy).toHaveBeenCalledTimes(1);
  });

  it("connect() reuses the pool across calls — one Pool, many clients", async () => {
    const drv = new PostgresDriver();
    await drv.connect({ database: "app" });
    await drv.connect({ database: "app" });
    await drv.connect({ database: "app" });
    // Only one Pool object is created; three clients are checked out.
    expect(mocks.instances).toHaveLength(1);
    expect(latestPool().clients).toHaveLength(3);
  });

  it("the sync executeRead signature returns SYNC_UNSUPPORTED", () => {
    const drv = new PostgresDriver();
    const result = drv.executeRead(null as unknown, "SELECT 1");
    expect(result.status).toBe("error");
    expect(result.error_code).toBe("SYNC_UNSUPPORTED");
  });

  it("executeReadAsync: happy path wraps rows/cols and reports truncation", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({ database: "app" });
    const client = lastClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SET ")) return { rows: [], rowCount: 0, fields: [] };
      if (sql === "BEGIN READ ONLY" || sql === "COMMIT")
        return { rows: [], rowCount: 0, fields: [] };
      return {
        rows: [
          { id: 1, name: "a" },
          { id: 2, name: "b" },
          { id: 3, name: "c" },
        ],
        rowCount: 3,
        fields: [{ name: "id" }, { name: "name" }],
      };
    });
    const res = await drv.executeReadAsync(
      handle,
      "SELECT id, name FROM t",
      null,
      2,
    );
    expect(res.status).toBe("success");
    expect(res.row_count).toBe(2);
    expect(res.truncated).toBe(true);
    expect(res.columns).toEqual(["id", "name"]);
    const callSqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(callSqls.some((s: string) => /BEGIN READ ONLY/.test(s))).toBe(true);
    expect(callSqls.some((s: string) => s === "COMMIT")).toBe(true);
  });

  it("executeReadAsync: surfaces a SQL_ERROR on driver failure", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({ database: "app" });
    const client = lastClient();
    client.query.mockImplementation(async (sql: string) => {
      if (
        sql.startsWith("SET ") ||
        sql === "BEGIN READ ONLY" ||
        sql === "ROLLBACK"
      )
        return { rows: [], rowCount: 0, fields: [] };
      throw new Error("relation does not exist");
    });
    const res = await drv.executeReadAsync(handle, "SELECT * FROM nope");
    expect(res.status).toBe("error");
    expect(res.error_code).toBe("SQL_ERROR");
    expect(res.error).toMatch(/relation does not exist/);
  });

  it("getSchemaAsync returns Table[] with columns + PK info", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({ database: "app", schema: "public" });
    const client = lastClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.tables"))
        return {
          rows: [{ table_name: "users" }],
          rowCount: 1,
          fields: [{ name: "table_name" }],
        };
      if (sql.includes("information_schema.columns"))
        return {
          rows: [
            {
              column_name: "id",
              data_type: "integer",
              is_nullable: "NO",
              column_default: null,
            },
            {
              column_name: "email",
              data_type: "text",
              is_nullable: "NO",
              column_default: null,
            },
          ],
          rowCount: 2,
          fields: [],
        };
      if (sql.includes("pg_index"))
        return {
          rows: [{ column_name: "id" }],
          rowCount: 1,
          fields: [],
        };
      return { rows: [], rowCount: 0, fields: [] };
    });
    const tables = await drv.getSchemaAsync(handle, "public");
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("users");
    expect(tables[0]!.columns.map((c) => c.name)).toEqual(["id", "email"]);
    expect(tables[0]!.columns[0]!.is_primary_key).toBe(true);
    expect(tables[0]!.columns[1]!.is_primary_key).toBe(false);
  });

  it("getSchemaAsync escapes _ and % wildcards in tableFilter", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({ database: "app", schema: "public" });
    const client = lastClient();
    client.query.mockResolvedValue({ rows: [], rowCount: 0, fields: [] });
    await drv.getSchemaAsync(handle, "public", "user_data%");
    const tableQuery = client.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("information_schema.tables"),
    );
    expect(tableQuery).toBeDefined();
    expect(tableQuery![0]).toContain("LIKE $2 ESCAPE '!'");
    expect(tableQuery![1]).toEqual(["public", "user!_data!%"]);
  });

  it("close() releases the client back to the pool — pool stays open", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({ database: "app" });
    const client = lastClient();
    await drv.closeAsync(handle);
    expect(client.release).toHaveBeenCalled();
    expect(latestPool().endSpy).not.toHaveBeenCalled();
  });

  it("healthCheck returns true when SELECT 1 succeeds", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({ database: "app" });
    const client = lastClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === "SELECT 1")
        return { rows: [{ "?column?": 1 }], rowCount: 1, fields: [] };
      return { rows: [], rowCount: 0, fields: [] };
    });
    expect(await drv.healthCheck(handle)).toBe(true);
  });

  it("healthCheck returns false when the query throws", async () => {
    const drv = new PostgresDriver();
    const handle = await drv.connect({ database: "app" });
    const client = lastClient();
    client.query.mockImplementation(async () => {
      throw new Error("dead");
    });
    expect(await drv.healthCheck(handle)).toBe(false);
  });

  it("shutdown() drains the pool exactly once", async () => {
    const drv = new PostgresDriver();
    await drv.connect({ database: "app" });
    const pool = latestPool();
    await drv.shutdown();
    expect(pool.endSpy).toHaveBeenCalledTimes(1);
    // Calling again after shutdown is a no-op (the pool ref is cleared).
    await drv.shutdown();
    expect(pool.endSpy).toHaveBeenCalledTimes(1);
  });
});
