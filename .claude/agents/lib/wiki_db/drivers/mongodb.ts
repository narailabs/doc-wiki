/**
 * drivers/mongodb.ts — MongoDB driver via the official `mongodb` package.
 *
 * Design:
 *  - `MongoClient` *is* the pool. The driver lazily creates one shared
 *    client on the first `connect()` call and reuses it for subsequent
 *    handles. `close()` is a no-op because we don't want one caller's
 *    `getConnection()/releaseConnection()` cycle to destroy the pool for
 *    concurrent callers. {@link shutdown} closes the client at teardown.
 *  - Collections are the MongoDB equivalent of tables. `getSchemaAsync`
 *    lists collections and infers columns by sampling up to 50 documents
 *    and unioning their top-level keys.
 *  - `executeReadAsync(conn, query)` treats `query` as a JSON envelope:
 *        { "collection": "<name>", "op": "find"|"aggregate"|"count",
 *          "filter": {...}, "projection": {...}, "sort": {...},
 *          "pipeline": [ ... ]
 *        }
 *    This is the same shape the wiki_db policy layer emits for Mongo envs.
 *  - READ-ONLY: the driver exposes only `find`, `aggregate`, and `count`.
 *    Any other `op` is rejected at the driver layer with a `SQL_ERROR`
 *    whose error message begins `"forbidden op"`. We never call any
 *    mutating method (insertOne, updateOne, deleteOne, …).
 *  - The `mongodb` package is loaded via dynamic `import()`; missing
 *    install throws a clear `npm install mongodb` hint.
 */
import { performance } from "node:perf_hooks";
import {
  Column,
  DatabaseDriver,
  Table,
  type ExecuteReadResult,
} from "./base.js";

// ---------------------------------------------------------------------------
// Minimal ambient types
// ---------------------------------------------------------------------------

interface MongoCursor<T> {
  toArray(): Promise<T[]>;
  limit(n: number): MongoCursor<T>;
  project(spec: Record<string, unknown>): MongoCursor<T>;
  sort(spec: Record<string, unknown>): MongoCursor<T>;
}
interface MongoCollection {
  find(
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): MongoCursor<Record<string, unknown>>;
  aggregate(
    pipeline: Record<string, unknown>[],
    options?: Record<string, unknown>,
  ): MongoCursor<Record<string, unknown>>;
  countDocuments(filter?: Record<string, unknown>): Promise<number>;
}
interface MongoDb {
  collection(name: string): MongoCollection;
  command(cmd: Record<string, unknown>): Promise<Record<string, unknown>>;
  listCollections(): {
    toArray(): Promise<{ name: string; type?: string }[]>;
  };
}
interface MongoClient {
  connect(): Promise<MongoClient>;
  close(): Promise<void>;
  db(name?: string): MongoDb;
}
interface MongoModule {
  MongoClient: new (
    uri: string,
    options?: Record<string, unknown>,
  ) => MongoClient;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

interface MongoQueryEnvelope {
  collection: string;
  op: "find" | "aggregate" | "count";
  filter?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  pipeline?: Record<string, unknown>[];
}

const READ_ONLY_OPS = new Set(["find", "aggregate", "count"]);

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface MongoHandle {
  db: MongoDb;
  database: string;
}

export class MongoDriver extends DatabaseDriver {
  private _mongoModule: MongoModule | null = null;
  private _client: MongoClient | null = null;
  private _clientPromise: Promise<MongoClient> | null = null;
  private _database = "";

  private async _loadMongo(): Promise<MongoModule> {
    if (this._mongoModule !== null) return this._mongoModule;
    try {
      const mod = (await import("mongodb")) as unknown as
        | MongoModule
        | { default: MongoModule };
      this._mongoModule =
        "MongoClient" in (mod as object)
          ? (mod as MongoModule)
          : (mod as { default: MongoModule }).default;
      return this._mongoModule;
    } catch (e) {
      throw new Error(
        `Driver 'mongodb' requires 'mongodb' — run: npm install mongodb (${
          (e as Error).message
        })`,
      );
    }
  }

  private _ensureClient(
    envConfig: Record<string, unknown>,
  ): Promise<MongoClient> {
    if (this._client !== null) return Promise.resolve(this._client);
    if (this._clientPromise !== null) return this._clientPromise;
    this._clientPromise = this._loadMongo().then(async (mongo) => {
      const uri =
        typeof envConfig["uri"] === "string"
          ? envConfig["uri"]
          : _buildUri(envConfig);
      this._database =
        typeof envConfig["database"] === "string" ? envConfig["database"] : "";
      const opts: Record<string, unknown> = {
        readPreference: "secondaryPreferred",
        maxPoolSize:
          typeof envConfig["pool_max"] === "number"
            ? envConfig["pool_max"]
            : 10,
      };
      const client = new mongo.MongoClient(uri, opts);
      await client.connect();
      this._client = client;
      return client;
    });
    return this._clientPromise;
  }

