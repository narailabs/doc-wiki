/**
 * drivers/dynamodb.ts — AWS DynamoDB driver via `@aws-sdk/client-dynamodb`.
 *
 * Design:
 *  - DynamoDB is HTTP-based: there is no connection pool. The driver
 *    lazily creates a single shared `DynamoDBClient` on the first
 *    `connect()` call and reuses it across handles. `close()` is a
 *    no-op; {@link shutdown} destroys the client at teardown.
 *  - "Tables" map directly to DynamoDB tables.
 *  - `getSchema` uses `ListTablesCommand` + `DescribeTableCommand` to
 *    reconstruct a `Table` with its key schema as `Column` rows. Non-key
 *    attributes are not part of the DescribeTable response — DynamoDB is
 *    schemaless for those — so we do not invent them here. Callers who
 *    need attribute inference should fall back to `sample`.
 *  - `executeRead(conn, query)` treats `query` as a JSON envelope:
 *        { "table": "<name>",
 *          "op": "get"|"query"|"scan"|"sample",
 *          "key": {...},          // for "get"
 *          "keyCondition": {...},  // for "query"
 *          "filter": {...},        // for "query" / "scan"
 *          "limit": N              // caps at maxRows+1
 *        }
 *    `op: "sample"` is an alias for a `ScanCommand` with a 10-item limit.
 *  - READ-ONLY: only `List`, `Describe`, `Get`, `Query`, `Scan` are
 *    imported. Any other `op` → driver-layer `SQL_ERROR` whose message
 *    begins `"forbidden op"`.
 *  - `@aws-sdk/client-dynamodb` is dynamically imported; missing install
 *    throws a clear `npm install @aws-sdk/client-dynamodb` hint.
 */
import { performance } from "node:perf_hooks";
import {
  Column,
  DatabaseDriver,
  Table,
  type ExecuteReadResult,
} from "./base.js";
import { OperationType } from "../policy.js";

/**
 * G-DYNAMO-PARSE-ERROR: distinguishes a malformed envelope JSON from
 * the default-deny "DDL" fall-through. `Policy.checkQuery` converts
 * thrown errors into `{ decision: "deny", reason: <message> }` so
 * this surfaces as a helpful diagnostic instead of "DDL statements are
 * never allowed".
 */
export class DynamoEnvelopeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DynamoEnvelopeParseError";
  }
}

/**
 * G-DB-1: DynamoDB op → OperationType mapping.
 *
 * Both the lower-case envelope form (`{table, op: "scan"}`) and the
 * official AWS command names (`ScanCommand`, `PutItemCommand`) are
 * recognised. Unknown ops default to DDL.
 */
const _DYNAMO_READ_OPS: ReadonlySet<string> = new Set([
  // envelope form
  "get", "query", "scan", "sample", "batchGet",
  // AWS SDK command form
  "GetItem", "GetItemCommand", "Query", "QueryCommand",
  "Scan", "ScanCommand", "BatchGetItem", "BatchGetItemCommand",
  // describe / list — admin reads
  "ListTables", "ListTablesCommand", "DescribeTable", "DescribeTableCommand",
]);
const _DYNAMO_DML_OPS: ReadonlySet<string> = new Set([
  // envelope form (would be rejected by executeReadAsync but classified
  // correctly so policy returns PRESENT_ONLY rather than DENY/DDL)
  "put", "update", "delete", "batchWrite", "transactWrite",
  // AWS SDK command form
  "PutItem", "PutItemCommand", "UpdateItem", "UpdateItemCommand",
  "DeleteItem", "DeleteItemCommand",
  "BatchWriteItem", "BatchWriteItemCommand",
  "TransactWriteItems", "TransactWriteItemsCommand",
]);
const _DYNAMO_DDL_OPS: ReadonlySet<string> = new Set([
  "createTable", "deleteTable", "updateTable",
  "CreateTable", "CreateTableCommand",
  "DeleteTable", "DeleteTableCommand",
  "UpdateTable", "UpdateTableCommand",
]);

// ---------------------------------------------------------------------------
// Minimal ambient types
// ---------------------------------------------------------------------------

interface DynamoAttributeValue {
  S?: string;
  N?: string;
  BOOL?: boolean;
  NULL?: boolean;
  L?: DynamoAttributeValue[];
  M?: Record<string, DynamoAttributeValue>;
}
type DynamoItem = Record<string, DynamoAttributeValue>;

