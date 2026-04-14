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
import { Column, DatabaseDriver, Table, } from "./base.js";
import { classifySqlKeywords } from "../policy.js";
export class PostgresDriver extends DatabaseDriver {
    _pgModule = null;
    _pool = null;
    _schema = null;
    _poolPromise = null;
    async _loadPg() {
        if (this._pgModule !== null)
            return this._pgModule;
        try {
            const mod = (await import("pg"));
            this._pgModule =
                "Pool" in mod
                    ? mod
                    : mod.default;
            return this._pgModule;
        }
        catch (e) {
            throw new Error(`Driver 'postgresql' requires 'pg' — run: npm install pg @types/pg (${e.message})`);
        }
    }
    /**
     * Build the pool on first call; subsequent callers receive the cached
     * instance (or await the in-flight creation promise to avoid racing
     * two `new Pool()` calls on concurrent connects).
     */
    _ensurePool(envConfig) {
        if (this._pool !== null)
            return Promise.resolve(this._pool);
        if (this._poolPromise !== null)
            return this._poolPromise;
        this._poolPromise = this._loadPg().then((pg) => {
            const host = typeof envConfig["host"] === "string" ? envConfig["host"] : "localhost";
            const port = typeof envConfig["port"] === "number" ? envConfig["port"] : 5432;
            const database = typeof envConfig["database"] === "string" ? envConfig["database"] : "";
            const user = typeof envConfig["user"] === "string" ? envConfig["user"] : undefined;
            const password = typeof envConfig["password"] === "string"
                ? envConfig["password"]
                : undefined;
            const ssl = envConfig["ssl"] === true
                ? { rejectUnauthorized: false }
                : typeof envConfig["ssl"] === "object" && envConfig["ssl"] !== null
                    ? envConfig["ssl"]
                    : undefined;
            this._schema =
                typeof envConfig["schema"] === "string" &&
                    envConfig["schema"].length > 0
                    ? envConfig["schema"]
                    : null;
            const poolConfig = {
                host,
                port,
                database,
                max: typeof envConfig["pool_max"] === "number"
                    ? envConfig["pool_max"]
                    : 10,
                idleTimeoutMillis: 30_000,
            };
            if (user !== undefined)
                poolConfig["user"] = user;
            if (password !== undefined)
                poolConfig["password"] = password;
            if (ssl !== undefined)
                poolConfig["ssl"] = ssl;
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
    connect(envConfig) {
        return this._ensurePool(envConfig).then(async (pool) => {
            const client = await pool.connect();
            return { client, schema: this._schema };
        });
    }
    executeRead(_conn, _query, _params = null, _maxRows = 1000, _timeoutMs = 30_000) {
        return {
            status: "error",
            error_code: "SYNC_UNSUPPORTED",
            error: "PostgresDriver.executeRead is async — call executeReadAsync() instead.",
            execution_time_ms: 0,
        };
    }
    async executeReadAsync(conn, query, params = null, maxRows = 1000, timeoutMs = 30_000) {
        const handle = (await conn);
        const start = performance.now();
        try {
            await handle.client.query(`SET statement_timeout = ${Math.max(1, timeoutMs)}`);
            await handle.client.query("BEGIN READ ONLY");
            if (handle.schema !== null) {
                const safe = handle.schema.replace(/"/g, '""');
                await handle.client.query(`SET LOCAL search_path TO "${safe}"`);
            }
            const limited = /\blimit\b/i.test(query) === false
                ? `${query.trimEnd().replace(/;$/, "")} LIMIT ${maxRows + 1}`
                : query;
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
        }
        catch (e) {
            try {
                await handle.client.query("ROLLBACK");
            }
            catch {
                /* best-effort */
            }
            return {
                status: "error",
                error_code: "SQL_ERROR",
                error: e.message,
                execution_time_ms: roundTo2(performance.now() - start),
            };
        }
    }
    getSchema(_conn, _schemaName = "", _tableFilter = null) {
        return [];
    }
    async getSchemaAsync(conn, schemaName = "", tableFilter = null) {
        const handle = (await conn);
        const ns = schemaName.length > 0 ? schemaName : (handle.schema ?? "public");
        try {
            const tableParams = [ns];
            let tableSql = "SELECT table_name FROM information_schema.tables " +
                "WHERE table_schema = $1 AND table_type = 'BASE TABLE'";
            if (tableFilter !== null && tableFilter !== undefined) {
                tableSql += " AND table_name LIKE $2";
                tableParams.push(tableFilter);
            }
            tableSql += " ORDER BY table_name";
            const tablesResult = await handle.client.query(tableSql, tableParams);
            const out = [];
            for (const row of tablesResult.rows) {
                const tableName = String(row["table_name"]);
                const colsResult = await handle.client.query("SELECT column_name, data_type, is_nullable, column_default " +
                    "FROM information_schema.columns " +
                    "WHERE table_schema = $1 AND table_name = $2 " +
                    "ORDER BY ordinal_position", [ns, tableName]);
                const pkResult = await handle.client.query("SELECT a.attname AS column_name " +
                    "FROM pg_index i " +
                    "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) " +
                    "WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary", [ns, tableName]);
                const pkSet = new Set(pkResult.rows.map((r) => String(r["column_name"])));
                const columns = colsResult.rows.map((r) => new Column({
                    name: String(r["column_name"]),
                    data_type: String(r["data_type"]),
                    nullable: String(r["is_nullable"]).toUpperCase() === "YES",
                    is_primary_key: pkSet.has(String(r["column_name"])),
                    default: r["column_default"] === null
                        ? null
                        : String(r["column_default"]),
                }));
                out.push(new Table({ name: tableName, schema: ns, columns }));
            }
            return out;
        }
        catch {
            return [];
        }
    }
    /**
     * Release the checked-out client back to the pool. Does NOT destroy
     * the pool — use {@link shutdown} for that.
     */
    close(conn) {
        Promise.resolve(conn)
            .then((h) => h.client.release())
            .catch(() => {
            /* best-effort */
        });
    }
    classifyOperation(query) {
        return classifySqlKeywords(query);
    }
    async closeAsync(conn) {
        const handle = (await conn);
        try {
            handle.client.release();
        }
        catch {
            /* best-effort */
        }
    }
    /**
     * Per-driver health check. Runs `SELECT 1` on the given handle. Caller
     * still owns the handle and is responsible for {@link close}-ing it.
     */
    async healthCheck(conn) {
        try {
            const handle = (await conn);
            const r = await handle.client.query("SELECT 1");
            return r.rowCount !== null && r.rowCount >= 0;
        }
        catch {
            return false;
        }
    }
    /**
     * Drain and destroy the pool. connection.ts's `shutdownAll()` fans out
     * to each driver instance; this is where we actually close sockets.
     */
    async shutdown() {
        const pool = this._pool;
        this._pool = null;
        this._poolPromise = null;
        if (pool !== null) {
            try {
                await pool.end();
            }
            catch {
                /* best-effort */
            }
        }
    }
}
function roundTo2(n) {
    return Math.round(n * 100) / 100;
}
