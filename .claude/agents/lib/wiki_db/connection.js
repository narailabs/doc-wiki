/**
 * connection.ts — Connection-pool registry keyed by environment name.
 *
 * Wraps driver-native connection pools behind a uniform acquire/release
 * API. For Phase F the only shipped driver is `SQLiteDriver` (no native
 * pool; each `getConnection()` opens a fresh handle and `release` closes
 * it). Phase E drivers (pg, mysql, mssql, mongo, dynamo) will register
 * themselves with pool-aware factories via {@link registerDriverFactory}.
 *
 * Shutdown:
 *  - `shutdownAll()` closes every driver in the registry.
 *  - We register `SIGINT`, `SIGTERM`, and `exit` handlers the first time
 *    `getConnection()` is called, so long-running scripts release their
 *    pools on process teardown.
 */
import { getEnvironment } from "./environments.js";
import { SQLiteDriver } from "./drivers/sqlite.js";
import { logEvent } from "./audit.js";
const _driverFactories = new Map();
/** Register a factory under a driver name (e.g. "sqlite", "postgresql"). */
export function registerDriverFactory(name, factory) {
    _driverFactories.set(name, factory);
}
/** Remove all registered factories (test helper). */
export function clearDriverFactories() {
    _driverFactories.clear();
}
/** Return registered driver names (test helper). */
export function listDriverFactories() {
    return [..._driverFactories.keys()];
}
// Register the one driver we ship with today. Phase E calls
// `registerDriverFactory("postgresql", ...)` etc. from the driver modules
// themselves (side-effecting on import).
registerDriverFactory("sqlite", (envConfig) => {
    const d = new SQLiteDriver();
    // Stash the raw config on the instance so `Pool` can pass it through on
    // each `connect()` call without re-reading the environment registry.
    d._envConfig =
        envConfig;
    return d;
});
const _pools = new Map();
// ---------------------------------------------------------------------------
// Lifecycle handlers
// ---------------------------------------------------------------------------
let _handlersInstalled = false;
function _installShutdownHandlers() {
    if (_handlersInstalled)
        return;
    _handlersInstalled = true;
    // `exit` fires once per process; make the cleanup best-effort and
    // synchronous where possible so pools are released before Node exits.
    process.on("exit", () => {
        try {
            _shutdownAllSync();
        }
        catch {
            /* best-effort */
        }
    });
    // Signals: flush pools so native connections release promptly, then
    // leave the exit decision to the host. Calling `process.exit()` here
    // would clobber any user-installed SIGINT/SIGTERM handler in an
    // application that embeds wiki_db, so we deliberately do not do that.
    // Node's default behavior (exit with 128+signum when no other listener
    // calls `preventDefault`-equivalent) still applies when no handler
    // keeps the process alive.
    for (const sig of ["SIGINT", "SIGTERM"]) {
        process.on(sig, () => {
            try {
                _shutdownAllSync();
            }
            catch {
                /* best-effort */
            }
        });
    }
}
// ---------------------------------------------------------------------------
// Pool operations
// ---------------------------------------------------------------------------
/**
 * Obtain a connection for the named environment. Creates the driver and
 * pool lazily on first call. Returns a handle that must be passed to
 * {@link releaseConnection} when done.
 */
export function getConnection(envName) {
    _installShutdownHandlers();
    let entry = _pools.get(envName);
    if (entry === undefined) {
        entry = _buildPool(envName);
        _pools.set(envName, entry);
    }
    const native = entry.driver.connect(_resolveEnvConfig(envName));
    entry.openConnections.add(native);
    return { envName, native, driver: entry.driver };
}
/** Release a connection back to its pool (closes native handle). */
export function releaseConnection(envName, conn) {
    const entry = _pools.get(envName);
    if (entry === undefined)
        return;
    if (!entry.openConnections.has(conn.native))
        return;
    entry.openConnections.delete(conn.native);
    try {
        entry.driver.close(conn.native);
    }
    catch {
        /* best-effort */
    }
}
/**
 * Cheap liveness check. Returns `true` on success, `false` on any error.
 *
 * Preference order:
 *  1. `driver.healthCheck(native)` — Phase E drivers use engine-appropriate
 *     probes (Mongo `ping`, DynamoDB `ListTables`, etc.) that `SELECT 1`
 *     cannot express.
 *  2. `driver.executeReadAsync(..., "SELECT 1", ...)` — SQL drivers.
 *  3. `driver.executeRead(..., "SELECT 1", ...)` — legacy sync path
 *     (SQLite, mocked test drivers).
 */
