#!/usr/bin/env node
/**
 * db_query.ts — CLI entry point for the wiki-db-agent.
 *
 * Thin shim over the wiki_db library. Runs a SQL query through the
 * policy gate before execution, emitting structured JSON that matches
 * the AGENT.md contract.
 *
 * Currently supports direct SQLite connections via `--sqlite <path>`.
 * Environment-based dispatch (--env, reading from wiki.config.yaml) is
 * planned alongside the non-SQLite driver expansion and may be extended
 * here without changing the JSON output shape.
 *
 * CLI usage:
 *   node db_query.js --sqlite <file> --sql "<sql>" [--approval-mode <mode>]
 *                    [--max-rows <N>] [--timeout-ms <N>] [--action query|schema]
 *                    [--filter <pattern>]
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Policy } from "../../lib/wiki_db/policy.js";
import { executeQuery, } from "../../lib/wiki_db/query.js";
import { SQLiteDriver } from "../../lib/wiki_db/drivers/sqlite.js";
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
const HELP_TEXT = `usage: db_query.js --sqlite <file> --sql "<sql>" [options]

Execute a read query through the guard-rail policy gate.

options:
  --sqlite FILE              SQLite database file (use ':memory:' for in-memory)
  --sql "SQL"                SQL statement to execute (required for --action query)
  --approval-mode MODE       auto | confirm_once | confirm_each | grant_required (default: auto)
  --max-rows N               Row cap (default: 1000)
  --timeout-ms N             Query timeout (default: 30000)
  --action ACTION            query (default) or schema
  --filter PATTERN           For --action schema: table-name filter (e.g. 'user%')
  -h, --help                 Show this help and exit

Output is JSON matching the wiki-db-agent AGENT.md contract. Writes
(INSERT/UPDATE/DELETE) are never executed — the policy gate returns
status=present_only with a formatted_sql payload instead. DDL and
privilege statements return status=denied.
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
function runSchema(driver, conn, filter) {
    try {
        const tables = driver.getSchema(conn, undefined, filter);
        return {
            status: "ok",
            tables: tables.map((t) => t.toDict()),
            table_count: tables.length,
        };
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "SCHEMA_ERROR",
            error: exc.message,
        };
    }
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
    if (args.sqlite === undefined) {
        process.stderr.write("required: --sqlite <path-or-:memory:>\n");
        return 2;
    }
    const action = args.action ?? "query";
    if (action === "query" && !args.sql) {
        process.stderr.write("required for --action query: --sql \"<sql>\"\n");
        return 2;
    }
    const driver = new SQLiteDriver();
    const conn = driver.connect({ database: args.sqlite });
    try {
        if (action === "schema") {
            const result = runSchema(driver, conn, args.filter ?? null);
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
            return result["status"] === "ok" ? 0 : 1;
        }
        const approvalMode = args.approvalMode ?? "auto";
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
    finally {
        driver.close(conn);
    }
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    main().then((code) => process.exit(code), (e) => {
        process.stderr.write(`${e.message}\n`);
        process.exit(1);
    });
}
