/**
 * drivers/postgresql.ts — PostgreSQL driver via the `pg` package.
 *
 * Design:
 *  - The driver owns a `pg.Pool` lazily created on the first `connect()`
 *    call and cached for the lifetime of the driver instance. Each
 *    `connect()` call checks out a client from the pool; `close()`
 *    releases it back. The pool itself is destroyed by `shutdown()`,
 *    which connection.ts is expected to call at process teardown.
 *  - connection.ts calls `driver.connect(envConfig)` per
 *    `getConnection()` invocation, so the lazy-pool + per-call checkout
 *    gives us real pooling: N calls reuse M < N underlying sockets.
 *  - Read-only: every `executeReadAsync` runs inside a `BEGIN READ ONLY`
 *    transaction with a server-side `statement_timeout`.
 *  - The native `pg` module is loaded with a dynamic `import()` so this
 *    file compiles even when the package is not installed. On a missing
 *    install, `connect()` throws a helpful `npm install pg @types/pg` hint.
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
// Minimal ambient types — we do not depend on `@types/pg` to compile.
// ---------------------------------------------------------------------------

interface PgQueryResultField {
  name: string;
  dataTypeID?: number;
}
interface PgQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
  fields: PgQueryResultField[];
}
interface PgClient {
  query(text: string, params?: unknown[]): Promise<PgQueryResult>;
  release(err?: Error | boolean): void;
}
interface PgPool {
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}
interface PgModule {
  Pool: new (config: Record<string, unknown>) => PgPool;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Handle returned by {@link PostgresDriver.connect}. Carries the checked-out
 * client plus a reference back to the configured default schema. The
 * parent pool is held on the driver instance.
 */
interface PgHandle {
  client: PgClient;
  schema: string | null;
}

export class PostgresDriver extends DatabaseDriver {
  private _pgModule: PgModule | null = null;
  private _pool: PgPool | null = null;
  private _schema: string | null = null;
  private _poolPromise: Promise<PgPool> | null = null;

  private async _loadPg(): Promise<PgModule> {
    if (this._pgModule !== null) return this._pgModule;
    try {
      const mod = (await import("pg")) as unknown as
        | PgModule
        | { default: PgModule };
      this._pgModule =
        "Pool" in (mod as object)
          ? (mod as PgModule)
          : (mod as { default: PgModule }).default;
      return this._pgModule;
    } catch (e) {
      throw new Error(
        `Driver 'postgresql' requires 'pg' — run: npm install pg @types/pg (${
          (e as Error).message
        })`,
      );
    }
  }

  /**
   * Build the pool on first call; subsequent callers receive the cached
   * instance (or await the in-flight creation promise to avoid racing
   * two `new Pool()` calls on concurrent connects).
   */
  private _ensurePool(envConfig: Record<string, unknown>): Promise<PgPool> {
    if (this._pool !== null) return Promise.resolve(this._pool);
    if (this._poolPromise !== null) return this._poolPromise;
    this._poolPromise = this._loadPg().then((pg) => {
      const host =
        typeof envConfig["host"] === "string" ? envConfig["host"] : "localhost";
      const port =
        typeof envConfig["port"] === "number" ? envConfig["port"] : 5432;
      const database =
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
      this._schema =
        typeof envConfig["schema"] === "string" &&
        envConfig["schema"].length > 0
          ? envConfig["schema"]
          : null;

      const poolConfig: Record<string, unknown> = {
        host,
        port,
        database,
        max:
          typeof envConfig["pool_max"] === "number"
            ? envConfig["pool_max"]
            : 10,
        idleTimeoutMillis: 30_000,
      };
      if (user !== undefined) poolConfig["user"] = user;
      if (password !== undefined) poolConfig["password"] = password;
      if (ssl !== undefined) poolConfig["ssl"] = ssl;

      const pool = new pg.Pool(poolConfig);
      this._pool = pool;
      return pool;
    });
    return this._poolPromise;
  }

