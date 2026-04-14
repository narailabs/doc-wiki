/**
 * drivers/sqlserver.ts — Microsoft SQL Server driver via `mssql`.
 *
 * Design:
 *  - The driver owns an `mssql.ConnectionPool` lazily created on the
 *    first `connect()` call and cached for the lifetime of the driver
 *    instance. `mssql` multiplexes requests onto the pool automatically
 *    via `pool.request()` / `pool.transaction()`; there are no per-call
 *    "checkout / release" semantics to expose. `connect()` returns a
 *    lightweight handle carrying a reference to the pool, and `close()`
 *    is a no-op (the pool is shared). `shutdown()` drains the pool.
 *  - Named instances + Windows (NTLM) authentication are supported via
 *    `envConfig.instance` / `envConfig.trusted_connection`.
 *  - Read-only: every `executeReadAsync` opens an explicit transaction,
 *    sets `READ COMMITTED` isolation + `LOCK_TIMEOUT`, runs the SELECT,
 *    and `COMMIT`s. A parser in the driver also rewrites `?` placeholders
 *    to `@pN` and clamps results via `SELECT TOP N+1`.
 *  - `mssql` is loaded via dynamic `import()`; a missing install throws
 *    a clear `npm install mssql` hint.
 */
import { performance } from "node:perf_hooks";
import {
  Column,
  DatabaseDriver,
  Table,
  type ExecuteReadResult,
} from "./base.js";
import { classifySqlKeywords, type OperationType } from "../policy.js";

// ---------------------------------------------------------------------------
// Minimal ambient types
// ---------------------------------------------------------------------------

interface MssqlRequest {
  query<T = Record<string, unknown>>(sql: string): Promise<{
    recordset: T[];
    recordsets: T[][];
    rowsAffected: number[];
  }>;
  input(name: string, value: unknown): MssqlRequest;
  cancel(): void;
}
interface MssqlTransaction {
  begin(isolationLevel?: number): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  request(): MssqlRequest;
}
interface MssqlPool {
  connect(): Promise<MssqlPool>;
  close(): Promise<void>;
  request(): MssqlRequest;
  transaction(): MssqlTransaction;
}
interface MssqlModule {
  ConnectionPool: new (config: Record<string, unknown>) => MssqlPool;
  ISOLATION_LEVEL?: { READ_COMMITTED: number };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Handle returned by {@link SqlServerDriver.connect}. Holds the shared
 * pool reference — there is no per-call "checkout" with mssql, so `close`
 * is a no-op and the pool is destroyed once via {@link shutdown}.
 */
interface MssqlHandle {
  pool: MssqlPool;
  database: string;
}

export class SqlServerDriver extends DatabaseDriver {
  private _mssqlModule: MssqlModule | null = null;
  private _pool: MssqlPool | null = null;
  private _poolPromise: Promise<MssqlPool> | null = null;
  private _database = "";

  private async _loadMssql(): Promise<MssqlModule> {
    if (this._mssqlModule !== null) return this._mssqlModule;
    try {
      const mod = (await import("mssql")) as unknown as
        | MssqlModule
        | { default: MssqlModule };
      this._mssqlModule =
        "ConnectionPool" in (mod as object)
          ? (mod as MssqlModule)
          : (mod as { default: MssqlModule }).default;
      return this._mssqlModule;
    } catch (e) {
      throw new Error(
        `Driver 'sqlserver' requires 'mssql' — run: npm install mssql (${
          (e as Error).message
        })`,
      );
    }
  }

