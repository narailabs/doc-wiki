#!/usr/bin/env node
/**
 * db_query.ts — CLI entry point for the wiki-db-agent.
 *
 * Thin shim over the wiki_db library. Runs a SQL query through the
 * policy gate before execution, emitting structured JSON that matches
 * the AGENT.md contract.
 *
 * Two modes:
 *  - `--sqlite <path>` — direct file connection, used by tests and ad-hoc
 *    SQLite work. No config file required.
 *  - `--env <name>` (G-DB-AGENT-ENV) — read `wiki.config.yaml`, look up
 *    `ecosystem.database.environments[name]`, register the env with
 *    `wiki_db/environments`, and dispatch through `connection.getConnection`.
 *    All six shipped drivers (postgresql, mysql, sqlite, sqlserver, mongodb,
 *    dynamodb) are wired automatically because `drivers/register` is
 *    side-effect-imported at the top of this file. Approval mode and grant
 *    duration come from the env's config.
 *
 * CLI usage:
 *   node db_query.js --sqlite <file> --sql "<sql>" [options]
 *   node db_query.js --env <name> --sql "<sql>" [--config wiki.config.yaml] [options]
 *
 *   options: --approval-mode <mode>  (overrides env's approval_mode)
 *            --max-rows <N>          (default 1000)
 *            --timeout-ms <N>        (default 30000)
 *            --action query|schema   (default query)
 *            --filter <pattern>      (for --action schema)
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Policy } from "../../lib/wiki_db/policy.js";
import { executeQuery, } from "../../lib/wiki_db/query.js";
import { SQLiteDriver } from "../../lib/wiki_db/drivers/sqlite.js";
import { formatErDiagram, } from "../../lib/mermaid_format.js";
import { parseConfig } from "../../../skills/wiki/scripts/parse_config.js";
import { registerEnvironment, clearEnvironments, } from "../../lib/wiki_db/environments.js";
import { getConnection, releaseConnection, } from "../../lib/wiki_db/connection.js";
import { enableAudit, logEvent } from "../../lib/wiki_db/audit.js";
import * as os from "node:os";
// Side-effect import: wires every shipped driver into the connection-pool
// registry so `--env` lookups resolve regardless of which driver is named
// in `wiki.config.yaml → ecosystem.database.environments[name].driver`.
import { registerAll } from "../../lib/wiki_db/drivers/register.js";
registerAll();
function parseArgs(argv) {
    const out = {};
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a === undefined) {
            i++;
            continue;
        }
        if (a === "-h" || a === "--help") {
            out.help = true;
            i++;
            continue;
        }
        if (!a.startsWith("--")) {
            throw new Error(`unrecognized argument: ${a}`);
        }
        const eq = a.indexOf("=");
        const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
        const value = eq >= 0 ? a.slice(eq + 1) : argv[i + 1];
        i = eq >= 0 ? i + 1 : i + 2;
        switch (name) {
            case "sqlite":
                out.sqlite = value ?? "";
                break;
            case "env":
                out.env = value ?? "";
                break;
            case "config":
                out.config = value ?? "";
                break;
            case "sql":
                out.sql = value ?? "";
                break;
            case "approval-mode":
                out.approvalMode = value ?? "";
                break;
            case "max-rows":
                out.maxRows = Number(value);
                break;
            case "timeout-ms":
                out.timeoutMs = Number(value);
                break;
            case "action":
                if (value !== "query" && value !== "schema") {
                    throw new Error(`--action must be 'query' or 'schema', got: ${value ?? ""}`);
                }
                out.action = value;
                break;
            case "filter":
                out.filter = value ?? "";
                break;
            default:
                throw new Error(`unrecognized argument: --${name}`);
        }
    }
    return out;
}
const HELP_TEXT = `usage: db_query.js (--sqlite FILE | --env NAME) --sql "<sql>" [options]

Execute a read query through the guard-rail policy gate.

connection (pick one):
  --sqlite FILE              SQLite database file (use ':memory:' for in-memory)
  --env NAME                 Named environment from wiki.config.yaml
                             (ecosystem.database.environments.<NAME>)
  --config PATH              Path to wiki.config.yaml (default: ./wiki.config.yaml)

query options:
  --sql "SQL"                SQL/Mongo/Dynamo statement (required for --action query)
  --approval-mode MODE       auto | confirm_once | confirm_each | grant_required
                             (default: read from env config; falls back to 'auto')
  --max-rows N               Row cap (default: 1000)
  --timeout-ms N             Query timeout (default: 30000)
  --action ACTION            query (default) or schema
  --filter PATTERN           For --action schema: table-name filter (e.g. 'user%')
  -h, --help                 Show this help and exit

Output is JSON matching the wiki-db-agent AGENT.md contract. Writes
(INSERT/UPDATE/DELETE / Mongo writes / Dynamo PutItem etc.) are never
executed — the policy gate returns status=present_only with a
formatted_sql payload instead. DDL and privilege statements return
status=denied.
`;
function adaptDriver(driver, conn) {
    return {
        execute(sql, kwargs) {
            const result = driver.executeRead(conn, sql, kwargs.params ?? null, kwargs.max_rows ?? 1000, kwargs.timeout_ms ?? 30000);
            if (result.status === "error") {
                throw new Error(`${result.error_code ?? "SQL_ERROR"}: ${result.error ?? "unknown driver error"}`);
            }
            return {
                rows: result.rows ?? [],
                columns: result.columns ?? [],
            };
        },
    };
}
/**
 * Build an ER-diagram `mermaid` block from a list of Tables. Returns
 * null when the schema is empty — per v2 §6, agents omit the `mermaid`
 * field entirely when the data is not diagram-worthy (the caller
 * splices `null` into the JSON conditionally).
 */
