#!/usr/bin/env node
/**
 * GCP data fetcher for the wiki-gcp-agent.
 *
 * Library usage:
 *     import { fetch } from "./gcp_query.js";
 *     const result = await fetch("list_services", { project_id: "acme-prod-123" });
 *
 * Uses Application Default Credentials by shelling out to `gcloud` / `bq`
 * via `execFileSync`. When those binaries are unavailable, the fetcher
 * falls back to a deterministic stubbed response.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { GcpClient, detectGcloudAvailable, } from "./lib/gcp_client.js";
import { formatGraph, } from "../../lib/mermaid_format.js";
export const VALID_ACTIONS = new Set([
    "list_services",
    "describe_db",
    "list_topics",
    "query_logs",
]);
const MAX_RESULTS_DEFAULT = 100;
const MAX_RESULTS_CAP = 1000;
const MAX_LOG_HOURS = 168;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
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
function validateProjectId(projectId) {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error(`Invalid project_id '${projectId}' — must be 6-30 lowercase letters, digits, hyphens`);
    }
    return projectId;
}
function validateListServices(params) {
    const raw = params["project_id"];
    return { project_id: validateProjectId(typeof raw === "string" ? raw : "") };
}
function validateDescribeDb(params) {
    const raw = params["project_id"];
    const projectId = validateProjectId(typeof raw === "string" ? raw : "");
    const instIdRaw = params["instance_id"];
    if (!instIdRaw || typeof instIdRaw !== "string") {
        throw new Error("describe_db requires a non-empty 'instance_id' string");
    }
    const dbRaw = params["database"] ?? "";
    const database = typeof dbRaw === "string" ? dbRaw : "";
    return { project_id: projectId, instance_id: instIdRaw, database };
}
function validateListTopics(params) {
    const raw = params["project_id"];
    return { project_id: validateProjectId(typeof raw === "string" ? raw : "") };
}
function validateQueryLogs(params) {
    const raw = params["project_id"];
    const projectId = validateProjectId(typeof raw === "string" ? raw : "");
    const filterRaw = params["filter"];
    if (!filterRaw || typeof filterRaw !== "string") {
        throw new Error("query_logs requires a non-empty 'filter' string");
    }
    if (filterRaw.includes(";") ||
        filterRaw.includes("'") ||
        filterRaw.includes('"')) {
        throw new Error("Filter contains forbidden characters — no semicolons or quotes allowed");
    }
    const hours = Math.min(toInt(params["hours"], 24), MAX_LOG_HOURS);
    const maxResults = Math.min(toInt(params["max_results"], MAX_RESULTS_DEFAULT), MAX_RESULTS_CAP);
    return {
        project_id: projectId,
        filter: filterRaw.trim(),
        hours,
        max_results: maxResults,
    };
}
function errorFromClient(result, action) {
    const codeMap = {
        INVALID_PROJECT: "VALIDATION_ERROR",
        INVALID_INSTANCE: "VALIDATION_ERROR",
        INVALID_FILTER: "VALIDATION_ERROR",
        FORBIDDEN_BINARY: "VALIDATION_ERROR",
        FORBIDDEN_COMMAND: "VALIDATION_ERROR",
        UNSAFE_ARG: "VALIDATION_ERROR",
        WRITE_FORBIDDEN: "VALIDATION_ERROR",
        EXEC_ERROR: "CONNECTION_ERROR",
        TIMEOUT: "TIMEOUT",
        PARSE_ERROR: "CONNECTION_ERROR",
    };
    return {
        status: "error",
        action,
        error_code: codeMap[result.code] ?? "CONNECTION_ERROR",
        message: result.message,
        retriable: result.retriable,
    };
}
async function fetchListServices(client, v) {
    const result = await client.listServices(v.project_id);
    if (!result.ok)
        return errorFromClient(result, "list_services");
    return {
        status: "success",
        action: "list_services",
        data: {
            project_id: v.project_id,
            services: result.data.map((s) => ({
                name: s.name ?? "",
                title: s.config?.title ?? "",
                state: s.state ?? "",
            })),
            service_count: result.data.length,
        },
    };
}
async function fetchDescribeDb(client, v) {
    const result = await client.describeSqlInstance(v.project_id, v.instance_id);
    if (!result.ok)
        return errorFromClient(result, "describe_db");
    const inst = result.data;
    const [engine, version] = (inst.databaseVersion ?? "").split("_");
    return {
        status: "success",
        action: "describe_db",
        data: {
            project_id: v.project_id,
            instance_id: v.instance_id,
            database: v.database,
            engine: (engine ?? "").toLowerCase(),
            version: version ?? "",
            tier: inst.settings?.tier ?? "",
            region: inst.region ?? "",
            state: inst.state ?? "",
            tables: [],
        },
    };
}
async function fetchListTopics(client, v) {
    const result = await client.listPubsubTopics(v.project_id);
    if (!result.ok)
        return errorFromClient(result, "list_topics");
    return {
        status: "success",
        action: "list_topics",
        data: {
            project_id: v.project_id,
            topics: result.data.map((t) => t.name ?? ""),
            topic_count: result.data.length,
        },
    };
}
async function fetchQueryLogs(client, v) {
    const result = await client.queryLogs(v.project_id, v.filter, v.hours, v.max_results);
    if (!result.ok)
        return errorFromClient(result, "query_logs");
    return {
        status: "success",
        action: "query_logs",
        data: {
            project_id: v.project_id,
            filter: v.filter,
            hours: v.hours,
            entries: result.data.map((e) => ({
                timestamp: e.timestamp ?? null,
                severity: e.severity ?? "",
                message: e.textPayload ?? "",
            })),
            entry_count: result.data.length,
        },
        truncated: result.data.length >= v.max_results,
    };
}
// ── Mermaid infra-topology builder (v2 design §6) ─────────────────────
//
// GCP actions emit `graph TB` project-topology diagrams. `query_logs`
// returns time-series log entries — not diagram-worthy, omitted per
// the "absence === no diagram" rule.
function mermaidForGcp(result) {
    if (result["status"] !== "success")
        return undefined;
    const action = result["action"];
    const data = result["data"];
    if (data === undefined)
        return undefined;
    if (action === "list_services") {
        const services = data["services"] ?? [];
        if (services.length === 0)
            return undefined;
        const project = data["project_id"] || "project";
        const nodes = [
            { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
            ...services.map((s, i) => ({
                id: `svc_${i}`,
                label: s.title || s.name,
            })),
        ];
        const edges = services.map((_, i) => ({
            from: `proj_${project}`,
            to: `svc_${i}`,
        }));
        return formatGraph("TB", `GCP Services — ${project}`, nodes, edges);
    }
    if (action === "describe_db") {
        const project = data["project_id"] || "project";
        const instance = data["instance_id"] || "instance";
        const engine = data["engine"] || "";
        const version = data["version"] || "";
        const label = engine || version ? `${instance} (${engine}${version ? ` ${version}` : ""})` : instance;
        const nodes = [
            { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
            { id: `db_${instance}`, label, shape: "stadium" },
        ];
        const edges = [{ from: `proj_${project}`, to: `db_${instance}` }];
        return formatGraph("TB", `GCP Cloud SQL — ${instance}`, nodes, edges);
    }
    if (action === "list_topics") {
        const topics = data["topics"] ?? [];
        if (topics.length === 0)
            return undefined;
        const project = data["project_id"] || "project";
        const nodes = [
            { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
            ...topics.map((t, i) => ({ id: `topic_${i}`, label: t })),
        ];
        const edges = topics.map((_, i) => ({
            from: `proj_${project}`,
            to: `topic_${i}`,
        }));
        return formatGraph("TB", `GCP Pub/Sub Topics — ${project}`, nodes, edges);
    }
    // query_logs: time-series log entries — not diagram-worthy.
    return undefined;
}
function decorateResult(result) {
    const mermaid = mermaidForGcp(result);
    if (mermaid === undefined)
        return result;
    return { ...result, mermaid };
}
function missingGcloudError(action) {
    return {
        status: "error",
        action,
        error_code: "CONFIG_ERROR",
        message: "gcloud CLI not available on PATH. Install Google Cloud SDK and " +
            "authenticate with Application Default Credentials (gcloud auth " +
            "application-default login).",
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
            case "list_services":
                validated = validateListServices(p);
                break;
            case "describe_db":
                validated = validateDescribeDb(p);
                break;
            case "list_topics":
                validated = validateListTopics(p);
                break;
            case "query_logs":
                validated = validateQueryLogs(p);
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
        if (options.clientOptions) {
            client = new GcpClient(options.clientOptions);
        }
        else if (!detectGcloudAvailable()) {
            return missingGcloudError(action);
        }
        else {
            client = new GcpClient();
        }
    }
    try {
        let result;
        switch (action) {
            case "list_services":
                result = await fetchListServices(client, validated);
                break;
            case "describe_db":
                result = await fetchDescribeDb(client, validated);
                break;
            case "list_topics":
                result = await fetchListTopics(client, validated);
                break;
            case "query_logs":
                result = await fetchQueryLogs(client, validated);
                break;
            default:
                throw new Error("unreachable action");
        }
        return decorateResult(result);
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "CONNECTION_ERROR",
            message: `GCP API call failed: ${exc.message}`,
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
const HELP_TEXT = `usage: gcp_query.js [-h] --action {describe_db,list_services,list_topics,query_logs} [--params PARAMS]

Query GCP resources

options:
  -h, --help            show this help message and exit
  --action {describe_db,list_services,list_topics,query_logs}
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