interface ListTablesOutput {
  TableNames?: string[];
  LastEvaluatedTableName?: string;
}
interface DescribeTableOutput {
  Table?: {
    TableName?: string;
    KeySchema?: { AttributeName: string; KeyType: "HASH" | "RANGE" }[];
    AttributeDefinitions?: { AttributeName: string; AttributeType: string }[];
    ItemCount?: number;
    CreationDateTime?: Date;
  };
}
interface QueryScanOutput {
  Items?: DynamoItem[];
  Count?: number;
  LastEvaluatedKey?: DynamoItem;
  ConsumedCapacity?: unknown;
}
interface GetOutput {
  Item?: DynamoItem;
  ConsumedCapacity?: unknown;
}

interface DynamoClient {
  send(cmd: unknown): Promise<unknown>;
  destroy(): void;
}
interface DynamoCommandCtor<I, O> {
  new (input: I): { __output__?: O };
}
interface DynamoModule {
  DynamoDBClient: new (config: Record<string, unknown>) => DynamoClient;
  ListTablesCommand: DynamoCommandCtor<Record<string, unknown>, ListTablesOutput>;
  DescribeTableCommand: DynamoCommandCtor<
    { TableName: string },
    DescribeTableOutput
  >;
  GetItemCommand: DynamoCommandCtor<
    { TableName: string; Key: DynamoItem },
    GetOutput
  >;
  QueryCommand: DynamoCommandCtor<Record<string, unknown>, QueryScanOutput>;
  ScanCommand: DynamoCommandCtor<Record<string, unknown>, QueryScanOutput>;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

interface DynamoQueryEnvelope {
  table: string;
  op: "get" | "query" | "scan" | "sample";
  key?: DynamoItem;
  keyCondition?: {
    KeyConditionExpression: string;
    ExpressionAttributeValues?: DynamoItem;
    ExpressionAttributeNames?: Record<string, string>;
  };
  filter?: {
    FilterExpression: string;
    ExpressionAttributeValues?: DynamoItem;
    ExpressionAttributeNames?: Record<string, string>;
  };
  limit?: number;
}

const READ_ONLY_OPS = new Set(["get", "query", "scan", "sample"]);

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface DynamoHandle {
  client: DynamoClient;
  module: DynamoModule;
}

export class DynamoDriver extends DatabaseDriver {
  private _dynamoModule: DynamoModule | null = null;
  private _client: DynamoClient | null = null;
  private _clientPromise: Promise<DynamoClient> | null = null;

  private async _loadDynamo(): Promise<DynamoModule> {
    if (this._dynamoModule !== null) return this._dynamoModule;
    try {
      const mod = (await import("@aws-sdk/client-dynamodb")) as unknown as
        | DynamoModule
        | { default: DynamoModule };
      this._dynamoModule =
        "DynamoDBClient" in (mod as object)
          ? (mod as DynamoModule)
          : (mod as { default: DynamoModule }).default;
      return this._dynamoModule;
    } catch (e) {
      throw new Error(
        `Driver 'dynamodb' requires '@aws-sdk/client-dynamodb' — run: npm install @aws-sdk/client-dynamodb (${
          (e as Error).message
        })`,
      );
    }
  }

  private _ensureClient(
    envConfig: Record<string, unknown>,
  ): Promise<DynamoClient> {
    if (this._client !== null) return Promise.resolve(this._client);
    if (this._clientPromise !== null) return this._clientPromise;
    this._clientPromise = this._loadDynamo().then((mod) => {
      const region =
        typeof envConfig["region"] === "string"
          ? envConfig["region"]
          : "us-east-1";
      const endpoint =
        typeof envConfig["endpoint"] === "string"
          ? envConfig["endpoint"]
          : undefined;

      const config: Record<string, unknown> = { region };
      if (endpoint !== undefined) config["endpoint"] = endpoint;
      if (
        typeof envConfig["credentials"] === "object" &&
        envConfig["credentials"] !== null
      ) {
        config["credentials"] = envConfig["credentials"];
      }

      const client = new mod.DynamoDBClient(config);
      this._client = client;
      return client;
    });
    return this._clientPromise;
  }

