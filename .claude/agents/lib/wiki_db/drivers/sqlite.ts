/**
 * drivers/sqlite.ts — SQLite driver, used for fast unit tests and
 * local/embedded databases.
 *
 * Mirrors `drivers/sqlite.py`. The Python implementation uses stdlib
 * `sqlite3`; here we use `better-sqlite3` because it provides a synchronous
 * API that matches Python's ergonomics (no Promise wrapping needed for
 * single-shot queries inside the policy/query pipeline).
 *
 * Behaviour parity:
 *  - `connect({database})` opens the path; `:memory:` is an in-memory DB.
 *  - `executeRead` fetches `max_rows + 1` rows so we can detect truncation
 *    without reading the whole result set.
 *  - On error: returns `{status: "error", error_code: "SQL_ERROR", error,
 *    execution_time_ms}` — never raises.
 *  - `getSchema(conn, schema?, tableFilter?)` reads `sqlite_master` and
 *    `PRAGMA table_info(<name>)`, mirroring Python's queries verbatim.
 */
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import {
  Column,
  DatabaseDriver,
  Table,
  type ExecuteReadResult,
} from "./base.js";

export class SQLiteDriver extends DatabaseDriver {
  override connect(envConfig: Record<string, unknown>): Database.Database {
    const dbPath =
      typeof envConfig["database"] === "string"
        ? (envConfig["database"] as string)
        : ":memory:";
    return new Database(dbPath);
  }

  override executeRead(
    conn: unknown,
    query: string,
    params: unknown[] | null = null,
    maxRows: number = 1000,
    _timeoutMs: number = 30000,
  ): ExecuteReadResult {
    const db = conn as Database.Database;
    const start = performance.now();
    try {
      const stmt = db.prepare(query);
      // We need column metadata even when no rows; better-sqlite3 exposes
      // `stmt.columns()` only after the statement has been used in some way
      // for SELECT-like queries. `pluck(false)` + `raw(false)` keep us in
      // object-row mode (default), which is what Python's `sqlite3.Row` +
      // `dict(r)` produces.
      const iter = stmt.iterate(...((params ?? []) as unknown[])) as
        IterableIterator<Record<string, unknown>>;
      const rowsRaw: Record<string, unknown>[] = [];
      // Fetch one extra row to detect truncation.
      let truncated = false;
      for (const row of iter) {
        if (rowsRaw.length >= maxRows) {
          truncated = true;
          // We need to break the iterator cleanly so SQLite can release
          // its statement state. better-sqlite3's iterate() honours
          // `return()` to close the underlying stmt.
          if (typeof iter.return === "function") iter.return();
          break;
        }
        rowsRaw.push(row);
      }
      // Columns: `stmt.columns()` returns ColumnDefinition[] with `name`.
      let columns: string[] = [];
      try {
        columns = stmt.columns().map((c) => c.name);
      } catch {
        // Non-SELECT statements have no columns; mirror Python's
        // `cursor.description` being None.
        columns = [];
      }
      const elapsed = performance.now() - start;
      return {
        status: "success",
        rows: rowsRaw,
        row_count: rowsRaw.length,
        columns,
        execution_time_ms: roundTo2(elapsed),
        truncated,
      };
    } catch (e) {
      const elapsed = performance.now() - start;
      return {
        status: "error",
        error_code: "SQL_ERROR",
        error: (e as Error).message,
        execution_time_ms: roundTo2(elapsed),
      };
    }
  }

  override getSchema(
    conn: unknown,
    schemaName: string = "",
    tableFilter: string | null = null,
  ): Table[] {
    const db = conn as Database.Database;
    try {
      let cursor;
      let baseQuery =
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
      if (tableFilter !== null && tableFilter !== undefined) {
        baseQuery += " AND name LIKE ?";
        cursor = db.prepare(baseQuery).all(tableFilter) as Array<{
          name: string;
        }>;
      } else {
        cursor = db.prepare(baseQuery).all() as Array<{ name: string }>;
      }

      const tables: Table[] = [];
      for (const row of cursor) {
        const tableName = row.name;
        // PRAGMA table_info returns rows shaped like:
        //   {cid, name, type, notnull, dflt_value, pk}
        const colCursor = db
          .prepare(`PRAGMA table_info(${tableName})`)
          .all() as Array<{
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>;
        const columns: Column[] = [];
        for (const colRow of colCursor) {
          columns.push(
            new Column({
              name: colRow.name,
              data_type: colRow.type,
              nullable: !colRow.notnull,
              is_primary_key: Boolean(colRow.pk),
              default: colRow.dflt_value,
            }),
          );
        }
        tables.push(
          new Table({ name: tableName, schema: schemaName, columns }),
        );
      }
      return tables;
    } catch {
      return [];
    }
  }

  override close(conn: unknown): void {
    (conn as Database.Database).close();
  }
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