function schemaToMermaid(tables) {
    if (tables.length === 0)
        return null;
    const ermTables = tables.map((t) => {
        const cols = t.columns.map((c) => ({
            name: c.name,
            type: c.data_type || "string",
            key: c.is_primary_key ? "PK" : undefined,
        }));
        return { name: t.name, columns: cols };
    });
    return formatErDiagram("Database Schema", ermTables, []);
}
function runSchema(driver, conn, filter, envName = "") {
    try {
        const tables = driver.getSchema(conn, undefined, filter);
        // A5: emit `schema_inspect` BEFORE returning the result so the audit
        // log captures the introspection even when the caller bypasses
        // SchemaManager (this CLI path always does, since runSchema talks to
        // the driver directly). Payload mirrors the SchemaManager event
        // shape: env / table_filter / column_count.
        let columnCount = 0;
        for (const t of tables)
            columnCount += t.columns.length;
        logEvent({
            event_type: "schema_inspect",
            details: {
                env: envName,
                table_filter: filter,
                column_count: columnCount,
            },
        });
        const result = {
            status: "ok",
            tables: tables.map((t) => t.toDict()),
            table_count: tables.length,
        };
        const mermaid = schemaToMermaid(tables);
        if (mermaid !== null)
            result["mermaid"] = mermaid;
        return result;
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "SCHEMA_ERROR",
            error: exc.message,
        };
    }
}
/**
 * Expand `~` in a path to the user's home dir so audit paths from YAML work
 * regardless of how the user wrote them. Keeps relative paths relative so
 * fixtures that use "./audit.jsonl" still land next to the config.
 */