  override connect(envConfig: Record<string, unknown>): Promise<DynamoHandle> {
    return this._ensureClient(envConfig).then(async (client) => {
      // _loadDynamo set _dynamoModule before _ensureClient resolved, so
      // it is guaranteed non-null here.
      const module = this._dynamoModule!;
      return { client, module } satisfies DynamoHandle;
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
        "DynamoDriver.executeRead is async — call executeReadAsync() instead.",
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
    const handle = (await (conn as Promise<DynamoHandle> | DynamoHandle)) as DynamoHandle;
    const start = performance.now();
    try {
      const env = _parseEnvelope(query);
      if (env === null) {
        return {
          status: "error",
          error_code: "SQL_ERROR",
          error:
            "DynamoDriver: query must be a JSON envelope {table, op, ...}",
          execution_time_ms: roundTo2(performance.now() - start),
        };
      }
      if (!READ_ONLY_OPS.has(env.op)) {
        return {
          status: "error",
          error_code: "SQL_ERROR",
          error: `forbidden op: '${env.op}' — DynamoDriver allows only [${[...READ_ONLY_OPS].join(", ")}]`,
          execution_time_ms: roundTo2(performance.now() - start),
        };
      }

      const { client, module } = handle;

      if (env.op === "get") {
        if (env.key === undefined) {
          return {
            status: "error",
            error_code: "SQL_ERROR",
            error: "DynamoDriver: 'get' op requires 'key'",
            execution_time_ms: roundTo2(performance.now() - start),
          };
        }
        const out = (await client.send(
          new module.GetItemCommand({ TableName: env.table, Key: env.key }),
        )) as GetOutput;
        const rows = out.Item !== undefined ? [_unmarshal(out.Item)] : [];
        return {
          status: "success",
          rows,
          row_count: rows.length,
          columns: _inferColumns(rows),
          execution_time_ms: roundTo2(performance.now() - start),
          truncated: false,
        };
      }

      if (env.op === "sample") {
        const out = (await client.send(
          new module.ScanCommand({
            TableName: env.table,
            Limit: 10,
            ReturnConsumedCapacity: "TOTAL",
          }),
        )) as QueryScanOutput;
        const rows = (out.Items ?? []).map(_unmarshal);
        return {
          status: "success",
          rows,
          row_count: rows.length,
          columns: _inferColumns(rows),
          execution_time_ms: roundTo2(performance.now() - start),
          truncated: false,
        };
      }

      const effectiveLimit = Math.min(
        typeof env.limit === "number" ? env.limit : maxRows + 1,
        maxRows + 1,
      );
      const input: Record<string, unknown> = {
        TableName: env.table,
        Limit: effectiveLimit,
        ReturnConsumedCapacity: "TOTAL",
      };
      if (env.filter !== undefined) {
        input["FilterExpression"] = env.filter.FilterExpression;
        if (env.filter.ExpressionAttributeValues)
          input["ExpressionAttributeValues"] = env.filter.ExpressionAttributeValues;
        if (env.filter.ExpressionAttributeNames)
          input["ExpressionAttributeNames"] = env.filter.ExpressionAttributeNames;
      }
      if (env.op === "query") {
        if (env.keyCondition === undefined) {
          return {
            status: "error",
            error_code: "SQL_ERROR",
            error: "DynamoDriver: 'query' op requires 'keyCondition'",
            execution_time_ms: roundTo2(performance.now() - start),
          };
        }
        input["KeyConditionExpression"] = env.keyCondition.KeyConditionExpression;
        const prevVals =
          (input["ExpressionAttributeValues"] as DynamoItem | undefined) ?? {};
        const prevNames =
          (input["ExpressionAttributeNames"] as Record<string, string> | undefined) ??
          {};
        if (env.keyCondition.ExpressionAttributeValues)
          input["ExpressionAttributeValues"] = {
            ...prevVals,
            ...env.keyCondition.ExpressionAttributeValues,
          };
        if (env.keyCondition.ExpressionAttributeNames)
          input["ExpressionAttributeNames"] = {
            ...prevNames,
            ...env.keyCondition.ExpressionAttributeNames,
          };
      }

      const Cmd = env.op === "query" ? module.QueryCommand : module.ScanCommand;
      const out = (await client.send(new Cmd(input))) as QueryScanOutput;
      let rows = (out.Items ?? []).map(_unmarshal);
      let truncated = false;
      if (rows.length > maxRows) {
        truncated = true;
        rows = rows.slice(0, maxRows);
      }
      return {
        status: "success",
        rows,
        row_count: rows.length,
        columns: _inferColumns(rows),
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
    const handle = (await (conn as Promise<DynamoHandle> | DynamoHandle)) as DynamoHandle;
    const { client, module } = handle;
    try {
      const listed = (await client.send(
        new module.ListTablesCommand({}),
      )) as ListTablesOutput;
      const names = listed.TableNames ?? [];

      const filterRe =
        tableFilter !== null && tableFilter !== undefined
          ? new RegExp(
              "^" +
                tableFilter.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") +
                "$",
            )
          : null;

      const out: Table[] = [];
      for (const name of names) {
        if (filterRe !== null && !filterRe.test(name)) continue;
        const desc = (await client.send(
          new module.DescribeTableCommand({ TableName: name }),
        )) as DescribeTableOutput;
        const table = desc.Table;
        if (table === undefined) continue;

        const attrTypes = new Map<string, string>();
        for (const a of table.AttributeDefinitions ?? []) {
          attrTypes.set(a.AttributeName, _awsAttrType(a.AttributeType));
        }
        const keys = new Set(
          (table.KeySchema ?? []).map((k) => k.AttributeName),
        );
        const columns: Column[] = (table.KeySchema ?? []).map(
          (k) =>
            new Column({
              name: k.AttributeName,
              data_type: attrTypes.get(k.AttributeName) ?? "unknown",
              nullable: false,
              is_primary_key: true,
              default: null,
            }),
        );
        for (const [attrName, attrType] of attrTypes) {
          if (keys.has(attrName)) continue;
          columns.push(
            new Column({
              name: attrName,
              data_type: attrType,
              nullable: true,
              is_primary_key: false,
              default: null,
            }),
          );
        }
        out.push(new Table({ name, schema: schemaName, columns }));
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * No-op: DynamoDB is HTTP-based with a shared client. {@link shutdown}
   * destroys the client at process teardown.
   */
  override close(_conn: unknown): void {
    /* shared client — nothing to release per-handle */
  }

  async closeAsync(_conn: unknown): Promise<void> {
    /* shared client — nothing to release per-handle */
  }

  /** Per-driver health check via `ListTablesCommand` with Limit=1. */
  async healthCheck(conn: unknown): Promise<boolean> {
    try {
      const handle = (await (conn as Promise<DynamoHandle> | DynamoHandle)) as DynamoHandle;
      await handle.client.send(new handle.module.ListTablesCommand({ Limit: 1 }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * G-DB-1: classify a DynamoDB op for the policy gate.
   *
   * Accepts the JSON envelope `{table, op, ...}` consumed by
   * `executeReadAsync`, AWS SDK command names like `PutItemCommand`,
   * and dot-notation `client.send(new PutItemCommand({...}))`. Unknown
   * ops default to DDL.
   */
  override classifyOperation(query: string): OperationType {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      throw new Error("Empty DynamoDB statement");
    }

    let op: string | null = null;

    // Envelope form
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as { op?: unknown };
        if (typeof parsed.op === "string") op = parsed.op;
      } catch (e) {
        // G-DYNAMO-PARSE-ERROR: surfacing malformed envelope JSON as a
        // distinct error stops it from silently falling through to the
        // default-deny "DDL statements are never allowed" path, which
        // misleads callers debugging a hand-authored envelope.
        const msg = e instanceof Error ? e.message : String(e);
        throw new DynamoEnvelopeParseError(
          `Malformed envelope JSON: ${msg}`,
        );
      }
    }

    // SDK form: detect "<Verb>Command" or first identifier
    if (op === null) {
      const cmdMatch = /\b([A-Z][A-Za-z0-9]*Command)\b/.exec(trimmed);
      if (cmdMatch !== null) op = cmdMatch[1] ?? null;
    }
    if (op === null) {
      const wordMatch = /(?:^|\.)([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(trimmed);
      if (wordMatch !== null) op = wordMatch[1] ?? null;
    }

    if (op === null) return OperationType.DDL;

    if (_DYNAMO_READ_OPS.has(op)) return OperationType.READ;
    if (_DYNAMO_DML_OPS.has(op)) return OperationType.DML;
    if (_DYNAMO_DDL_OPS.has(op)) return OperationType.DDL;
    return OperationType.DDL;
  }

  /** Destroy the shared DynamoDBClient. */
  async shutdown(): Promise<void> {
    const client = this._client;
    this._client = null;
    this._clientPromise = null;
    if (client !== null) {
      try {
        client.destroy();
      } catch {
        /* best-effort */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _parseEnvelope(query: string): DynamoQueryEnvelope | null {
  try {
    const parsed = JSON.parse(query) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as DynamoQueryEnvelope).table !== "string" ||
      typeof (parsed as DynamoQueryEnvelope).op !== "string"
    ) {
      return null;
    }
    return parsed as DynamoQueryEnvelope;
  } catch {
    return null;
  }
}

function _unmarshal(item: DynamoItem): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    out[k] = _unmarshalValue(v);
  }
  return out;
}

function _unmarshalValue(v: DynamoAttributeValue): unknown {
  if (v.S !== undefined) return v.S;
  if (v.N !== undefined) {
    const n = Number(v.N);
    return Number.isFinite(n) ? n : v.N;
  }
  if (v.BOOL !== undefined) return v.BOOL;
  if (v.NULL !== undefined) return null;
  if (v.L !== undefined) return v.L.map(_unmarshalValue);
  if (v.M !== undefined) return _unmarshal(v.M);
  return null;
}

function _awsAttrType(t: string): string {
  switch (t) {
    case "S":
      return "string";
    case "N":
      return "number";
    case "B":
      return "binary";
    default:
      return t;
  }
}

function _inferColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
