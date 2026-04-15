#!/usr/bin/env node
/**
 * Confluence data fetcher for the wiki-confluence-agent.
 *
 * Library usage:
 *     import { fetch } from "./confluence_fetch.js";
 *     const result = await fetch("cql_search", { cql: "space = DEV AND type = page" });
 *
 * CLI usage:
 *     node confluence_fetch.js --action cql_search --params '{"cql": "space = DEV"}'
 *     node confluence_fetch.js --action get_page --params '{"page_id": "12345678"}'
 *     node confluence_fetch.js --action get_space --params '{"space_key": "DEV"}'
 *
 * Read-only Atlassian Confluence client. Credentials resolve via
 * `resolveSecret` with `env_var` fallback (`CONFLUENCE_SITE_URL`,
 * `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`). Falls back to a stubbed
 * response when credentials are unavailable so offline runs stay green.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfluenceClient, loadConfluenceCredentials, } from "./lib/confluence_client.js";
import { formatGraph, } from "../../lib/mermaid_format.js";
import { parseAgentArgs, } from "../../lib/_agent_cli.js";
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
    const pageId = pageIdRaw === undefined || pageIdRaw === null ? "" : String(pageIdRaw);
    if (!PAGE_ID_PATTERN.test(pageId)) {
        throw new Error(`Invalid page_id '${pageId}' — expected numeric ID`);
    }
    const expand = params["expand"] ?? [];
    if (!Array.isArray(expand) || !expand.every((x) => typeof x === "string")) {
        throw new Error("'expand' must be a list of strings");
    }
    return { page_id: pageId, expand: expand };
}
function validateGetSpace(params) {
    const spaceKeyRaw = params["space_key"];
    const spaceKey = typeof spaceKeyRaw === "string" ? spaceKeyRaw : "";
    if (!SPACE_KEY_PATTERN.test(spaceKey)) {
        throw new Error(`Invalid space_key '${spaceKey}' — expected uppercase key like DEV`);
    }
    return { space_key: spaceKey };
}
function errorFromClient(result, action) {
    const codeMap = {
        UNAUTHORIZED: "AUTH_ERROR",
        NOT_FOUND: "NOT_FOUND",
        RATE_LIMITED: "RATE_LIMITED",
        TIMEOUT: "TIMEOUT",
        NETWORK_ERROR: "CONNECTION_ERROR",
        SERVER_ERROR: "CONNECTION_ERROR",
        BAD_REQUEST: "VALIDATION_ERROR",
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
async function fetchCqlSearch(client, validated) {
    const result = await client.searchCql(validated.cql, validated.max_results);
    if (!result.ok)
        return errorFromClient(result, "cql_search");
    const results = Array.isArray(result.data.results) ? result.data.results : [];
    const total = result.data.totalSize ?? results.length;
    return {
        status: "success",
        action: "cql_search",
        data: {
            total,
            pages: results.map((p) => ({
                id: p.id,
                title: p.title ?? "",
                space_key: p.space?.key ?? "",
                version: p.version?.number ?? 0,
                last_modified: p.version?.when ?? null,
            })),
        },
        truncated: results.length >= validated.max_results && total > results.length,
    };
}
async function fetchGetPage(client, validated) {
    const expand = validated.expand.length > 0
        ? validated.expand
        : ["body.storage", "space", "version"];
    const result = await client.getContent(validated.page_id, expand);
    if (!result.ok)
        return errorFromClient(result, "get_page");
    const data = result.data;
    return {
        status: "success",
        action: "get_page",
        data: {
            id: data.id,
            title: data.title ?? "",
            space_key: data.space?.key ?? "",
            version: data.version?.number ?? 0,
            body_markdown: data.body?.storage?.value ?? "",
            last_modified: data.version?.when ?? null,
        },
    };
}
async function fetchGetSpace(client, validated) {
    const result = await client.getSpace(validated.space_key);
    if (!result.ok)
        return errorFromClient(result, "get_space");
    const data = result.data;
    return {
        status: "success",
        action: "get_space",
        data: {
            key: data.key,
            name: data.name ?? "",
            description: data.description?.plain?.value ?? "",
            type: data.type ?? "global",
            homepage_id: data.homepage?.id ?? null,
        },
    };
}
/**
 * G-AGENT-MERMAID: build a page-hierarchy `graph TD` from a result.
 *
 * Returns `undefined` when the action isn't diagram-worthy (`get_space`
 * has no page tree to show) or when there are no pages to draw. Callers
 * splice the field into the JSON conditionally so the OUTPUT contract
 * stays `mermaid?: MermaidBlock`.
 *
 * - `cql_search`: root = space key (or "Results" if mixed spaces),
 *   children = the returned pages.
 * - `get_page`: root = space key → single page node.
 */
