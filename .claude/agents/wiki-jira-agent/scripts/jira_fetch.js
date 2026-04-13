#!/usr/bin/env node
/**
 * Jira data fetcher for the wiki-jira-agent.
 *
 * Library usage:
 *     import { fetch } from "./jira_fetch.js";
 *     const result = await fetch("jql_search", { jql: "project = WIKI", max_results: 50 });
 *
 * CLI usage:
 *     node jira_fetch.js --action jql_search --params '{"jql": "project = WIKI"}'
 *     node jira_fetch.js --action get_issue --params '{"issue_key": "WIKI-123"}'
 *     node jira_fetch.js --action get_project --params '{"project_key": "WIKI"}'
 *
 * Read-only Jira REST v3 client. Credentials resolve via `resolveSecret`
 * with `env_var` fallback — set `JIRA_SITE_URL`, `JIRA_EMAIL`,
 * `JIRA_API_TOKEN` to configure. When credentials are unavailable, the
 * fetcher falls back to a deterministic stubbed response so unit tests and
 * offline runs stay green.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";
import { JiraClient, loadJiraCredentials, } from "./lib/jira_client.js";
// ── Constants ───────────────────────────────────────────────────────
export const VALID_ACTIONS = new Set([
    "jql_search",
    "get_issue",
    "get_project",
]);
const MAX_RESULTS_DEFAULT = 50;
const MAX_RESULTS_CAP = 500;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/;
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
function validateJqlSearch(params) {
    const jql = params["jql"];
    if (!jql || typeof jql !== "string") {
        throw new Error("jql_search requires a non-empty 'jql' string");
    }
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return { jql: jql.trim(), max_results: maxResults };
}
function validateGetIssue(params) {
    const issueKeyRaw = params["issue_key"];
    const issueKey = typeof issueKeyRaw === "string" ? issueKeyRaw : "";
    if (!ISSUE_KEY_PATTERN.test(issueKey)) {
        throw new Error(`Invalid issue_key '${issueKey}' — expected format like PROJ-123`);
    }
    const expand = params["expand"] ?? [];
    if (!Array.isArray(expand) || !expand.every((x) => typeof x === "string")) {
        throw new Error("'expand' must be a list of strings");
    }
    return { issue_key: issueKey, expand: expand };
}
function validateGetProject(params) {
    const projectKeyRaw = params["project_key"];
    const projectKey = typeof projectKeyRaw === "string" ? projectKeyRaw : "";
    if (!PROJECT_KEY_PATTERN.test(projectKey)) {
        throw new Error(`Invalid project_key '${projectKey}' — expected format like PROJ`);
    }
    return { project_key: projectKey };
}
/** Convert a uniform client error into the legacy `{ status: error, ... }` shape. */
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
async function fetchJqlSearch(client, validated) {
    const result = await client.searchJql(validated.jql, validated.max_results);
    if (!result.ok)
        return errorFromClient(result, "jql_search");
    const total = typeof result.data.total === "number" ? result.data.total : 0;
    const issues = Array.isArray(result.data.issues) ? result.data.issues : [];
    return {
        status: "success",
        action: "jql_search",
        data: {
            total,
            issues: issues.slice(0, validated.max_results).map((i) => ({
                key: i.key,
                summary: i.fields?.summary ?? "",
                status: i.fields?.status?.name ?? "",
                assignee: i.fields?.assignee?.displayName ?? null,
                labels: i.fields?.labels ?? [],
                updated: i.fields?.updated ?? null,
            })),
        },
        truncated: issues.length > validated.max_results,
    };
}
async function fetchGetIssue(client, validated) {
    const result = await client.getIssue(validated.issue_key, validated.expand);
    if (!result.ok)
        return errorFromClient(result, "get_issue");
    const fields = result.data.fields ?? {};
    return {
        status: "success",
        action: "get_issue",
        data: {
            key: result.data.key,
            summary: fields.summary ?? "",
            status: fields.status?.name ?? "",
            assignee: fields.assignee?.displayName ?? null,
            labels: fields.labels ?? [],
            updated: fields.updated ?? null,
        },
    };
}
async function fetchGetProject(client, validated) {
    const result = await client.getProject(validated.project_key);
    if (!result.ok)
        return errorFromClient(result, "get_project");
    return {
        status: "success",
        action: "get_project",
        data: {
            key: result.data.key,
            name: result.data.name ?? "",
            description: result.data.description ?? "",
            lead: result.data.lead?.displayName ?? null,
            issue_types: (result.data.issueTypes ?? []).map((t) => t.name ?? ""),
        },
    };
}
function missingCredentialsError(action) {
    return {
        status: "error",
        action,
        error_code: "CONFIG_ERROR",
        message: "Jira credentials not configured. Set JIRA_SITE_URL, JIRA_EMAIL, and " +
            "JIRA_API_TOKEN (or register a credential provider via " +
            ".claude/agents/lib/credential_providers/).",
        retriable: false,
    };
}
/** Fetch data from Jira. */
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
        if (action === "jql_search")
            validated = validateJqlSearch(p);
        else if (action === "get_issue")
            validated = validateGetIssue(p);
        else
            validated = validateGetProject(p);
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
        const opts = options.clientOptions ?? (await loadJiraCredentials());
        if (!opts) {
            return missingCredentialsError(action);
        }
        client = new JiraClient(opts);
    }
    try {
        if (action === "jql_search") {
            return await fetchJqlSearch(client, validated);
        }
        if (action === "get_issue") {
            return await fetchGetIssue(client, validated);
        }
        return await fetchGetProject(client, validated);
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "CONNECTION_ERROR",
            message: `Jira API call failed: ${exc.message}`,
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
const HELP_TEXT = `usage: jira_fetch.js [-h] --action {get_issue,get_project,jql_search} [--params PARAMS]

Fetch data from Jira

options:
  -h, --help            show this help message and exit
  --action {get_issue,get_project,jql_search}
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