  private _ensurePool(envConfig: Record<string, unknown>): Promise<MssqlPool> {
    if (this._pool !== null) return Promise.resolve(this._pool);
    if (this._poolPromise !== null) return this._poolPromise;
    this._poolPromise = this._loadMssql().then(async (mssql) => {
      const server =
        typeof envConfig["host"] === "string" ? envConfig["host"] : "localhost";
      const port =
        typeof envConfig["port"] === "number" ? envConfig["port"] : 1433;
      this._database =
        typeof envConfig["database"] === "string" ? envConfig["database"] : "";
      const user =
        typeof envConfig["user"] === "string" ? envConfig["user"] : undefined;
      const password =
        typeof envConfig["password"] === "string"
          ? envConfig["password"]
          : undefined;
      const instanceName =
        typeof envConfig["instance"] === "string"
          ? envConfig["instance"]
          : undefined;
      const domain =
        typeof envConfig["domain"] === "string" ? envConfig["domain"] : undefined;
      const trustedConnection = envConfig["trusted_connection"] === true;
      const encrypt = envConfig["ssl"] === true;

      const options: Record<string, unknown> = {
        encrypt,
        trustServerCertificate: encrypt === false,
      };
      if (instanceName !== undefined) options["instanceName"] = instanceName;

      const poolConfig: Record<string, unknown> = {
        server,
        port,
        database: this._database,
        options,
        pool: {
          max:
            typeof envConfig["pool_max"] === "number"
              ? envConfig["pool_max"]
              : 10,
          min: 0,
          idleTimeoutMillis: 30_000,
        },
      };
      if (user !== undefined) poolConfig["user"] = user;
      if (password !== undefined) poolConfig["password"] = password;
      if (domain !== undefined) poolConfig["domain"] = domain;
      if (trustedConnection) {
        poolConfig["authentication"] = {
          type: "ntlm",
          options: {
            domain: domain ?? "",
            userName: user ?? "",
            password: password ?? "",
          },
        };
      }

      const pool = new mssql.ConnectionPool(poolConfig);
      await pool.connect();
      this._pool = pool;
      return pool;
    });
    return this._poolPromise;
  }

  override connect(envConfig: Record<string, unknown>): Promise<MssqlHandle> {
    return this._ensurePool(envConfig).then(
      (pool) => ({ pool, database: this._database }) satisfies MssqlHandle,
    );
  }

  override executeRead(
    _conn: unknown,
    _query: string,
    _params: unknown[] | null = null,
    _maxRows: number = 1000,
    _timeoutMs: number = 30_000,
  ): ExecuteReadResult {
    return {
      status: "error",
      error_code: "SYNC_UNSUPPORTED",
      error:
        "SqlServerDriver.executeRead is async — call executeReadAsync() instead.",
      execution_time_ms: 0,
    };
  }

  async executeReadAsync(
    conn: unknown,
    query: string,
    params: unknown[] | null = null,
    maxRows: number = 1000,
    timeoutMs: number = 30_000,
  ): Promise<ExecuteReadResult> {
    const handle = (await (conn as Promise<MssqlHandle> | MssqlHandle)) as MssqlHandle;
    const start = performance.now();
    const tx = handle.pool.transaction();
    let inTx = false;
    try {
      await tx.begin();
      inTx = true;

      const guardReq = tx.request();
      await guardReq.query(
        `SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET LOCK_TIMEOUT ${Math.max(1, timeoutMs)};`,
      );

      const req = tx.request();
      for (let i = 0; i < (params ?? []).length; i++) {
        req.input(`p${i}`, (params ?? [])[i]);
      }
      let rewritten = query;
      if (params !== null && params !== undefined && params.length > 0) {
        let n = 0;
        rewritten = query.replace(/\?/g, () => `@p${n++}`);
      }
      const limited = /\btop\s+\d/i.test(rewritten)
        ? rewritten
        : rewritten.replace(/^\s*select\s/i, `SELECT TOP ${maxRows + 1} `);

      const result = await req.query(limited);
      await tx.commit();
      inTx = false;

      let truncated = false;
      let rows = result.recordset ?? [];
      if (rows.length > maxRows) {
        truncated = true;
        rows = rows.slice(0, maxRows);
      }

      const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
      return {
        status: "success",
        rows: rows as Record<string, unknown>[],
        row_count: rows.length,
        columns,
        execution_time_ms: roundTo2(performance.now() - start),
        truncated,
      };
    } catch (e) {
      if (inTx) {
        try {
          await tx.rollback();
        } catch {
          /* best-effort */
        }
      }
      return {
        status: "error",
        error_code: "SQL_ERROR",
        error: (e as Error).message,
        execution_time_ms: roundTo2(performance.now() - start),
      };
    }
  }

