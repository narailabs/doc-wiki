/**
 * drivers/base.ts — Abstract base class for database drivers.
 *
 * Mirrors `drivers/base.py`:
 *  - `Column` and `Table` carry column-level + table-level metadata with a
 *    `toDict()` helper (returning a plain object with snake_case keys to
 *    match the Python dict layout).
 *  - `DatabaseDriver` is an abstract class exposing `connect`, `executeRead`,
 *    `getSchema`, and `close`. Concrete drivers (sqlite, postgres, …)
 *    extend it.
 */
/** Represents a database column. */
export class Column {
    name;
    data_type;
    nullable;
    is_primary_key;
    default;
    constructor(opts) {
        this.name = opts.name;
        this.data_type = opts.data_type;
        this.nullable = opts.nullable ?? true;
        this.is_primary_key = opts.is_primary_key ?? false;
        this.default = opts.default ?? null;
    }
    toDict() {
        return {
            name: this.name,
            data_type: this.data_type,
            nullable: this.nullable,
            is_primary_key: this.is_primary_key,
            default: this.default,
        };
    }
}
/** Represents a database table with its columns. */
export class Table {
    name;
    schema;
    columns;
    constructor(opts) {
        this.name = opts.name;
        this.schema = opts.schema ?? "";
        this.columns = opts.columns ?? [];
    }
    toDict() {
        return {
            name: this.name,
            schema: this.schema,
            columns: this.columns.map((c) => c.toDict()),
        };
    }
}
/** Abstract base for all database drivers. */
export class DatabaseDriver {
    // ------------------------------------------------------------------
    // Python-snake_case aliases (optional parity with the Python API)
    // ------------------------------------------------------------------
    /** Alias for {@link executeRead}. */
    execute_read(conn, query, params, maxRows, timeoutMs) {
        return this.executeRead(conn, query, params ?? null, maxRows, timeoutMs);
    }
    /** Alias for {@link getSchema}. */
    get_schema(conn, schemaName, tableFilter) {
        return this.getSchema(conn, schemaName, tableFilter ?? null);
    }
}
