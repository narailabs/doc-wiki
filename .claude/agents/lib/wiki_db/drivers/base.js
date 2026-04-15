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
}