  override getSchema(
    _conn: unknown,
    _schemaName: string = "",
    _tableFilter: string | null = null,
  ): Table[] {
    return [];
  }

  async getSchemaAsync(
    conn: unknown,
    schemaName: string = "",
    tableFilter: string | null = null,
  ): Promise<Table[]> {
    const handle = (await (conn as Promise<MssqlHandle> | MssqlHandle)) as MssqlHandle;
    const ns = schemaName.length > 0 ? schemaName : "dbo";
    try {
      const req = handle.pool.request();
      req.input("schema", ns);
      if (tableFilter !== null && tableFilter !== undefined) {
        req.input("filter", tableFilter);
      }

      const tableSql =
        "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES " +
        "WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE'" +
        (tableFilter !== null ? " AND TABLE_NAME LIKE @filter" : "") +
        " ORDER BY TABLE_NAME";

      const tableRes = await req.query(tableSql);
      const tables = tableRes.recordset ?? [];

      const out: Table[] = [];
      for (const row of tables) {
        const tableName = String(
          (row as Record<string, unknown>)["table_name"] ??
            (row as Record<string, unknown>)["TABLE_NAME"],
        );
        const colReq = handle.pool.request();
        colReq.input("schema", ns);
        colReq.input("table", tableName);
        const colRes = await colReq.query(
          "SELECT c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type, " +
            "c.IS_NULLABLE AS is_nullable, c.COLUMN_DEFAULT AS column_default, " +
            "CASE WHEN tc.CONSTRAINT_TYPE = 'PRIMARY KEY' THEN 1 ELSE 0 END AS is_pk " +
            "FROM INFORMATION_SCHEMA.COLUMNS c " +
            "LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu " +
            "  ON c.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND c.TABLE_NAME = kcu.TABLE_NAME " +
            "  AND c.COLUMN_NAME = kcu.COLUMN_NAME " +
            "LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc " +
            "  ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME " +
            "  AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA " +
            "WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table " +
            "ORDER BY c.ORDINAL_POSITION",
        );
        const columns: Column[] = (colRes.recordset ?? []).map((r) => {
          const rec = r as Record<string, unknown>;
          return new Column({
            name: String(rec["column_name"]),
            data_type: String(rec["data_type"]),
            nullable: String(rec["is_nullable"]).toUpperCase() === "YES",
            is_primary_key: Number(rec["is_pk"] ?? 0) === 1,
            default:
              rec["column_default"] === null || rec["column_default"] === undefined
                ? null
                : String(rec["column_default"]),
          });
        });
        out.push(new Table({ name: tableName, schema: ns, columns }));
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * No-op: the mssql pool multiplexes requests internally, there is no
   * per-call client to release. {@link shutdown} destroys the pool.
   */
  override close(_conn: unknown): void {
    /* pool is shared — nothing to release per-handle */
  }

  override classifyOperation(query: string): OperationType {
    return classifySqlKeywords(query);
  }

  async closeAsync(_conn: unknown): Promise<void> {
    /* pool is shared — nothing to release per-handle */
  }

  /** Per-driver health check via `SELECT 1` on a fresh request. */
  async healthCheck(conn: unknown): Promise<boolean> {
    try {
      const handle = (await (conn as Promise<MssqlHandle> | MssqlHandle)) as MssqlHandle;
      const res = await handle.pool.request().query("SELECT 1 AS one");
      return (res.recordset ?? []).length === 1;
    } catch {
      return false;
    }
  }

  /** Drain and destroy the pool. */
  async shutdown(): Promise<void> {
    const pool = this._pool;
    this._pool = null;
    this._poolPromise = null;
    if (pool !== null) {
      try {
        await pool.close();
      } catch {
        /* best-effort */
      }
    }
  }
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
