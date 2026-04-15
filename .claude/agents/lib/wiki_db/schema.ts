/**
 * schema.ts — Schema introspection with TTL cache.
 *
 * Mirrors `schema.py`:
 *  - `SchemaManager(driver, ttl=300)` caches driver.getSchema results,
 *    keyed by `(env, schemaName, tableFilter)`.
 *  - On driver error, returns `[]` (never raises).
 *  - `clearCache()` forces re-query on next call.
 *
 * Phase E bridge:
 *  - Phase E drivers (pg, mysql, mssql, mongo, dynamo) expose
 *    `getSchemaAsync(conn, schema?, tableFilter?)` and return a useless
 *    stub from the sync `getSchema`. We detect the async method and await
 *    it when present; otherwise fall back to the sync call (sqlite path).
 */
import { performance } from "node:perf_hooks";
import type { DatabaseDriver, Table } from "./drivers/base.js";
import { logEvent } from "./audit.js";

/** Optional async schema hook exposed by Phase E drivers. */
interface AsyncSchemaDriver {
  getSchemaAsync?(
    conn: unknown,
    schemaName?: string,
    tableFilter?: string | null,
  ): Promise<Table[]>;
}

/** Cache entry record. */
interface CacheEntry {
  ts: number; // performance.now() ms
  data: Table[];
}

/** Cached schema introspection via a database driver. */
export class SchemaManager {
  private readonly _driver: DatabaseDriver;
  private readonly _ttl: number; // seconds
  private readonly _cache: Map<string, CacheEntry>;

  constructor(driver: DatabaseDriver, ttl: number = 300.0) {
    this._driver = driver;
    this._ttl = ttl;
    this._cache = new Map();
  }

  /** Get schema, using cache if within TTL. */
  async getSchema(
    conn: unknown,
    env: string,
    schemaName: string = "",
    tableFilter: string | null = null,
  ): Promise<Table[]> {
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

    let tables: Table[];
    try {
      const asyncHook = (this._driver as AsyncSchemaDriver).getSchemaAsync;
      if (typeof asyncHook === "function") {
        tables = await asyncHook.call(
          this._driver,
          conn,
          schemaName,
          tableFilter,
        );
      } else {
        tables = this._driver.getSchema(conn, schemaName, tableFilter);
      }
    } catch {
      return [];
    }

    // A5 (G-DB-AUDIT extension): emit `schema_inspect` BEFORE returning the
    // tables to the caller. The event documents which env+filter the
    // introspection ran against and how much surface area it exposed
    // (column_count is the sum across all tables — the most useful
    // single number for capacity-style audits). We never throw from
    // logEvent (the audit pipe is best-effort), so this is safe in every
    // code path including the cache-hit fast-path above.
    let columnCount = 0;
    for (const t of tables) columnCount += t.columns.length;
    logEvent({
      event_type: "schema_inspect",
      details: {
        env,
        table_filter: tableFilter,
        column_count: columnCount,
      },
    });

    this._cache.set(cacheKey, { ts: now, data: tables });
    return tables;
  }

  /** Force re-query on next call. */
  clearCache(): void {
    this._cache.clear();
  }
}
