/**
 * Unit tests for SqlServerDriver — pure mocks, no MSSQL container required.
 *
 * Live integration in sibling `live_sqlserver.test.ts`, gated by TEST_LIVE_MSSQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type MockRequest = {
    query: ReturnType<typeof vi.fn>;
    input: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  function makeReq(): MockRequest {
    const r: MockRequest = {
      query: vi.fn(async () => ({
        recordset: [],
        recordsets: [[]],
        rowsAffected: [0],
      })),
      input: vi.fn(function (this: MockRequest) {
        return this;
      }),
      cancel: vi.fn(),
    };
    return r;
  }
  class MockTransaction {
    public readonly begin: ReturnType<typeof vi.fn>;
    public readonly commit: ReturnType<typeof vi.fn>;
    public readonly rollback: ReturnType<typeof vi.fn>;
    public readonly req: MockRequest;
    constructor() {
      this.begin = vi.fn(async () => undefined);
      this.commit = vi.fn(async () => undefined);
      this.rollback = vi.fn(async () => undefined);
      this.req = makeReq();
    }
    request(): MockRequest {
      return this.req;
    }
  }
  class MockPool {
    public readonly config: Record<string, unknown>;
    public readonly req: MockRequest;
    public readonly tx: MockTransaction;
    public readonly connectSpy: ReturnType<typeof vi.fn>;
    public readonly closeSpy: ReturnType<typeof vi.fn>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.req = makeReq();
      this.tx = new MockTransaction();
      this.connectSpy = vi.fn();
      this.closeSpy = vi.fn(() => Promise.resolve());
    }
    async connect(): Promise<this> {
      this.connectSpy();
      return this;
    }
    close(): Promise<void> {
      return this.closeSpy();
    }
    request(): MockRequest {
      return this.req;
    }
    transaction(): MockTransaction {
      return this.tx;
    }
  }
  const instances: MockPool[] = [];
  return { MockPool, instances };
});

vi.mock("mssql", () => ({
  ConnectionPool: class {
    constructor(config: Record<string, unknown>) {
      const p = new mocks.MockPool(config);
      mocks.instances.push(p);
      return p as unknown;
    }
  },
  default: {
    ConnectionPool: class {
      constructor(config: Record<string, unknown>) {
        const p = new mocks.MockPool(config);
        mocks.instances.push(p);
        return p as unknown;
      }
    },
  },
}));

import { SqlServerDriver } from "../sqlserver.js";

function latest(): InstanceType<typeof mocks.MockPool> {
  const p = mocks.instances[mocks.instances.length - 1];
  if (!p) throw new Error("no pool yet");
  return p;
}

describe("wiki_db.drivers.sqlserver (unit)", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connect passes named-instance + ssl options correctly", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({
      host: "db.example.com",
      port: 1433,
      database: "app",
      user: "sa",
      password: "hunter2",
      instance: "SQLEXPRESS",
      ssl: false,
    });
    const pool = latest();
    const opts = pool.config["options"] as Record<string, unknown>;
    expect(opts["instanceName"]).toBe("SQLEXPRESS");
    expect(opts["encrypt"]).toBe(false);
    expect(opts["trustServerCertificate"]).toBe(true);
    expect(handle.pool).toBe(pool);
    expect(pool.connectSpy).toHaveBeenCalled();
  });

  it("connect() reuses the same pool across calls", async () => {
    const drv = new SqlServerDriver();
    await drv.connect({ database: "app" });
    await drv.connect({ database: "app" });
    // One ConnectionPool instance; mssql multiplexes internally.
    expect(mocks.instances).toHaveLength(1);
    expect(latest().connectSpy).toHaveBeenCalledTimes(1);
  });

  it("connect wires NTLM authentication when trusted_connection=true", async () => {
    const drv = new SqlServerDriver();
    await drv.connect({
      host: "db",
      port: 1433,
      database: "app",
      trusted_connection: true,
      domain: "CORP",
      user: "svc",
      password: "x",
    });
    const pool = latest();
    const auth = pool.config["authentication"] as Record<string, unknown>;
    expect(auth["type"]).toBe("ntlm");
    const authOpts = auth["options"] as Record<string, unknown>;
    expect(authOpts["domain"]).toBe("CORP");
    expect(authOpts["userName"]).toBe("svc");
  });

  it("executeRead sync path returns SYNC_UNSUPPORTED", () => {
    const drv = new SqlServerDriver();
    const r = drv.executeRead(null as unknown, "SELECT 1");
    expect(r.status).toBe("error");
    expect(r.error_code).toBe("SYNC_UNSUPPORTED");
  });

  it("executeReadAsync returns rows and commits the tx", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({ database: "app" });
    const pool = latest();
    let callNo = 0;
    pool.tx.req.query.mockImplementation(async () => {
      callNo++;
      if (callNo === 1) {
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      }
      return {
        recordset: [
          { id: 1, name: "a" },
          { id: 2, name: "b" },
          { id: 3, name: "c" },
        ],
        recordsets: [[]],
        rowsAffected: [3],
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
    expect(pool.tx.begin).toHaveBeenCalled();
    expect(pool.tx.commit).toHaveBeenCalled();
  });

  it("executeReadAsync rolls back on SQL error", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({ database: "app" });
    const pool = latest();
    let callNo = 0;
    pool.tx.req.query.mockImplementation(async () => {
      callNo++;
      if (callNo === 1)
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      throw new Error("Invalid object");
    });
    const res = await drv.executeReadAsync(handle, "SELECT * FROM missing");
    expect(res.status).toBe("error");
    expect(res.error_code).toBe("SQL_ERROR");
    expect(pool.tx.rollback).toHaveBeenCalled();
  });

  it("executeReadAsync translates ? placeholders to @pN", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({ database: "app" });
    const pool = latest();
    let capturedSql = "";
    pool.tx.req.query.mockImplementation(async (sql: string) => {
      if (!/SET/i.test(sql)) capturedSql = sql;
      return { recordset: [], recordsets: [[]], rowsAffected: [0] };
    });
    await drv.executeReadAsync(handle, "SELECT * FROM t WHERE id = ?", [42]);
    expect(capturedSql).toContain("@p0");
    expect(capturedSql).not.toContain("?");
    expect(pool.tx.req.input).toHaveBeenCalledWith("p0", 42);
  });

  it("getSchemaAsync returns tables + column metadata", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({ database: "app" });
    const pool = latest();
    pool.req.query.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        return {
          recordset: [{ table_name: "products" }],
          recordsets: [[]],
          rowsAffected: [1],
        };
      }
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        return {
          recordset: [
            {
              column_name: "id",
              data_type: "int",
              is_nullable: "NO",
              column_default: null,
              is_pk: 1,
            },
            {
              column_name: "name",
              data_type: "nvarchar",
              is_nullable: "YES",
              column_default: null,
              is_pk: 0,
            },
          ],
          recordsets: [[]],
          rowsAffected: [2],
        };
      }
      return { recordset: [], recordsets: [[]], rowsAffected: [0] };
    });
    const tables = await drv.getSchemaAsync(handle, "dbo");
    expect(tables).toHaveLength(1);
    expect(tables[0]!.name).toBe("products");
    expect(tables[0]!.columns[0]!.is_primary_key).toBe(true);
  });

  it("close() is a no-op; pool stays open for other handles", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({ database: "app" });
    const pool = latest();
    await drv.closeAsync(handle);
    expect(pool.closeSpy).not.toHaveBeenCalled();
  });

  it("healthCheck runs SELECT 1 and returns true", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({ database: "app" });
    const pool = latest();
    pool.req.query.mockImplementation(async () => ({
      recordset: [{ one: 1 }],
      recordsets: [[]],
      rowsAffected: [1],
    }));
    expect(await drv.healthCheck(handle)).toBe(true);
  });

  it("healthCheck returns false when the request throws", async () => {
    const drv = new SqlServerDriver();
    const handle = await drv.connect({ database: "app" });
    latest().req.query.mockImplementation(async () => {
      throw new Error("dead");
    });
    expect(await drv.healthCheck(handle)).toBe(false);
  });

  it("shutdown() drains the pool exactly once", async () => {
    const drv = new SqlServerDriver();
    await drv.connect({ database: "app" });
    const pool = latest();
    await drv.shutdown();
    expect(pool.closeSpy).toHaveBeenCalledTimes(1);
    await drv.shutdown();
    expect(pool.closeSpy).toHaveBeenCalledTimes(1);
  });
});