  override connect(envConfig: Record<string, unknown>): Promise<MongoHandle> {
    return this._ensureClient(envConfig).then((client) => {
      const db = client.db(this._database.length > 0 ? this._database : undefined);
      return { db, database: this._database } satisfies MongoHandle;
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
        "MongoDriver.executeRead is async — call executeReadAsync() instead.",
      execution_time_ms: 0,
    };
  }

  async executeReadAsync(
    conn: unknown,
    query: string,
    _params: unknown[] | null = null,
    maxRows: number = 1000,
    _timeoutMs: number = 30_000,
  ): Promise<ExecuteReadResult> {
    const handle = (await (conn as Promise<MongoHandle> | MongoHandle)) as MongoHandle;
    const start = performance.now();
    try {
      const env = _parseEnvelope(query);
      if (env === null) {
        return {
          status: "error",
          error_code: "SQL_ERROR",
          error:
            "MongoDriver: query must be a JSON envelope {collection, op, ...}",
          execution_time_ms: roundTo2(performance.now() - start),
        };
      }
      if (!READ_ONLY_OPS.has(env.op)) {
        return {
          status: "error",
          error_code: "SQL_ERROR",
          error: `forbidden op: '${env.op}' — MongoDriver allows only [${[...READ_ONLY_OPS].join(", ")}]`,
          execution_time_ms: roundTo2(performance.now() - start),
        };
      }

      const coll = handle.db.collection(env.collection);

      if (env.op === "count") {
        const total = await coll.countDocuments(env.filter ?? {});
        return {
          status: "success",
          rows: [{ count: total }],
          row_count: 1,
          columns: ["count"],
          execution_time_ms: roundTo2(performance.now() - start),
          truncated: false,
        };
      }

      let cursor: MongoCursor<Record<string, unknown>>;
      if (env.op === "find") {
        cursor = coll.find(env.filter ?? {});
        if (env.projection) cursor = cursor.project(env.projection);
        if (env.sort) cursor = cursor.sort(env.sort);
        cursor = cursor.limit(maxRows + 1);
      } else {
        const pipeline = env.pipeline ?? [];
        cursor = coll.aggregate([
          ...pipeline,
          { $limit: maxRows + 1 } as Record<string, unknown>,
        ]);
      }

      const docs = await cursor.toArray();
      let truncated = false;
      let rows = docs;
      if (rows.length > maxRows) {
        truncated = true;
        rows = rows.slice(0, maxRows);
      }

      const columns = _inferColumns(rows);
      return {
        status: "success",
        rows,
        row_count: rows.length,
        columns,
        execution_time_ms: roundTo2(performance.now() - start),
        truncated,
      };
    } catch (e) {
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
    const handle = (await (conn as Promise<MongoHandle> | MongoHandle)) as MongoHandle;
    try {
      const colls = await handle.db.listCollections().toArray();
      const filtered = colls.filter((c) => {
        if (tableFilter === null || tableFilter === undefined) return true;
        const pattern = new RegExp(
          "^" +
            tableFilter.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") +
            "$",
        );
        return pattern.test(c.name);
      });

      const out: Table[] = [];
      for (const c of filtered) {
        const sample = await handle.db
          .collection(c.name)
          .find({}, {})
          .limit(50)
          .toArray();

        const keyTypes = new Map<string, string>();
        for (const doc of sample) {
          for (const k of Object.keys(doc)) {
            if (!keyTypes.has(k) && doc[k] !== null && doc[k] !== undefined) {
              keyTypes.set(k, _mongoType(doc[k]));
            } else if (!keyTypes.has(k)) {
              keyTypes.set(k, "null");
            }
          }
        }
        const columns: Column[] = [...keyTypes.entries()].map(
          ([name, type]) =>
            new Column({
              name,
              data_type: type,
              nullable: name !== "_id",
              is_primary_key: name === "_id",
              default: null,
            }),
        );
        out.push(
          new Table({
            name: c.name,
            schema: schemaName.length > 0 ? schemaName : handle.database,
            columns,
          }),
        );
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * No-op: the MongoClient is the pool and is shared across handles.
   * {@link shutdown} closes the client at process teardown.
   */
  override close(_conn: unknown): void {
    /* pool is shared — nothing to release per-handle */
  }

  async closeAsync(_conn: unknown): Promise<void> {
    /* pool is shared — nothing to release per-handle */
  }

  /** Per-driver health check via MongoDB's `ping` command. */
  async healthCheck(conn: unknown): Promise<boolean> {
    try {
      const handle = (await (conn as Promise<MongoHandle> | MongoHandle)) as MongoHandle;
      const res = await handle.db.command({ ping: 1 });
      return Number(res["ok"]) === 1;
    } catch {
      return false;
    }
  }

  /** Close the shared MongoClient. */
  async shutdown(): Promise<void> {
    const client = this._client;
    this._client = null;
    this._clientPromise = null;
    if (client !== null) {
      try {
        await client.close();
      } catch {
        /* best-effort */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildUri(envConfig: Record<string, unknown>): string {
  const host =
    typeof envConfig["host"] === "string" ? envConfig["host"] : "localhost";
  const port =
    typeof envConfig["port"] === "number" ? envConfig["port"] : 27017;
  const user = typeof envConfig["user"] === "string" ? envConfig["user"] : "";
  const password =
    typeof envConfig["password"] === "string" ? envConfig["password"] : "";
  const authPart =
    user.length > 0 && password.length > 0
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
      : "";
  return `mongodb://${authPart}${host}:${port}`;
}

function _parseEnvelope(query: string): MongoQueryEnvelope | null {
  try {
    const parsed = JSON.parse(query) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as MongoQueryEnvelope).collection !== "string" ||
      typeof (parsed as MongoQueryEnvelope).op !== "string"
    ) {
      return null;
    }
    return parsed as MongoQueryEnvelope;
  } catch {
    return null;
  }
}

function _mongoType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") {
    const ctor = (v as { constructor?: { name?: string } })?.constructor?.name;
    if (ctor === "ObjectId") return "objectId";
    if (ctor === "Date") return "date";
    return "object";
  }
  return t;
}

function _inferColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
