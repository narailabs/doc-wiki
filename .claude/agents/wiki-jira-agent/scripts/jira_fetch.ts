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
import {
  JiraClient,
  loadJiraCredentials,
  type JiraClientOptions,
  type JiraResult,
} from "./lib/jira_client.js";
import {
  formatGraph,
  type GraphEdge,
  type GraphNode,
  type MermaidBlock,
} from "../../lib/mermaid_format.js";

// ── Constants ───────────────────────────────────────────────────────

export const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "jql_search",
  "get_issue",
  "get_project",
]);

const MAX_RESULTS_DEFAULT = 50;
const MAX_RESULTS_CAP = 500;

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;
const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]+$/;

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

interface JqlSearchValidated {
  jql: string;
  max_results: number;
}

interface GetIssueValidated {
  issue_key: string;
  expand: string[];
}

interface GetProjectValidated {
  project_key: string;
}

function validateJqlSearch(params: Params): JqlSearchValidated {
  const jql = params["jql"];
  if (!jql || typeof jql !== "string") {
    throw new Error("jql_search requires a non-empty 'jql' string");
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return { jql: jql.trim(), max_results: maxResults };
}

function validateGetIssue(params: Params): GetIssueValidated {
  const issueKeyRaw = params["issue_key"];
  const issueKey = typeof issueKeyRaw === "string" ? issueKeyRaw : "";
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    throw new Error(
      `Invalid issue_key '${issueKey}' — expected format like PROJ-123`,
    );
  }
  const expand = params["expand"] ?? [];
  if (!Array.isArray(expand) || !expand.every((x) => typeof x === "string")) {
    throw new Error("'expand' must be a list of strings");
  }
  return { issue_key: issueKey, expand: expand as string[] };
}

function validateGetProject(params: Params): GetProjectValidated {
  const projectKeyRaw = params["project_key"];
  const projectKey = typeof projectKeyRaw === "string" ? projectKeyRaw : "";
  if (!PROJECT_KEY_PATTERN.test(projectKey)) {
    throw new Error(
      `Invalid project_key '${projectKey}' — expected format like PROJ`,
    );
  }
  return { project_key: projectKey };
}

/** Convert a uniform client error into the legacy `{ status: error, ... }` shape. */
function errorFromClient<T>(
  result: Extract<JiraResult<T>, { ok: false }>,
  action: string,
): FetchResult {
  const codeMap: Record<string, string> = {
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

async function fetchJqlSearch(
  client: JiraClient,
  validated: JqlSearchValidated,
): Promise<FetchResult> {
  const result = await client.searchJql(validated.jql, validated.max_results);
  if (!result.ok) return errorFromClient(result, "jql_search");
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

async function fetchGetIssue(
  client: JiraClient,
  validated: GetIssueValidated,
): Promise<FetchResult> {
  const result = await client.getIssue(validated.issue_key, validated.expand);
  if (!result.ok) return errorFromClient(result, "get_issue");
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

async function fetchGetProject(
  client: JiraClient,
  validated: GetProjectValidated,
): Promise<FetchResult> {
  const result = await client.getProject(validated.project_key);
  if (!result.ok) return errorFromClient(result, "get_project");
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

/**
 * G-AGENT-MERMAID: build a `graph TD` grouping issues by status.
 *
 * A gantt chart was originally declared in AGENT.md, but reliable
 * start/end dates are rare on Jira issues (Jira stores `updated` and
 * `created`, not planned dates). A status-grouped graph is truthful
 * and always renderable. Emitted only for `jql_search`; other actions
 * are single-record or project metadata and omit the field.
 */
function mermaidForJira(result: FetchResult): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  if (result["action"] !== "jql_search") return undefined;
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;
  const issues =
    (data["issues"] as Array<Record<string, unknown>> | undefined) ?? [];
  if (issues.length === 0) return undefined;

  // Group by status so related issues cluster visually.
  const byStatus = new Map<string, Array<Record<string, unknown>>>();
  for (const issue of issues) {
    const status = ((issue["status"] as string | undefined) ?? "unknown") ||
      "unknown";
    let bucket = byStatus.get(status);
    if (bucket === undefined) {
      bucket = [];
      byStatus.set(status, bucket);
    }
    bucket.push(issue);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  nodes.push({ id: "root", label: "Issues", shape: "rounded" });
  let si = 0;
  let ii = 0;
  // Cap total issue nodes so very large result sets don't produce
  // un-renderable diagrams.
  const PER_DIAGRAM_CAP = 40;
  let drawn = 0;
  for (const [status, bucket] of byStatus) {
    if (drawn >= PER_DIAGRAM_CAP) break;
    const sid = `s${si++}`;
    nodes.push({ id: sid, label: status });
    edges.push({ from: "root", to: sid });
    for (const issue of bucket) {
      if (drawn >= PER_DIAGRAM_CAP) break;
      const key = (issue["key"] as string | undefined) ?? `I${ii}`;
      const summary = ((issue["summary"] as string | undefined) ?? "").slice(0, 40);
      const label = summary ? `${key}: ${summary}` : key;
      const id = `i${ii++}`;
      nodes.push({ id, label });
      edges.push({ from: sid, to: id });
      drawn++;
    }
  }
  return formatGraph("TB", "Issue Status Tree", nodes, edges);
}

function decorateResult(result: FetchResult): FetchResult {
  const mermaid = mermaidForJira(result);
  if (mermaid === undefined) return result;
  return { ...result, mermaid };
}

function missingCredentialsError(action: string): FetchResult {
  return {
    status: "error",
    action,
    error_code: "CONFIG_ERROR",
    message:
      "Jira credentials not configured. Set JIRA_SITE_URL, JIRA_EMAIL, and " +
      "JIRA_API_TOKEN (or register a credential provider via " +
      ".claude/agents/lib/credential_providers/).",
    retriable: false,
  };
}

export interface FetchOptions {
  /** Override the constructed client (tests inject a fake). */
  client?: JiraClient;
  /** Override creds; skip `loadJiraCredentials` when provided. */
  clientOptions?: JiraClientOptions;
}

/** Fetch data from Jira. */
export async function fetch(
  action: string,
  params: Params | null = null,
  options: FetchOptions = {},
): Promise<FetchResult> {
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

  let validated: JqlSearchValidated | GetIssueValidated | GetProjectValidated;
  try {
    if (action === "jql_search") validated = validateJqlSearch(p);
    else if (action === "get_issue") validated = validateGetIssue(p);
    else validated = validateGetProject(p);
  } catch (exc) {
    return {
      status: "error",
      error_code: "VALIDATION_ERROR",
      message: (exc as Error).message,
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
    let result: FetchResult;
    if (action === "jql_search") {
      result = await fetchJqlSearch(client, validated as JqlSearchValidated);
    } else if (action === "get_issue") {
      result = await fetchGetIssue(client, validated as GetIssueValidated);
    } else {
      result = await fetchGetProject(client, validated as GetProjectValidated);
    }
    return decorateResult(result);
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `Jira API call failed: ${(exc as Error).message}`,
    };
  }
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

const HELP_TEXT = `usage: jira_fetch.js [-h] --action {get_issue,get_project,jql_search} [--params PARAMS]

Fetch data from Jira

options:
  -h, --help            show this help message and exit
  --action {get_issue,get_project,jql_search}
                        Action to perform
  --params PARAMS       JSON string of action parameters
`;

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
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