function mermaidForConfluence(result) {
    if (result["status"] !== "success")
        return undefined;
    const action = result["action"];
    const data = result["data"];
    if (data === undefined)
        return undefined;
    if (action === "cql_search") {
        const pages = data["pages"] ?? [];
        if (pages.length === 0)
            return undefined;
        // Group by space key so multi-space searches get one root per space.
        const spaceKeys = new Set(pages
            .map((p) => p["space_key"] ?? "")
            .filter((k) => k.length > 0));
        const nodes = [];
        const edges = [];
        // Cap to keep the diagram legible; large searches get a summary root.
        const capped = pages.slice(0, 30);
        if (spaceKeys.size <= 1) {
            const root = [...spaceKeys][0] ?? "Results";
            nodes.push({ id: "space", label: root, shape: "rounded" });
            for (const [i, p] of capped.entries()) {
                const title = (p["title"] ?? `page ${i}`)
                    .slice(0, 60);
                nodes.push({ id: `p${i}`, label: title });
                edges.push({ from: "space", to: `p${i}` });
            }
        }
        else {
            // Multi-space: group pages under per-space roots.
            const spaceIdx = new Map();
            let si = 0;
            for (const k of spaceKeys) {
                const id = `s${si++}`;
                spaceIdx.set(k, id);
                nodes.push({ id, label: k, shape: "rounded" });
            }
            for (const [i, p] of capped.entries()) {
                const key = p["space_key"] ?? "";
                const parent = spaceIdx.get(key);
                if (parent === undefined)
                    continue;
                const title = (p["title"] ?? `page ${i}`)
                    .slice(0, 60);
                nodes.push({ id: `p${i}`, label: title });
                edges.push({ from: parent, to: `p${i}` });
            }
        }
        return formatGraph("TB", "Page Hierarchy", nodes, edges);
    }
    if (action === "get_page") {
        const spaceKey = data["space_key"] ?? "";
        const title = (data["title"] ?? "page").slice(0, 60);
        if (title.length === 0)
            return undefined;
        const nodes = [];
        const edges = [];
        if (spaceKey.length > 0) {
            nodes.push({ id: "space", label: spaceKey, shape: "rounded" });
            nodes.push({ id: "page", label: title });
            edges.push({ from: "space", to: "page" });
        }
        else {
            nodes.push({ id: "page", label: title });
        }
        return formatGraph("TB", "Page Hierarchy", nodes, edges);
    }
    return undefined;
}
function decorateResult(result) {
    const mermaid = mermaidForConfluence(result);
    if (mermaid === undefined)
        return result;
    return { ...result, mermaid };
}
function missingCredentialsError(action) {
    return {
        status: "error",
        action,
        error_code: "CONFIG_ERROR",
        message: "Confluence credentials not configured. Set CONFLUENCE_SITE_URL, " +
            "CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN (or register a credential " +
            "provider via .claude/agents/lib/credential_providers/).",
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
        if (action === "cql_search")
            validated = validateCqlSearch(p);
        else if (action === "get_page")
            validated = validateGetPage(p);
        else
            validated = validateGetSpace(p);
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
        const opts = options.clientOptions ?? (await loadConfluenceCredentials());
        if (!opts) {
            return missingCredentialsError(action);
        }
        client = new ConfluenceClient(opts);
    }
    try {
        let result;
        if (action === "cql_search") {
            result = await fetchCqlSearch(client, validated);
        }
        else if (action === "get_page") {
            result = await fetchGetPage(client, validated);
        }
        else {
            result = await fetchGetSpace(client, validated);
        }
        return decorateResult(result);
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "CONNECTION_ERROR",
            message: `Confluence API call failed: ${exc.message}`,
        };
    }
}
const parseArgs = (argv) => parseAgentArgs(argv, { flags: ["action", "params"] });
const HELP_TEXT = `usage: confluence_fetch.js [-h] --action {cql_search,get_page,get_space} [--params PARAMS]

Fetch data from Confluence

options:
  -h, --help            show this help message and exit
  --action {cql_search,get_page,get_space}
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
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return 1;
    }
    const result = await fetch(args.action, params);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result["status"] !== "success") {
        return 1;
    }
    return 0;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    void main().then((code) => process.exit(code));
}
