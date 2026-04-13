#!/usr/bin/env node
/**
 * Confluence data fetcher for the wiki-confluence-agent.
 *
 * Library usage:
 *     import { fetch } from "./confluence_fetch.js";
 *     const result = fetch("cql_search", { cql: "space = DEV AND type = page" });
 *
 * CLI usage:
 *     node confluence_fetch.js --action cql_search --params '{"cql": "space = DEV"}'
 *     node confluence_fetch.js --action get_page --params '{"page_id": "12345678"}'
 *     node confluence_fetch.js --action get_space --params '{"space_key": "DEV"}'
 *
 * This is a TypeScript port of confluence_fetch.py. The HTTP request path
 * is stubbed in the Python reference (commented-out `requests` calls) —
 * this TS port matches that stubbed-out behaviour exactly so the CLI JSON
 * output is byte-identical to the Python version.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";
// ── Constants ───────────────────────────────────────────────────────
export const VALID_ACTIONS = new Set([
    "cql_search",
    "get_page",
    "get_space",
]);
const MAX_RESULTS_DEFAULT = 25;
const MAX_RESULTS_CAP = 500;
const PAGE_ID_PATTERN = /^\d+$/;
const SPACE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,19}$/;
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
function validateCqlSearch(params) {
    const cql = params["cql"];
    if (!cql || typeof cql !== "string") {
        throw new Error("cql_search requires a non-empty 'cql' string");
    }
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return { cql: cql.trim(), max_results: maxResults };
}
function validateGetPage(params) {
    const pageIdRaw = params["page_id"];
    const pageId = pageIdRaw === undefined || pageIdRaw === null
        ? ""
        : String(pageIdRaw);
    if (!PAGE_ID_PATTERN.test(pageId)) {
        throw new Error(`Invalid page_id '${pageId}' — expected numeric ID`);
    }
    const expand = params["expand"] ?? [];
    if (!Array.isArray(expand)) {
        throw new Error("'expand' must be a list of strings");
    }
    return { page_id: pageId, expand };
}
function validateGetSpace(params) {
    const spaceKeyRaw = params["space_key"];
    const spaceKey = typeof spaceKeyRaw === "string" ? spaceKeyRaw : "";
    if (!SPACE_KEY_PATTERN.test(spaceKey)) {
        throw new Error(`Invalid space_key '${spaceKey}' — expected uppercase key like DEV`);
    }
    return { space_key: spaceKey };
}
// ── Handlers (stubbed — match Python placeholders) ──────────────────
function fetchCqlSearch(validated) {
    // PLACEHOLDER: actual Confluence REST API call (see Python reference).
    void validated; // Stubbed response ignores inputs; preserve signature shape.
    return {
        status: "success",
        action: "cql_search",
        data: {
            total: 0,
            pages: [],
        },
        truncated: false,
    };
}
function fetchGetPage(validated) {
    // PLACEHOLDER: actual Confluence REST API call.
    return {
        status: "success",
        action: "get_page",
        data: {
            id: validated.page_id,
            title: "",
            space_key: "",
            version: 0,
            body_markdown: "",
            last_modified: null,
        },
    };
}
function fetchGetSpace(validated) {
    // PLACEHOLDER: actual Confluence REST API call.
    return {
        status: "success",
        action: "get_space",
        data: {
            key: validated.space_key,
            name: "",
            description: "",
            type: "global",
            homepage_id: null,
        },
    };
}
// ── Library API ─────────────────────────────────────────────────────
/**
 * Fetch data from Confluence.
 *
 * @param action One of cql_search, get_page, get_space.
 * @param params Action-specific parameters.
 * @returns Structured result dict with status, action, and data fields.
 */
export function fetch(action, params = null) {
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
    // Validate — matches Python's `except (ValueError, TypeError)` branch.
    let validated;
    try {
        if (action === "cql_search")
            validated = validateCqlSearch(p);
        else if (action === "get_page")
            validated = validateGetPage(p);
        else
            validated = validateGetSpace(p); // action === "get_space"
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "VALIDATION_ERROR",
            message: exc.message,
        };
    }
    // Execute — matches Python's outer `except Exception` branch.
    try {
        if (action === "cql_search") {
            return fetchCqlSearch(validated);
        }
        if (action === "get_page") {
            return fetchGetPage(validated);
        }
        return fetchGetSpace(validated);
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "CONNECTION_ERROR",
            message: `Confluence API call failed: ${exc.message}`,
        };
    }
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
const HELP_TEXT = `usage: confluence_fetch.js [-h] --action {cql_search,get_page,get_space} [--params PARAMS]

Fetch data from Confluence

options:
  -h, --help            show this help message and exit
  --action {cql_search,get_page,get_space}
                        Action to perform
  --params PARAMS       JSON string of action parameters
`;
export function main(argv = process.argv.slice(2)) {
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
    const result = fetch(args.action, params);
    process.stdout.write(pythonJsonDumps(result, 2, true) + "\n");
    if (result["status"] !== "success") {
        return 1;
    }
    return 0;
}
// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