function _expandUser(p) {
    if (p.startsWith("~/"))
        return path.join(os.homedir(), p.slice(2));
    if (p === "~")
        return os.homedir();
    return p;
}
function resolveEnv(envName, configPath) {
    const cfg = parseConfig(configPath);
    const ecosystem = cfg["ecosystem"];
    const database = ecosystem?.["database"];
    // Wire the audit sink from `ecosystem.database.audit.{enabled, path}`.
    // Earlier iterations of the CLI never honoured this block, which meant
    // the audit-event assertions on DENY and PRESENT_ONLY paths in the db
    // eval suite passed only vacuously. Doing the wire-up here, before the
    // query executes, means every policy_eval / policy_deny / query
    // event that the library emits lands in the audit file the config named.
    const auditCfg = database?.["audit"];
    if (auditCfg !== undefined &&
        auditCfg["enabled"] === true &&
        typeof auditCfg["path"] === "string" &&
        auditCfg["path"].length > 0) {
        const rawPath = _expandUser(auditCfg["path"]);
        // Relative paths resolve relative to the config file, which is what
        // fixtures (./audit.jsonl) and wiki roots (log/audit.jsonl) expect.
        const auditPath = path.isAbsolute(rawPath)
            ? rawPath
            : path.resolve(path.dirname(configPath), rawPath);
        enableAudit(auditPath);
    }
    const rawEnvs = database?.["environments"];
    const envs = rawEnvs !== null && rawEnvs !== undefined && typeof rawEnvs === "object"
        ? rawEnvs
        : undefined;
    if (envs === undefined || !Object.prototype.hasOwnProperty.call(envs, envName)) {
        throw new Error(`environment '${envName}' not found in ${configPath} ` +
            "(ecosystem.database.environments)");
    }
    const e = envs[envName];
    const driverFromEnv = typeof e["driver"] === "string" ? e["driver"] : undefined;
    const driverFromDb = typeof database?.["driver"] === "string" ? database["driver"] : undefined;
    const driver = driverFromEnv ?? driverFromDb;
    if (driver === undefined) {
        throw new Error(`environment '${envName}' has no 'driver' field, and ecosystem.database.driver is unset`);
    }
    // Two valid-value vocabularies exist in the codebase:
    //   environments.ts wants kebab-case: auto | confirm-once | confirm-each | grant-required
    //   policy.ts       wants snake_case: auto | confirm_once | confirm_each | grant_required
    // v2 YAML (per the design report) uses snake_case. Accept either and
    // translate both directions.
    const rawMode = typeof e["approval_mode"] === "string"
        ? e["approval_mode"]
        : "auto";
    const kebabMode = rawMode.replace(/_/g, "-"); // for environments.ts
    const snakeMode = rawMode.replace(/-/g, "_"); // for policy.ts
    const grant_duration_hours = typeof e["grant_duration_hours"] === "number"
        ? e["grant_duration_hours"]
        : undefined;
    registerEnvironment(envName, {
        host: typeof e["host"] === "string" ? e["host"] : "",
        port: typeof e["port"] === "number" ? e["port"] : 0,
        database: typeof e["database"] === "string" ? e["database"] : "",
        schema: typeof e["schema"] === "string" ? e["schema"] : "public",
        approval_mode: kebabMode,
        driver,
        grant_duration_hours,
    });
    return {
        name: envName,
        driver,
        approval_mode: snakeMode,
        grant_duration_hours,
    };
}
export async function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArgs(argv);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (args.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (args.sqlite === undefined && args.env === undefined) {
        process.stderr.write("required: --sqlite <path-or-:memory:> or --env <name>\n");
        return 2;
    }
    if (args.sqlite !== undefined && args.env !== undefined) {
        process.stderr.write("--sqlite and --env are mutually exclusive\n");
        return 2;
    }
    const action = args.action ?? "query";
    if (action === "query" && !args.sql) {
        process.stderr.write("required for --action query: --sql \"<sql>\"\n");
        return 2;
    }
    if (args.sqlite !== undefined) {
        return runWithSqlite(args, action);
    }
    return runWithEnv(args, action);
}
async function runWithSqlite(args, action) {
    const driver = new SQLiteDriver();
    const conn = driver.connect({ database: args.sqlite });
    try {
        return await runOnDriver(driver, conn, args, action);
    }
    finally {
        driver.close(conn);
    }
}
async function runWithEnv(args, action) {
    const configPath = args.config ?? "./wiki.config.yaml";
    let resolved;
    try {
        resolved = resolveEnv(args.env, configPath);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    let conn;
    try {
        conn = getConnection(resolved.name);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        clearEnvironments();
        return 1;
    }
    try {
        return await runOnDriver(conn.driver, conn.native, args, action, resolved);
    }
    finally {
        releaseConnection(resolved.name, conn);
        clearEnvironments();
    }
}
async function runOnDriver(driver, conn, args, action, envCtx) {
    if (action === "schema") {
        const result = runSchema(driver, conn, args.filter ?? null, envCtx?.name ?? "");
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return result["status"] === "ok" ? 0 : 1;
    }
    const approvalMode = args.approvalMode ?? envCtx?.approval_mode ?? "auto";
    let policy;
    try {
        policy = new Policy(approvalMode);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    const queryableDriver = adaptDriver(driver, conn);
    const result = await executeQuery(queryableDriver, args.sql, policy, {
        max_rows: args.maxRows,
        timeout_ms: args.timeoutMs,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result["status"] === "ok" || result["status"] === "present_only"
        ? 0
        : 1;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    main().then((code) => process.exit(code), (e) => {
        process.stderr.write(`${e.message}\n`);
        process.exit(1);
    });
}
