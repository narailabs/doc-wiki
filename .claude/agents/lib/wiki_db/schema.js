/**
 * schema.ts — Schema introspection with TTL cache.
 *
 * Mirrors `schema.py`:
 *  - `SchemaManager(driver, ttl=300)` caches driver.getSchema results,
 *    keyed by `(env, schemaName, tableFilter)`.
 *  - On driver error, returns `[]` (never raises).
 *  - `clearCache()` forces re-query on next call.
 */
import { performance } from "node:perf_hooks";
/** Cached schema introspection via a database driver. */
export class SchemaManager {
    _driver;
    _ttl; // seconds
    _cache;
    constructor(driver, ttl = 300.0) {
        this._driver = driver;
        this._ttl = ttl;
        this._cache = new Map();
    }
    /** Get schema, using cache if within TTL. */
    getSchema(conn, env, schemaName = "", tableFilter = null) {
        // Python uses a tuple cache key; emulate with a JSON-encoded key so
        // (None, "", "") and ("", "", "") differ exactly as in Python.
        const cacheKey = JSON.stringify([env, schemaName, tableFilter]);
        const now = performance.now();
        const entry = this._cache.get(cacheKey);
        if (entry !== undefined) {
            // `ts` stored in ms; `_ttl` is seconds → compare in seconds.
            if ((now - entry.ts) / 1000 < this._ttl) {
                return entry.data;
            }
        }
        let tables;
        try {
            tables = this._driver.getSchema(conn, schemaName, tableFilter);
        }
        catch {
            return [];
        }
        this._cache.set(cacheKey, { ts: now, data: tables });
        return tables;
    }
    /** Force re-query on next call. */
    clearCache() {
        this._cache.clear();
    }
    // ------------------------------------------------------------------
    // Python-snake_case aliases
    // ------------------------------------------------------------------
    /** Alias for {@link getSchema}. */
    get_schema(conn, env, schemaName = "", tableFilter = null) {
        return this.getSchema(conn, env, schemaName, tableFilter);
    }
    /** Alias for {@link clearCache}. */
    clear_cache() {
        this.clearCache();
    }
}