export async function healthCheck(envName) {
    let conn = null;
    try {
        conn = getConnection(envName);
        const driverHealthCheck = conn.driver.healthCheck;
        if (typeof driverHealthCheck === "function") {
            return Boolean(await driverHealthCheck.call(conn.driver, conn.native));
        }
        const asyncHook = conn.driver.executeReadAsync;
        if (typeof asyncHook === "function") {
            const result = await asyncHook.call(conn.driver, conn.native, "SELECT 1", [], 1, 5000);
            return result.status === "success";
        }
        const result = conn.driver.executeRead(conn.native, "SELECT 1", [], 1, 5000);
        return result.status === "success";
    }
    catch {
        return false;
    }
    finally {
        if (conn !== null)
            releaseConnection(envName, conn);
    }
}
/**
 * Close every pool and drop the registry. Awaits each driver's
 * `shutdown()` so native connection pools (pg.Pool, mysql2 pool,
 * mssql.ConnectionPool, MongoClient) are fully drained before we return.
 */
export async function shutdownAll() {
    const drains = [];
    for (const entry of _pools.values()) {
        for (const native of [...entry.openConnections]) {
            try {
                entry.driver.close(native);
            }
            catch {
                /* best-effort */
            }
        }
        entry.openConnections.clear();
        const shutdownFn = entry.driver.shutdown;
        if (typeof shutdownFn === "function") {
            try {
                const result = shutdownFn.call(entry.driver);
                if (result instanceof Promise) {
                    drains.push(result.catch(() => undefined));
                }
            }
            catch {
                /* best-effort */
            }
        }
    }
    _pools.clear();
    await Promise.all(drains);
}
/**
 * Synchronous variant used from the `exit` handler (Node's `exit` event
 * is strictly synchronous — we cannot await there). We still call each
 * driver's `shutdown()` fire-and-forget so pool teardown starts; any
 * rejected promises get an empty catch handler attached so they do not
 * crash the exiting process.
 */
function _shutdownAllSync() {
    for (const entry of _pools.values()) {
        for (const native of [...entry.openConnections]) {
            try {
                entry.driver.close(native);
            }
            catch {
                /* best-effort */
            }
        }
        entry.openConnections.clear();
        const shutdownFn = entry.driver.shutdown;
        if (typeof shutdownFn === "function") {
            try {
                const result = shutdownFn.call(entry.driver);
                if (result instanceof Promise) {
                    result.catch(() => undefined);
                }
            }
            catch {
                /* best-effort */
            }
        }
    }
    _pools.clear();
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _buildPool(envName) {
    const envCfg = _resolveEnvConfig(envName);
    const driverName = _driverName(envCfg);
    const factory = _driverFactories.get(driverName);
    if (factory === undefined) {
        throw new Error(`connection: no driver factory registered for '${driverName}'. ` +
            `Registered: [${[..._driverFactories.keys()].join(", ") || "none"}]`);
    }
    const driver = factory(envCfg);
    // G-DB-AUDIT: emit `pool_created` once per environment (this function is
    // only invoked on the first getConnection() for a given envName).
    logEvent({
        event_type: "pool_created",
        details: { env: envName, driver: driverName },
    });
    return { envName, driver, openConnections: new Set() };
}
/**
 * Resolve an environment's config. If the env is registered via
 * `environments.registerEnvironment`, we return that; otherwise we throw
 * a clear error.
 *
 * Returned shape is a plain record so driver factories can consume it
 * without importing `EnvironmentConfig` directly.
 */
function _resolveEnvConfig(envName) {
    const env = getEnvironment(envName);
    return {
        host: env.host,
        port: env.port,
        database: env.database,
        schema: env.schema,
        approval_mode: env.approval_mode,
        driver: env.driver,
    };
}
function _driverName(envCfg) {
    const d = envCfg["driver"];
    return typeof d === "string" ? d : "postgresql";
}
// ---------------------------------------------------------------------------
// Introspection helpers (tests)
// ---------------------------------------------------------------------------
/** Return whether a pool exists for the given env (test helper). */
export function _hasPool(envName) {
    return _pools.has(envName);
}
/** Return the number of open connections in a pool (test helper). */
export function _openCount(envName) {
    return _pools.get(envName)?.openConnections.size ?? 0;
}
