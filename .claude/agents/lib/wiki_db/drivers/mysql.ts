/**
 * drivers/mysql.ts — MySQL driver via `mysql2/promise`.
 *
 * Design:
 *  - The driver owns a `mysql2 Pool` lazily created on the first
 *    `connect()` call and cached for the lifetime of the driver
 *    instance. Each `connect()` checks out a connection from the pool
 *    (`pool.getConnection()`); `close()` releases it back.
 *  - `shutdown()` drains the pool. connection.ts calls `shutdown()` on
 *    each driver at process teardown.
 *  - Read-only: every `executeReadAsync` sets the session to
 *    `TRANSACTION READ ONLY` with a server-side `MAX_EXECUTION_TIME`.
 *  - `mysql2` is loaded via dynamic `import()`; a missing install throws
 *    a clear `npm install mysql2` hint.
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
// Minimal ambient types — avoid depending on @types (mysql2 ships its own).
// ---------------------------------------------------------------------------

interface MysqlFieldPacket {
  name: string;
  columnType?: number;
}
type MysqlQueryResult = [
  Record<string, unknown>[] | Record<string, unknown>,
  MysqlFieldPacket[] | undefined,
];
interface MysqlConnection {
  query(sql: string, params?: unknown[]): Promise<MysqlQueryResult>;
  execute(sql: string, params?: unknown[]): Promise<MysqlQueryResult>;
  release(): void;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
interface MysqlPool {
  getConnection(): Promise<MysqlConnection>;
  end(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<MysqlQueryResult>;
}
interface MysqlModule {
  createPool(config: Record<string, unknown>): MysqlPool;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface MysqlHandle {
  client: MysqlConnection;
  database: string;
}

export class MysqlDriver extends DatabaseDriver {
  private _mysqlModule: MysqlModule | null = null;
  private _pool: MysqlPool | null = null;
  private _poolPromise: Promise<MysqlPool> | null = null;
  private _database = "";

  private async _loadMysql(): Promise<MysqlModule> {
    if (this._mysqlModule !== null) return this._mysqlModule;
    try {
      const mod = (await import("mysql2/promise")) as unknown as
        | MysqlModule
        | { default: MysqlModule };
      this._mysqlModule =
        "createPool" in (mod as object)
          ? (mod as MysqlModule)
          : (mod as { default: MysqlModule }).default;
      return this._mysqlModule;
    } catch (e) {
      throw new Error(
        `Driver 'mysql' requires 'mysql2' — run: npm install mysql2 (${
          (e as Error).message
        })`,
      );
    }
  }

  private _ensurePool(envConfig: Record<string, unknown>): Promise<MysqlPool> {
    if (this._pool !== null) return Promise.resolve(this._pool);
    if (this._poolPromise !== null) return this._poolPromise;
    this._poolPromise = this._loadMysql().then((mysql) => {
      const host =
        typeof envConfig["host"] === "string" ? envConfig["host"] : "localhost";
      const port =
        typeof envConfig["port"] === "number" ? envConfig["port"] : 3306;
      this._database =
        typeof envConfig["database"] === "string" ? envConfig["database"] : "";
      const user =
        typeof envConfig["user"] === "string" ? envConfig["user"] : undefined;
      const password =
        typeof envConfig["password"] === "string"
          ? envConfig["password"]
          : undefined;
      const ssl =
        envConfig["ssl"] === true
          ? { rejectUnauthorized: false }
          : typeof envConfig["ssl"] === "object" && envConfig["ssl"] !== null
            ? (envConfig["ssl"] as Record<string, unknown>)
            : undefined;

      const poolConfig: Record<string, unknown> = {
        host,
        port,
        database: this._database,
        waitForConnections: true,
        connectionLimit:
          typeof envConfig["pool_max"] === "number"
            ? envConfig["pool_max"]
            : 10,
        supportBigNumbers: true,
      };
      if (user !== undefined) poolConfig["user"] = user;
      if (password !== undefined) poolConfig["password"] = password;
      if (ssl !== undefined) poolConfig["ssl"] = ssl;

      const pool = mysql.createPool(poolConfig);
      this._pool = pool;
      return pool;
    });
    return this._poolPromise;
  }

  override connect(envConfig: Record<string, unknown>): Promise<MysqlHandle> {
    return this._ensurePool(envConfig).then(async (pool) => {
      const client = await pool.getConnection();
      return { client, database: this._database } satisfies MysqlHandle;
    });
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
        "MysqlDriver.executeRead is async — call executeReadAsync() instead.",
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
    const handle = (await (conn as Promise<MysqlHandle> | MysqlHandle)) as MysqlHandle;
    const start = performance.now();
    try {
      await handle.client.query("SET SESSION TRANSACTION READ ONLY");
      await handle.client.query(
        `SET SESSION MAX_EXECUTION_TIME=${Math.max(1, timeoutMs)}`,
      );
      await handle.client.beginTransaction();

      const limited =
        /\blimit\b/i.test(query) === false
          ? `${query.trimEnd().replace(/;$/, "")} LIMIT ${maxRows + 1}`
          : query;

      const [rawRows, fields] = await handle.client.query(
        limited,
        params ?? [],
      );
      await handle.client.commit();

      const rowsArr = Array.isArray(rawRows)
        ? (rawRows as Record<string, unknown>[])
        : [];
      let truncated = false;
      let rows = rowsArr;
      if (rows.length > maxRows) {
        truncated = true;
        rows = rows.slice(0, maxRows);
      }

      return {
        status: "success",
        rows,
        row_count: rows.length,
        columns: (fields ?? []).map((f) => f.name),
        execution_time_ms: roundTo2(performance.now() - start),
        truncated,
      };
    } catch (e) {
      try {
        await handle.client.rollback();
      } catch {
        /* best-effort */
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
    const handle = (await (conn as Promise<MysqlHandle> | MysqlHandle)) as MysqlHandle;
    const ns = schemaName.length > 0 ? schemaName : handle.database;
    try {
      const tableParams: unknown[] = [ns];
      let tableSql =
        "SELECT table_name FROM information_schema.tables " +
        "WHERE table_schema = ? AND table_type = 'BASE TABLE'";
      if (tableFilter !== null && tableFilter !== undefined) {
        tableSql += " AND table_name LIKE ? ESCAPE '!'";
        tableParams.push(tableFilter.replace(/[!_%]/g, "!$&"));
      }
      tableSql += " ORDER BY table_name";

      const [tablesRaw] = await handle.client.query(tableSql, tableParams);
      const tablesRows = Array.isArray(tablesRaw)
        ? (tablesRaw as Record<string, unknown>[])
        : [];

      const out: Table[] = [];
      for (const row of tablesRows) {
        const tableName = String(row["table_name"] ?? row["TABLE_NAME"]);
        const [colsRaw] = await handle.client.query(
          "SELECT column_name, data_type, is_nullable, column_default, column_key " +
            "FROM information_schema.columns " +
            "WHERE table_schema = ? AND table_name = ? " +
            "ORDER BY ordinal_position",
          [ns, tableName],
        );
        const colsRows = Array.isArray(colsRaw)
          ? (colsRaw as Record<string, unknown>[])
          : [];
        const columns: Column[] = colsRows.map(
          (r) =>
            new Column({
              name: String(r["column_name"] ?? r["COLUMN_NAME"]),
              data_type: String(r["data_type"] ?? r["DATA_TYPE"]),
              nullable:
                String(r["is_nullable"] ?? r["IS_NULLABLE"]).toUpperCase() ===
                "YES",
              is_primary_key:
                String(r["column_key"] ?? r["COLUMN_KEY"]).toUpperCase() ===
                "PRI",
              default:
                (r["column_default"] ?? r["COLUMN_DEFAULT"]) === null ||
                (r["column_default"] ?? r["COLUMN_DEFAULT"]) === undefined
                  ? null
                  : String(r["column_default"] ?? r["COLUMN_DEFAULT"]),
            }),
        );
        out.push(new Table({ name: tableName, schema: ns, columns }));
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Release the checked-out client back to the pool. */
  override close(conn: unknown): void {
    Promise.resolve(conn as Promise<MysqlHandle> | MysqlHandle)
      .then((h) => h.client.release())
      .catch(() => {
        /* best-effort */
      });
  }

  override classifyOperation(query: string): OperationType {
    return classifySqlKeywords(query);
  }

  async closeAsync(conn: unknown): Promise<void> {
    const handle = (await (conn as Promise<MysqlHandle> | MysqlHandle)) as MysqlHandle;
    try {
      handle.client.release();
    } catch {
      /* best-effort */
    }
  }

  /** Per-driver health check. Runs `SELECT 1` on the handle. */
  async healthCheck(conn: unknown): Promise<boolean> {
    try {
      const handle = (await (conn as Promise<MysqlHandle> | MysqlHandle)) as MysqlHandle;
      const [rows] = await handle.client.query("SELECT 1");
      return Array.isArray(rows);
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
        await pool.end();
      } catch {
        /* best-effort */
      }
    }
  }
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
