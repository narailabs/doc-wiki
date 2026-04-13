#!/usr/bin/env node
/**
 * GCP data fetcher for the wiki-gcp-agent.
 *
 * Library usage:
 *     import { fetch } from "./gcp_query.js";
 *     const result = fetch("list_services", { project_id: "acme-prod-123" });
 *
 * CLI usage:
 *     node gcp_query.js --action list_services --params '{"project_id": "acme-prod-123"}'
 *     node gcp_query.js --action describe_db --params '{"project_id": "acme-prod-123", "instance_id": "main-pg"}'
 *     node gcp_query.js --action list_topics --params '{"project_id": "acme-prod-123"}'
 *     node gcp_query.js --action query_logs --params '{"project_id": "acme-prod-123", "filter": "severity>=ERROR"}'
 *
 * This is a TypeScript port of gcp_query.py. The Python reference has
 * commented-out google-cloud-* calls (stubbed); this TS port matches that
 * stub so CLI JSON output is byte-identical.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";

// ── Constants ───────────────────────────────────────────────────────

export const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "list_services",
  "describe_db",
  "list_topics",
  "query_logs",
]);

const MAX_RESULTS_DEFAULT = 100;
const MAX_RESULTS_CAP = 1000;
const MAX_LOG_HOURS = 168; // 7 days

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export type FetchResult = Record<string, unknown>;
type Params = Record<string, unknown>;

function toInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function validateProjectId(projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      `Invalid project_id '${projectId}' — must be 6-30 lowercase letters, digits, hyphens`,
    );
  }
  return projectId;
}

interface ListServicesValidated {
  project_id: string;
}

interface DescribeDbValidated {
  project_id: string;
  instance_id: string;
  database: string;
}

interface ListTopicsValidated {
  project_id: string;
}

interface QueryLogsValidated {
  project_id: string;
  filter: string;
  hours: number;
  max_results: number;
}

function validateListServices(params: Params): ListServicesValidated {
  const raw = params["project_id"];
  const projectId = validateProjectId(typeof raw === "string" ? raw : "");
  return { project_id: projectId };
}

function validateDescribeDb(params: Params): DescribeDbValidated {
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

function validateListTopics(params: Params): ListTopicsValidated {
  const raw = params["project_id"];
  const projectId = validateProjectId(typeof raw === "string" ? raw : "");
  return { project_id: projectId };
}

function validateQueryLogs(params: Params): QueryLogsValidated {
  const raw = params["project_id"];
  const projectId = validateProjectId(typeof raw === "string" ? raw : "");
  const filterRaw = params["filter"];
  if (!filterRaw || typeof filterRaw !== "string") {
    throw new Error("query_logs requires a non-empty 'filter' string");
  }
  if (
    filterRaw.includes(";") ||
    filterRaw.includes("'") ||
    filterRaw.includes('"')
  ) {
    throw new Error(
      "Filter contains forbidden characters — no semicolons or quotes allowed",
    );
  }
  const hours = Math.min(toInt(params["hours"], 24), MAX_LOG_HOURS);
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return {
    project_id: projectId,
    filter: filterRaw.trim(),
    hours,
    max_results: maxResults,
  };
}

function fetchListServices(validated: ListServicesValidated): FetchResult {
  return {
    status: "success",
    action: "list_services",
    data: {
      project_id: validated.project_id,
      services: [],
      service_count: 0,
    },
  };
}

function fetchDescribeDb(validated: DescribeDbValidated): FetchResult {
  return {
    status: "success",
    action: "describe_db",
    data: {
      project_id: validated.project_id,
      instance_id: validated.instance_id,
      database: validated.database,
      engine: "",
      version: "",
      tier: "",
      region: "",
      state: "",
      tables: [],
    },
  };
}

function fetchListTopics(validated: ListTopicsValidated): FetchResult {
  return {
    status: "success",
    action: "list_topics",
    data: {
      project_id: validated.project_id,
      topics: [],
      topic_count: 0,
    },
  };
}

function fetchQueryLogs(validated: QueryLogsValidated): FetchResult {
  return {
    status: "success",
    action: "query_logs",
    data: {
      project_id: validated.project_id,
      filter: validated.filter,
      hours: validated.hours,
      entries: [],
      entry_count: 0,
    },
    truncated: false,
  };
}

/**
 * Fetch data from GCP.
 */
export function fetch(
  action: string,
  params: Params | null = null,
): FetchResult {
  if (!VALID_ACTIONS.has(action)) {
    const sorted = [...VALID_ACTIONS].sort();
    return {
      status: "error",
      error_code: "VALIDATION_ERROR",
      message:
        `Unknown action '${action}' — expected one of ` +
        `[${sorted.map((s) => `'${s}'`).join(", ")}]`,
    };
  }

  const p: Params = params ?? {};

  let validated:
    | ListServicesValidated
    | DescribeDbValidated
    | ListTopicsValidated
    | QueryLogsValidated;
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
  } catch (exc) {
    return {
      status: "error",
      error_code: "VALIDATION_ERROR",
      message: (exc as Error).message,
    };
  }

  try {
    switch (action) {
      case "list_services":
        return fetchListServices(validated as ListServicesValidated);
      case "describe_db":
        return fetchDescribeDb(validated as DescribeDbValidated);
      case "list_topics":
        return fetchListTopics(validated as ListTopicsValidated);
      case "query_logs":
        return fetchQueryLogs(validated as QueryLogsValidated);
    }
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `GCP API call failed: ${(exc as Error).message}`,
    };
  }

  return {
    status: "error",
    error_code: "UNKNOWN",
    message: "Unexpected state",
  };
}

// ── CLI ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  action?: string;
  params?: string;
  help?: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
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
    let name: string;
    let value: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
        i++;
      } else {
        name = a.slice(2);
        value = argv[i + 1];
        i += 2;
      }
    } else {
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

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
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
    process.stderr.write(
      `argument --action: invalid choice: '${args.action}' (choose from ${sorted.map((s) => `'${s}'`).join(", ")})\n`,
    );
    return 2;
  }

  const paramsRaw = args.params ?? "{}";
  let params: Params;
  try {
    const parsed: unknown = JSON.parse(paramsRaw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("params must be a JSON object");
    }
    params = parsed as Params;
  } catch (e) {
    const result: FetchResult = {
      status: "error",
      error_code: "VALIDATION_ERROR",
      message: `Invalid JSON in --params: ${(e as Error).message}`,
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

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
