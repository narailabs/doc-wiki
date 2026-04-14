/**
 * drivers/base.ts — Abstract base class for database drivers.
 *
 * Mirrors `drivers/base.py`:
 *  - `Column` and `Table` carry column-level + table-level metadata with a
 *    `toDict()` helper (returning a plain object with snake_case keys to
 *    match the Python dict layout).
 *  - `DatabaseDriver` is an abstract class exposing `connect`, `executeRead`,
 *    `getSchema`, `close`, and `classifyOperation`. Concrete drivers
 *    (sqlite, postgres, …) extend it.
 *
 * G-DB-1: `classifyOperation(query)` is the driver-level hook that lets
 * non-relational drivers (MongoDB, DynamoDB) classify their JSON envelope
 * queries (`db.users.insertOne({...})` → DML; `find` → READ) without going
 * through the SQL keyword path. SQL drivers delegate to
 * `classifySqlKeywords` from `policy.ts`.
 */
import type { OperationType } from "../policy.js";

/** Represents a database column. */
export class Column {
  readonly name: string;
  readonly data_type: string;
  readonly nullable: boolean;
  readonly is_primary_key: boolean;
  readonly default: string | null;

  constructor(
    opts: {
      name: string;
      data_type: string;
      nullable?: boolean;
      is_primary_key?: boolean;
      default?: string | null;
    },
  ) {
    this.name = opts.name;
    this.data_type = opts.data_type;
    this.nullable = opts.nullable ?? true;
    this.is_primary_key = opts.is_primary_key ?? false;
    this.default = opts.default ?? null;
  }

  toDict(): {
    name: string;
    data_type: string;
    nullable: boolean;
    is_primary_key: boolean;
    default: string | null;
  } {
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
  readonly name: string;
  readonly schema: string;
  readonly columns: Column[];

  constructor(opts: {
    name: string;
    schema?: string;
    columns?: Column[];
  }) {
    this.name = opts.name;
    this.schema = opts.schema ?? "";
    this.columns = opts.columns ?? [];
  }

  toDict(): {
    name: string;
    schema: string;
    columns: ReturnType<Column["toDict"]>[];
  } {
    return {
      name: this.name,
      schema: this.schema,
      columns: this.columns.map((c) => c.toDict()),
    };
  }
}

export interface ExecuteReadResult {
  status: "success" | "error";
  rows?: Record<string, unknown>[];
  row_count?: number;
  columns?: string[];
  execution_time_ms: number;
  truncated?: boolean;
  error_code?: string;
  error?: string;
}

/** Abstract base for all database drivers. */
export abstract class DatabaseDriver {
  /** Create a connection to the database. */
  abstract connect(envConfig: Record<string, unknown>): unknown;

  /** Execute a read query. Returns structured result dict. */
  abstract executeRead(
    conn: unknown,
    query: string,
    params?: unknown[] | null,
    maxRows?: number,
    timeoutMs?: number,
  ): ExecuteReadResult;

  /** Get schema information (tables + columns). */
  abstract getSchema(
    conn: unknown,
    schemaName?: string,
    tableFilter?: string | null,
  ): Table[];

  /** Close a connection. */
  abstract close(conn: unknown): void;

  /**
   * Classify a query string by its operation kind.
   *
   * SQL drivers (sqlite, postgres, mysql, sqlserver) delegate to
   * `classifySqlKeywords` from `policy.ts`. Document-store drivers
   * (mongodb, dynamodb) override with their own envelope-aware mapping
   * — e.g. MongoDB `insertOne` → DML, `find` → READ; DynamoDB `putItem`
   * → DML, `scan` → READ. Throws on empty input.
   *
   * Default-deny: unknown verbs/keywords classify as `"ddl"` (most
   * restrictive), matching the SQL classifier's behaviour.
   */
  abstract classifyOperation(query: string): OperationType;

  // ------------------------------------------------------------------
  // Python-snake_case aliases (optional parity with the Python API)
  // ------------------------------------------------------------------

  /** Alias for {@link executeRead}. */
  execute_read(
    conn: unknown,
    query: string,
    params?: unknown[] | null,
    maxRows?: number,
    timeoutMs?: number,
  ): ExecuteReadResult {
    return this.executeRead(conn, query, params ?? null, maxRows, timeoutMs);
  }

  /** Alias for {@link getSchema}. */
  get_schema(
    conn: unknown,
    schemaName?: string,
    tableFilter?: string | null,
  ): Table[] {
    return this.getSchema(conn, schemaName, tableFilter ?? null);
  }

  /** Alias for {@link classifyOperation}. */
  classify_operation(query: string): OperationType {
    return this.classifyOperation(query);
  }
}
