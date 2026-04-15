#!/usr/bin/env node
/**
 * GitHub data fetcher for the wiki-github-agent.
 *
 * Library usage:
 *     import { fetch } from "./github_fetch.js";
 *     const result = await fetch("repo_info", { owner: "acme", repo: "backend" });
 *
 * Read-only GitHub REST v3 + GraphQL client. Credentials resolve via
 * `resolveSecret` with `env_var` fallback (`GITHUB_TOKEN`). Falls back to a
 * stubbed response when credentials are unavailable.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { GithubClient, loadGithubCredentials, } from "./lib/github_client.js";
import { formatGraph, } from "../../lib/mermaid_format.js";
export const VALID_ACTIONS = new Set([
    "repo_info",
    "search_code",
    "get_issues",
    "get_pulls",
    "get_file",
]);
const MAX_RESULTS_DEFAULT = 30;
const MAX_RESULTS_CAP = 1000;
const OWNER_REPO_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const PATH_PATTERN = /^[a-zA-Z0-9_./ -]+$/;
const VALID_STATES = new Set(["open", "closed", "all"]);
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
function validateOwnerRepo(params) {
    const ownerRaw = params["owner"];
    const repoRaw = params["repo"];
    const owner = typeof ownerRaw === "string" ? ownerRaw : "";
    const repo = typeof repoRaw === "string" ? repoRaw : "";
    if (!OWNER_REPO_PATTERN.test(owner)) {
        throw new Error(`Invalid owner '${owner}' — alphanumeric, dots, dashes, underscores only`);
    }
    if (!OWNER_REPO_PATTERN.test(repo)) {
        throw new Error(`Invalid repo '${repo}' — alphanumeric, dots, dashes, underscores only`);
    }
    return [owner, repo];
}
function validateRepoInfo(params) {
    const [owner, repo] = validateOwnerRepo(params);
    return { owner, repo };
}
function validateSearchCode(params) {
    const [owner, repo] = validateOwnerRepo(params);
    const queryRaw = params["query"];
    if (!queryRaw || typeof queryRaw !== "string") {
        throw new Error("search_code requires a non-empty 'query' string");
    }
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return { owner, repo, query: queryRaw.trim(), max_results: maxResults };
}
function validateGetIssues(params) {
    const [owner, repo] = validateOwnerRepo(params);
    const stateRaw = params["state"];
    const state = typeof stateRaw === "string" ? stateRaw : "open";
    if (!VALID_STATES.has(state)) {
        throw new Error(`Invalid state '${state}' — expected open, closed, or all`);
    }
    const labelsRaw = params["labels"] ?? [];
    if (!Array.isArray(labelsRaw) || !labelsRaw.every((x) => typeof x === "string")) {
        throw new Error("'labels' must be a list of strings");
    }
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return {
        owner,
        repo,
        state,
        labels: labelsRaw,
        max_results: maxResults,
    };
}
function validateGetPulls(params) {
    const [owner, repo] = validateOwnerRepo(params);
    const stateRaw = params["state"];
    const state = typeof stateRaw === "string" ? stateRaw : "open";
    if (!VALID_STATES.has(state)) {
        throw new Error(`Invalid state '${state}' — expected open, closed, or all`);
    }
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return { owner, repo, state, max_results: maxResults };
}
function validateGetFile(params) {
    const [owner, repo] = validateOwnerRepo(params);
    const pathRaw = params["path"];
    const pathValue = typeof pathRaw === "string" ? pathRaw : "";
    if (!pathValue || !PATH_PATTERN.test(pathValue)) {
        throw new Error(`Invalid path '${pathValue}' — must be a valid file path`);
    }
    if (pathValue.includes("..")) {
        throw new Error("Path traversal not allowed — '..' is forbidden");
    }
    const refRaw = params["ref"];
    const ref = typeof refRaw === "string" ? refRaw : "main";
    return { owner, repo, path: pathValue, ref };
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
async function fetchRepoInfo(client, v) {
    const result = await client.getRepo(v.owner, v.repo);
    if (!result.ok)
        return errorFromClient(result, "repo_info");
    const data = result.data;
    return {
        status: "success",
        action: "repo_info",
        data: {
            full_name: data.full_name,
            description: data.description ?? "",
            default_branch: data.default_branch ?? "main",
            language: data.language ?? null,
            stars: data.stargazers_count ?? 0,
            open_issues: data.open_issues_count ?? 0,
            topics: data.topics ?? [],
            updated_at: data.updated_at ?? null,
        },
    };
}
async function fetchSearchCode(client, v) {
    const result = await client.searchCode(v.owner, v.repo, v.query, v.max_results);
    if (!result.ok)
        return errorFromClient(result, "search_code");
    const data = result.data;
    return {
        status: "success",
        action: "search_code",
        data: {
            total: data.total_count ?? 0,
            items: (data.items ?? []).map((it) => ({
                path: it.path,
                repo: it.repository?.full_name ?? "",
                url: it.html_url ?? "",
            })),
        },
        truncated: (data.total_count ?? 0) > v.max_results,
    };
}
async function fetchGetIssues(client, v) {
    const result = await client.listIssues(v.owner, v.repo, {
        state: v.state,
        labels: v.labels,
        perPage: v.max_results,
    });
    if (!result.ok)
        return errorFromClient(result, "get_issues");
    const issues = Array.isArray(result.data) ? result.data : [];
    return {
        status: "success",
        action: "get_issues",
        data: {
            total: issues.length,
            issues: issues.map((i) => ({
                number: i.number,
                title: i.title,
                state: i.state,
                author: i.user?.login ?? "",
                labels: (i.labels ?? []).map((l) => typeof l === "string" ? l : l.name ?? ""),
                url: i.html_url ?? "",
                updated_at: i.updated_at ?? null,
            })),
        },
        truncated: issues.length >= v.max_results,
    };
}
async function fetchGetPulls(client, v) {
    const result = await client.listPulls(v.owner, v.repo, {
        state: v.state,
        perPage: v.max_results,
    });
    if (!result.ok)
        return errorFromClient(result, "get_pulls");
    const pulls = Array.isArray(result.data) ? result.data : [];
    return {
        status: "success",
        action: "get_pulls",
        data: {
            total: pulls.length,
            pulls: pulls.map((p) => ({
                number: p.number,
                title: p.title,
                state: p.state,
                author: p.user?.login ?? "",
                url: p.html_url ?? "",
                updated_at: p.updated_at ?? null,
            })),
        },
        truncated: pulls.length >= v.max_results,
    };
}
async function fetchGetFile(client, v) {
    const result = await client.getFile(v.owner, v.repo, v.path, v.ref);
    if (!result.ok)
        return errorFromClient(result, "get_file");
    const data = result.data;
    let decoded = "";
    if (data.encoding === "base64" && data.content) {
        decoded = Buffer.from(data.content, "base64").toString("utf-8");
    }
    return {
        status: "success",
        action: "get_file",
        data: {
            path: data.path,
            ref: v.ref,
            size_bytes: data.size ?? 0,
            content: decoded,
            encoding: "utf-8",
        },
    };
}
// ── Mermaid dependency-graph builder (v2 design §6) ───────────────────
//
// GitHub's `get_file` emits a `graph LR` dependency graph when the
// fetched file is a recognizable dependency manifest (package.json,
// requirements.txt). Every other action is prose/metadata-shaped and
// is not diagram-worthy, so the `mermaid` field is omitted entirely.
/** Parse `package.json` contents into an ordered list of dep names. */
function parsePackageJsonDeps(content) {
    try {
        const parsed = JSON.parse(content);
        const deps = [
            ...Object.keys(parsed.dependencies ?? {}),
            ...Object.keys(parsed.devDependencies ?? {}),
        ];
        // Preserve insertion order but drop duplicates.
        return [...new Set(deps)];
    }
    catch {
        return [];
    }
}
/** Parse `requirements.txt` contents into an ordered list of dep names. */
function parseRequirementsTxt(content) {
    const deps = [];
    const seen = new Set();
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#"))
            continue;
        // Strip version specifiers, extras, and environment markers.
        const m = line.match(/^([A-Za-z0-9_.\-]+)/);
        if (!m)
            continue;
        const name = m[1];
        if (seen.has(name))
            continue;
        seen.add(name);
        deps.push(name);
    }
    return deps;
}
function mermaidForGithub(result) {
    if (result["status"] !== "success")
        return undefined;
    if (result["action"] !== "get_file")
        return undefined;
    const data = result["data"];
    if (data === undefined)
        return undefined;
    const filePath = (data["path"] ?? "").toLowerCase();
    const content = data["content"] ?? "";
    if (content === "")
        return undefined;
    let deps = [];
    if (filePath.endsWith("package.json")) {
        deps = parsePackageJsonDeps(content);
    }
    else if (filePath.endsWith("requirements.txt")) {
        deps = parseRequirementsTxt(content);
    }
    if (deps.length === 0)
        return undefined;
    // Cap at a reasonable node count so very large manifests don't
    // generate un-renderable Mermaid blocks. Users with more deps can
    // still see the full list in `data.content`.
    const capped = deps.slice(0, 40);
    const rootLabel = data["path"] || "repo";
    const nodes = [
        { id: "root", label: rootLabel, shape: "rounded" },
        ...capped.map((d, i) => ({ id: `dep_${i}`, label: d })),
    ];
    const edges = capped.map((_, i) => ({
        from: "root",
        to: `dep_${i}`,
    }));
    return formatGraph("LR", "Dependency Graph", nodes, edges);
}
function decorateResult(result) {
    const mermaid = mermaidForGithub(result);
    if (mermaid === undefined)
        return result;
    return { ...result, mermaid };
}
function missingCredentialsError(action) {
    return {
        status: "error",
        action,
        error_code: "CONFIG_ERROR",
        message: "GitHub credentials not configured. Set GITHUB_TOKEN (personal access " +
            "token) or register a credential provider via " +
            ".claude/agents/lib/credential_providers/.",
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
            case "repo_info":
                validated = validateRepoInfo(p);
                break;
            case "search_code":
                validated = validateSearchCode(p);
                break;
            case "get_issues":
                validated = validateGetIssues(p);
                break;
            case "get_pulls":
                validated = validateGetPulls(p);
                break;
            case "get_file":
                validated = validateGetFile(p);
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
        const opts = options.clientOptions ?? (await loadGithubCredentials());
        if (!opts)
            return missingCredentialsError(action);
        client = new GithubClient(opts);
    }
    try {
        let result;
        switch (action) {
            case "repo_info":
                result = await fetchRepoInfo(client, validated);
                break;
            case "search_code":
                result = await fetchSearchCode(client, validated);
                break;
            case "get_issues":
                result = await fetchGetIssues(client, validated);
                break;
            case "get_pulls":
                result = await fetchGetPulls(client, validated);
                break;
            case "get_file":
                result = await fetchGetFile(client, validated);
                break;
            default:
                return {
                    status: "error",
                    error_code: "UNKNOWN",
                    message: "Unexpected state",
                };
        }
        return decorateResult(result);
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "CONNECTION_ERROR",
            message: `GitHub API call failed: ${exc.message}`,
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
const HELP_TEXT = `usage: github_fetch.js [-h] --action {get_file,get_issues,get_pulls,repo_info,search_code} [--params PARAMS]

Fetch data from GitHub

options:
  -h, --help            show this help message and exit
  --action {get_file,get_issues,get_pulls,repo_info,search_code}
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
