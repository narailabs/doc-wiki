#!/usr/bin/env node
/**
 * Notion data fetcher for the wiki-notion-agent.
 *
 * Library usage:
 *     import { fetch } from "./notion_fetch.js";
 *     const result = await fetch("search", { query: "architecture", max_results: 25 });
 *
 * Read-only Notion Public API client. Credentials resolve via
 * `resolveSecret` with `env_var` fallback (`NOTION_TOKEN`).
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";
import { NotionClient, extractTitleFromPage, loadNotionCredentials, } from "./lib/notion_client.js";
export const VALID_ACTIONS = new Set([
    "search",
    "get_page",
    "get_database",
    "query_database",
]);
const MAX_RESULTS_DEFAULT = 25;
const MAX_RESULTS_CAP = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_NO_DASH_PATTERN = /^[0-9a-f]{32}$/;
const VALID_FILTER_TYPES = new Set(["page", "database"]);
function toInt(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string") {
        const n = parseInt(value, 10);
        if (Number.isFinite(n))
            return n;
    }
    return fallback;
}
function validateUuid(value, fieldName) {
    const v = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(v) && !UUID_NO_DASH_PATTERN.test(v)) {
        throw new Error(`Invalid ${fieldName} '${value}' — expected UUID format`);
    }
    return v;
}
function validateSearch(params) {
    const queryRaw = params["query"];
    if (!queryRaw || typeof queryRaw !== "string") {
        throw new Error("search requires a non-empty 'query' string");
    }
    const filterTypeRaw = params["filter_type"] ?? "";
    const filterType = typeof filterTypeRaw === "string" ? filterTypeRaw : "";
    if (filterType && !VALID_FILTER_TYPES.has(filterType)) {
        throw new Error(`Invalid filter_type '${filterType}' — expected page or database`);
    }
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return {
        query: queryRaw.trim(),
        filter_type: filterType,
        max_results: maxResults,
    };
}
function validateGetPage(params) {
    const raw = params["page_id"];
    const pageId = validateUuid(typeof raw === "string" ? raw : "", "page_id");
    return { page_id: pageId };
}
function validateGetDatabase(params) {
    const raw = params["database_id"];
    const dbId = validateUuid(typeof raw === "string" ? raw : "", "database_id");
    return { database_id: dbId };
}
function validateQueryDatabase(params) {
    const raw = params["database_id"];
    const dbId = validateUuid(typeof raw === "string" ? raw : "", "database_id");
    const dbFilterRaw = params["filter"];
    let dbFilter = null;
    if (dbFilterRaw !== undefined && dbFilterRaw !== null) {
        if (typeof dbFilterRaw !== "object" || Array.isArray(dbFilterRaw)) {
            throw new Error("'filter' must be a dict (Notion filter object)");
        }
        dbFilter = dbFilterRaw;
    }
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return { database_id: dbId, filter: dbFilter, max_results: maxResults };
}
function errorFromClient(result, action) {
    const codeMap = {
        UNAUTHORIZED: "AUTH_ERROR",
        FORBIDDEN: "AUTH_ERROR",
        NOT_FOUND: "NOT_FOUND",
        RATE_LIMITED: "RATE_LIMITED",
        TIMEOUT: "TIMEOUT",
        NETWORK_ERROR: "CONNECTION_ERROR",
        SERVER_ERROR: "CONNECTION_ERROR",
        BAD_REQUEST: "VALIDATION_ERROR",
        UNPROCESSABLE: "VALIDATION_ERROR",
        INVALID_URL: "VALIDATION_ERROR",
        METHOD_NOT_ALLOWED: "VALIDATION_ERROR",
        HTTP_ERROR: "CONNECTION_ERROR",
    };
    return {
        status: "error",
        action,
        error_code: codeMap[result.code] ?? "CONNECTION_ERROR",
        message: result.message,
        retriable: result.retriable,
    };
}
async function fetchSearch(client, v) {
    const result = await client.search(v.query, v.filter_type || undefined, v.max_results);
    if (!result.ok)
        return errorFromClient(result, "search");
    const results = Array.isArray(result.data.results) ? result.data.results : [];
    return {
        status: "success",
        action: "search",
        data: {
            total: results.length,
            results: results.map((r) => ({
                id: r.id,
                object_type: "last_edited_time" in r && "properties" in r ? "page" : "database",
            })),
        },
        truncated: Boolean(result.data.has_more),
    };
}
async function fetchGetPage(client, v) {
    const result = await client.getPage(v.page_id);
    if (!result.ok)
        return errorFromClient(result, "get_page");
    const page = result.data;
    return {
        status: "success",
        action: "get_page",
        data: {
            id: page.id,
            title: extractTitleFromPage(page),
            parent_type: page.parent?.type ?? "",
            last_edited: page.last_edited_time ?? null,
            properties: page.properties ?? {},
            content_markdown: "",
        },
    };
}
async function fetchGetDatabase(client, v) {
    const result = await client.getDatabase(v.database_id);
    if (!result.ok)
        return errorFromClient(result, "get_database");
    const db = result.data;
    return {
        status: "success",
        action: "get_database",
        data: {
            id: db.id,
            title: (db.title ?? []).map((t) => t.plain_text ?? "").join(""),
            description: (db.description ?? []).map((t) => t.plain_text ?? "").join(""),
            properties: db.properties ?? {},
            is_inline: db.is_inline ?? false,
        },
    };
}
async function fetchQueryDatabase(client, v) {
    const result = await client.queryDatabase(v.database_id, v.filter, v.max_results);
    if (!result.ok)
        return errorFromClient(result, "query_database");
    const results = Array.isArray(result.data.results) ? result.data.results : [];
    return {
        status: "success",
        action: "query_database",
        data: {
            database_id: v.database_id,
            total: results.length,
            results: results.map((r) => ({
                id: r.id,
                title: extractTitleFromPage(r),
                last_edited: r.last_edited_time ?? null,
            })),
        },
        truncated: Boolean(result.data.has_more),
    };
}
function missingCredentialsError(action) {
    return {
        status: "error",
        action,
        error_code: "CONFIG_ERROR",
        message: "Notion credentials not configured. Set NOTION_TOKEN or register a " +
            "credential provider via .claude/agents/lib/credential_providers/.",
        retriable: false,
    };
}
export async function fetch(action, params = null, options = {}) {
    if (!VALID_ACTIONS.has(action)) {
        const sorted = [...VALID_ACTIONS].sort();
        return {
            status: "error",
            error_code: "VALIDATION_ERROR",
            message: `Unknown action '${action}' — expected one of ` +
                `[${sorted.map((s) => `'${s}'`).join(", ")}]`,
        };
    }
    const p = params ?? {};
    let validated;
    try {
        switch (action) {
            case "search":
                validated = validateSearch(p);
                break;
            case "get_page":
                validated = validateGetPage(p);
                break;
            case "get_database":
                validated = validateGetDatabase(p);
                break;
            case "query_database":
                validated = validateQueryDatabase(p);
                break;
            default:
                throw new Error("unreachable");
        }
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "VALIDATION_ERROR",
            message: exc.message,
        };
    }
    let client = options.client;
    if (!client) {
        const opts = options.clientOptions ?? (await loadNotionCredentials());
        if (!opts)
            return missingCredentialsError(action);
        client = new NotionClient(opts);
    }
    try {
        switch (action) {
            case "search":
                return await fetchSearch(client, validated);
            case "get_page":
                return await fetchGetPage(client, validated);
            case "get_database":
                return await fetchGetDatabase(client, validated);
            case "query_database":
                return await fetchQueryDatabase(client, validated);
        }
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "CONNECTION_ERROR",
            message: `Notion API call failed: ${exc.message}`,
        };
    }
    return { status: "error", error_code: "UNKNOWN", message: "Unexpected state" };
}
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
        let name;
        let value;
        if (a.startsWith("--")) {
            const eq = a.indexOf("=");
            if (eq >= 0) {
                name = a.slice(2, eq);
                value = a.slice(eq + 1);
                i++;
            }
            else {
                name = a.slice(2);
                value = argv[i + 1];
                i += 2;
            }
        }
        else {
            throw new Error(`unrecognized argument: ${a}`);
        }
        switch (name) {
            case "action":
                out.action = value ?? "";
                break;
            case "params":
                out.params = value ?? "";
                break;
            default:
                throw new Error(`unrecognized argument: --${name}`);
        }
    }
    return out;
}
const HELP_TEXT = `usage: notion_fetch.js [-h] --action {get_database,get_page,query_database,search} [--params PARAMS]

Fetch data from Notion

options:
  -h, --help            show this help message and exit
  --action {get_database,get_page,query_database,search}
                        Action to perform
  --params PARAMS       JSON string of action parameters
`;
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
    if (!args.action) {
        process.stderr.write("the following arguments are required: --action\n");
        return 2;
    }
    if (!VALID_ACTIONS.has(args.action)) {
        const sorted = [...VALID_ACTIONS].sort();
        process.stderr.write(`argument --action: invalid choice: '${args.action}' (choose from ${sorted.map((s) => `'${s}'`).join(", ")})\n`);
        return 2;
    }
    const paramsRaw = args.params ?? "{}";
    let params;
    try {
        const parsed = JSON.parse(paramsRaw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("params must be a JSON object");
        }
        params = parsed;
    }
    catch (e) {
        const result = {
            status: "error",
            error_code: "VALIDATION_ERROR",
            message: `Invalid JSON in --params: ${e.message}`,
        };
        process.stdout.write(pythonJsonDumps(result, 2, true) + "\n");
        return 1;
    }
    const result = await fetch(args.action, params);
    process.stdout.write(pythonJsonDumps(result, 2, true) + "\n");
    if (result["status"] !== "success") {
        return 1;
    }
    return 0;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    void main().then((code) => process.exit(code));
}