  /**
   * Check out a client from the pool. connection.ts tracks one handle per
   * `getConnection()` call; `close()` releases the client back to the pool.
   */
  override connect(envConfig: Record<string, unknown>): Promise<PgHandle> {
    return this._ensurePool(envConfig).then(async (pool) => {
      const client = await pool.connect();
      return { client, schema: this._schema } satisfies PgHandle;
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
        "PostgresDriver.executeRead is async — call executeReadAsync() instead.",
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
    const handle = (await (conn as Promise<PgHandle> | PgHandle)) as PgHandle;
    const start = performance.now();
    try {
      await handle.client.query(
        `SET statement_timeout = ${Math.max(1, timeoutMs)}`,
      );
      await handle.client.query("BEGIN READ ONLY");
      if (handle.schema !== null) {
        const safe = handle.schema.replace(/"/g, '""');
        await handle.client.query(`SET LOCAL search_path TO "${safe}"`);
      }

      // G-LIMIT-WRAP: wrap as a subquery so bounded semantics hold even
      // when the outer query has a trailing `-- limit` comment, a CTE
      // with its own LIMIT, a FOR UPDATE clause, or a LIMIT on an inner
      // SELECT that the old substring check mistook for the bound.
      const inner = query.trim().replace(/;\s*$/, "");
      const limited = `SELECT * FROM (${inner}) AS _limited LIMIT ${maxRows + 1}`;

      const result = await handle.client.query(limited, params ?? []);
      await handle.client.query("COMMIT");

      let truncated = false;
      let rows = result.rows;
      if (rows.length > maxRows) {
        truncated = true;
        rows = rows.slice(0, maxRows);
      }

      return {
        status: "success",
        rows,
        row_count: rows.length,
        columns: result.fields.map((f) => f.name),
        execution_time_ms: roundTo2(performance.now() - start),
        truncated,
      };
    } catch (e) {
      try {
        await handle.client.query("ROLLBACK");
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
    const handle = (await (conn as Promise<PgHandle> | PgHandle)) as PgHandle;
    const ns = schemaName.length > 0 ? schemaName : (handle.schema ?? "public");
    try {
      const tableParams: unknown[] = [ns];
      let tableSql =
        "SELECT table_name FROM information_schema.tables " +
        "WHERE table_schema = $1 AND table_type = 'BASE TABLE'";
      if (tableFilter !== null && tableFilter !== undefined) {
        tableSql += " AND table_name LIKE $2 ESCAPE '!'";
        tableParams.push(tableFilter.replace(/[!_%]/g, "!$&"));
      }
      tableSql += " ORDER BY table_name";

      const tablesResult = await handle.client.query(tableSql, tableParams);

      const tableNames: string[] = tablesResult.rows.map((r) =>
        String(r["table_name"]),
      );
      if (tableNames.length === 0) return [];

      // G-SCHEMA-BATCH: fold per-table queries into two set-based queries
      // using PostgreSQL's `= ANY($N::text[])`. For N tables we drop from
      // 2N+1 round-trips (tables + N columns + N PKs) to 3.
      const colsResult = await handle.client.query(
        "SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position " +
          "FROM information_schema.columns " +
          "WHERE table_schema = $1 AND table_name = ANY($2::text[]) " +
          "ORDER BY table_name, ordinal_position",
        [ns, tableNames],
      );
      const pkResult = await handle.client.query(
        "SELECT c.relname AS table_name, a.attname AS column_name " +
          "FROM pg_index i " +
          "JOIN pg_class c ON c.oid = i.indrelid " +
          "JOIN pg_namespace nsp ON nsp.oid = c.relnamespace " +
          "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) " +
          "WHERE nsp.nspname = $1 AND c.relname = ANY($2::text[]) AND i.indisprimary",
        [ns, tableNames],
      );

      const pksByTable = new Map<string, Set<string>>();
      for (const r of pkResult.rows) {
        const t = String(r["table_name"]);
        let set = pksByTable.get(t);
        if (set === undefined) {
          set = new Set();
          pksByTable.set(t, set);
        }
        set.add(String(r["column_name"]));
      }

      const colsByTable = new Map<string, Column[]>();
      for (const r of colsResult.rows) {
        const t = String(r["table_name"]);
        let list = colsByTable.get(t);
        if (list === undefined) {
          list = [];
          colsByTable.set(t, list);
        }
        const name = String(r["column_name"]);
        list.push(
          new Column({
            name,
            data_type: String(r["data_type"]),
            nullable: String(r["is_nullable"]).toUpperCase() === "YES",
            is_primary_key: pksByTable.get(t)?.has(name) ?? false,
            default:
              r["column_default"] === null
                ? null
                : String(r["column_default"]),
          }),
        );
      }

      const out: Table[] = [];
      for (const tableName of tableNames) {
        out.push(
          new Table({
            name: tableName,
            schema: ns,
            columns: colsByTable.get(tableName) ?? [],
          }),
        );
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Release the checked-out client back to the pool. Does NOT destroy
   * the pool — use {@link shutdown} for that.
   */
  override close(conn: unknown): void {
    Promise.resolve(conn as Promise<PgHandle> | PgHandle)
      .then((h) => h.client.release())
      .catch((e: unknown) => {
        // G-CLOSE-LOG: surface release errors on stderr instead of
        // swallowing them. close() is called from sync cleanup paths
        // so we cannot await; keep it fire-and-forget but at least
        // give an operator something to grep for in a misbehaving run.
        process.stderr.write(
          `[postgresql] release error (best-effort): ${
            e instanceof Error ? e.message : String(e)
          }\n`,
        );
      });
  }

  override classifyOperation(query: string): OperationType {
    return classifySqlKeywords(query);
  }

  async closeAsync(conn: unknown): Promise<void> {
    const handle = (await (conn as Promise<PgHandle> | PgHandle)) as PgHandle;
    try {
      handle.client.release();
    } catch {
      /* best-effort */
    }
  }

  /**
   * Per-driver health check. Runs `SELECT 1` on the given handle. Caller
   * still owns the handle and is responsible for {@link close}-ing it.
   */
  async healthCheck(conn: unknown): Promise<boolean> {
    try {
      const handle = (await (conn as Promise<PgHandle> | PgHandle)) as PgHandle;
      const r = await handle.client.query("SELECT 1");
      return r.rowCount !== null && r.rowCount >= 0;
    } catch {
      return false;
    }
  }

  /**
   * Drain and destroy the pool. connection.ts's `shutdownAll()` fans out
   * to each driver instance; this is where we actually close sockets.
   */
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
