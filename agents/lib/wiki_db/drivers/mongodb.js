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
import { Column, DatabaseDriver, Table, } from "./base.js";
import { OperationType } from "../policy.js";
/**
 * G-DB-1: MongoDB verb → OperationType mapping.
 *
 * READ: collection-reading verbs the driver actually supports here, plus
 * `count`/`distinct`/`estimatedDocumentCount` which the spec considers
 * read-only. DML: write verbs (insert/update/delete/replace/findAndModify
 * variants + bulk). DDL: collection/index lifecycle. Unknown verbs
 * default to DDL (most restrictive).
 */
const _MONGO_READ_OPS = new Set([
    "find", "findOne", "aggregate", "count", "countDocuments",
    "estimatedDocumentCount", "distinct",
]);
const _MONGO_DML_OPS = new Set([
    "insertOne", "insertMany", "updateOne", "updateMany",
    "replaceOne", "deleteOne", "deleteMany", "bulkWrite",
    "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete",
]);
const _MONGO_DDL_OPS = new Set([
    "createCollection", "drop", "dropCollection", "renameCollection",
    "createIndex", "createIndexes", "dropIndex", "dropIndexes",
]);
const READ_ONLY_OPS = new Set(["find", "aggregate", "count"]);
export class MongoDriver extends DatabaseDriver {
    _mongoModule = null;
    _client = null;
    _clientPromise = null;
    _database = "";
    async _loadMongo() {
        if (this._mongoModule !== null)
            return this._mongoModule;
        try {
            const mod = (await import("mongodb"));
            this._mongoModule =
                "MongoClient" in mod
                    ? mod
                    : mod.default;
            return this._mongoModule;
        }
        catch (e) {
            throw new Error(`Driver 'mongodb' requires 'mongodb' — run: npm install mongodb (${e.message})`);
        }
    }
    _ensureClient(envConfig) {
        if (this._client !== null)
            return Promise.resolve(this._client);
        if (this._clientPromise !== null)
            return this._clientPromise;
        this._clientPromise = this._loadMongo().then(async (mongo) => {
            const uri = typeof envConfig["uri"] === "string"
                ? envConfig["uri"]
                : _buildUri(envConfig);
            this._database =
                typeof envConfig["database"] === "string" ? envConfig["database"] : "";
            const opts = {
                readPreference: "secondaryPreferred",
                maxPoolSize: typeof envConfig["pool_max"] === "number"
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
    connect(envConfig) {
        return this._ensureClient(envConfig).then((client) => {
            const db = client.db(this._database.length > 0 ? this._database : undefined);
            return { db, database: this._database };
        });
    }
    executeRead(_conn, _query, _params = null, _maxRows = 1000, _timeoutMs = 30_000) {
        return {
            status: "error",
            error_code: "SYNC_UNSUPPORTED",
            error: "MongoDriver.executeRead is async — call executeReadAsync() instead.",
            execution_time_ms: 0,
        };
    }
    async executeReadAsync(conn, query, _params = null, maxRows = 1000, _timeoutMs = 30_000) {
        const handle = (await conn);
        const start = performance.now();
        try {
            const env = _parseEnvelope(query);
            if (env === null) {
                return {
                    status: "error",
                    error_code: "SQL_ERROR",
                    error: "MongoDriver: query must be a JSON envelope {collection, op, ...}",
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
            let cursor;
            if (env.op === "find") {
                cursor = coll.find(env.filter ?? {});
                if (env.projection)
                    cursor = cursor.project(env.projection);
                if (env.sort)
                    cursor = cursor.sort(env.sort);
                cursor = cursor.limit(maxRows + 1);
            }
            else {
                const pipeline = env.pipeline ?? [];
                cursor = coll.aggregate([
                    ...pipeline,
                    { $limit: maxRows + 1 },
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
        }
        catch (e) {
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
        try {
            const colls = await handle.db.listCollections().toArray();
            const filtered = colls.filter((c) => {
                if (tableFilter === null || tableFilter === undefined)
                    return true;
                const pattern = new RegExp("^" +
                    tableFilter.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") +
                    "$");
                return pattern.test(c.name);
            });
            // Sample all collections in parallel — each .toArray() is a round-trip,
            // so for an N-collection DB this trims latency from N×rtt to ~1×rtt.
            const samples = await Promise.all(filtered.map((c) => handle.db.collection(c.name).find({}, {}).limit(50).toArray()));
            const out = [];
            for (let i = 0; i < filtered.length; i++) {
                const c = filtered[i];
                const sample = samples[i];
                const keyTypes = new Map();
                for (const doc of sample) {
                    for (const k of Object.keys(doc)) {
                        if (!keyTypes.has(k) && doc[k] !== null && doc[k] !== undefined) {
                            keyTypes.set(k, _mongoType(doc[k]));
                        }
                        else if (!keyTypes.has(k)) {
                            keyTypes.set(k, "null");
                        }
                    }
                }
                const columns = [...keyTypes.entries()].map(([name, type]) => new Column({
                    name,
                    data_type: type,
                    nullable: name !== "_id",
                    is_primary_key: name === "_id",
                    default: null,
                }));
                out.push(new Table({
                    name: c.name,
                    schema: schemaName.length > 0 ? schemaName : handle.database,
                    columns,
                }));
            }
            return out;
        }
        catch {
            return [];
        }
    }
    /**
     * No-op: the MongoClient is the pool and is shared across handles.
     * {@link shutdown} closes the client at process teardown.
     */
    close(_conn) {
        /* pool is shared — nothing to release per-handle */
    }
    async closeAsync(_conn) {
        /* pool is shared — nothing to release per-handle */
    }
    /** Per-driver health check via MongoDB's `ping` command. */
    async healthCheck(conn) {
        try {
            const handle = (await conn);
            const res = await handle.db.command({ ping: 1 });
            return Number(res["ok"]) === 1;
        }
        catch {
            return false;
        }
    }
    /**
     * G-DB-1: classify a Mongo query for the policy gate.
     *
     * Accepts either a JSON envelope `{collection, op, ...}` (the format
     * this driver's `executeReadAsync` consumes) or a free-form mongo
     * statement like `db.users.insertOne({...})`. The verb is extracted
     * and looked up in the read/dml/ddl tables. Anything not recognized
     * defaults to DDL — same default-deny behaviour as the SQL classifier.
     */
    classifyOperation(query) {
        const trimmed = query.trim();
        if (trimmed.length === 0) {
            throw new Error("Empty MongoDB statement");
        }
        let op = null;
        // Envelope form: {"collection": "...", "op": "..."}
        if (trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (typeof parsed.op === "string")
                    op = parsed.op;
            }
            catch {
                /* fall through to dot-notation parse */
            }
        }
        // Dot-notation form: db.<collection>.<verb>(...)
        if (op === null) {
            const match = /(?:^|\.)([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(trimmed);
            if (match !== null)
                op = match[1] ?? null;
        }
        if (op === null)
            return OperationType.DDL;
        if (_MONGO_READ_OPS.has(op))
            return OperationType.READ;
        if (_MONGO_DML_OPS.has(op))
            return OperationType.DML;
        if (_MONGO_DDL_OPS.has(op))
            return OperationType.DDL;
        return OperationType.DDL;
    }
    /** Close the shared MongoClient. */
    async shutdown() {
        const client = this._client;
        this._client = null;
        this._clientPromise = null;
        if (client !== null) {
            try {
                await client.close();
            }
            catch {
                /* best-effort */
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _buildUri(envConfig) {
    const host = typeof envConfig["host"] === "string" ? envConfig["host"] : "localhost";
    const port = typeof envConfig["port"] === "number" ? envConfig["port"] : 27017;
    const user = typeof envConfig["user"] === "string" ? envConfig["user"] : "";
    const password = typeof envConfig["password"] === "string" ? envConfig["password"] : "";
    const authPart = user.length > 0 && password.length > 0
        ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
        : "";
    return `mongodb://${authPart}${host}:${port}`;
}
function _parseEnvelope(query) {
    try {
        const parsed = JSON.parse(query);
        if (parsed === null ||
            typeof parsed !== "object" ||
            typeof parsed.collection !== "string" ||
            typeof parsed.op !== "string") {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function _mongoType(v) {
    if (v === null)
        return "null";
    if (Array.isArray(v))
        return "array";
    const t = typeof v;
    if (t === "object") {
        const ctor = v?.constructor?.name;
        if (ctor === "ObjectId")
            return "objectId";
        if (ctor === "Date")
            return "date";
        return "object";
    }
    return t;
}
function _inferColumns(rows) {
    const seen = new Set();
    for (const r of rows)
        for (const k of Object.keys(r))
            seen.add(k);
    return [...seen];
}
function roundTo2(n) {
    return Math.round(n * 100) / 100;
}
