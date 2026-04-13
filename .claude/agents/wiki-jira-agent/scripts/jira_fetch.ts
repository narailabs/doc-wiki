#!/usr/bin/env node
/**
 * Jira data fetcher for the wiki-jira-agent.
 *
 * Library usage:
 *     import { fetch } from "./jira_fetch.js";
 *     const result = fetch("jql_search", { jql: "project = WIKI", max_results: 50 });
 *
 * CLI usage:
 *     node jira_fetch.js --action jql_search --params '{"jql": "project = WIKI"}'
 *     node jira_fetch.js --action get_issue --params '{"issue_key": "WIKI-123"}'
 *     node jira_fetch.js --action get_project --params '{"project_key": "WIKI"}'
 *
 * This is a TypeScript port of jira_fetch.py. The HTTP request path is
 * stubbed in the Python reference — this TS port matches that stub so the
 * CLI JSON output is byte-identical to the Python version.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";

// ── Constants ───────────────────────────────────────────────────────

export const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "jql_search",
  "get_issue",
  "get_project",
]);

const MAX_RESULTS_DEFAULT = 50;
const MAX_RESULTS_CAP = 1000;

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
  expand: unknown[];
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
  if (!Array.isArray(expand)) {
    throw new Error("'expand' must be a list of strings");
  }
  return { issue_key: issueKey, expand };
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

function fetchJqlSearch(validated: JqlSearchValidated): FetchResult {
  void validated;
  return {
    status: "success",
    action: "jql_search",
    data: {
      total: 0,
      issues: [],
    },
    truncated: false,
  };
}

function fetchGetIssue(validated: GetIssueValidated): FetchResult {
  return {
    status: "success",
    action: "get_issue",
    data: {
      key: validated.issue_key,
      summary: "",
      status: "",
      assignee: null,
      labels: [],
      updated: null,
    },
  };
}

function fetchGetProject(validated: GetProjectValidated): FetchResult {
  return {
    status: "success",
    action: "get_project",
    data: {
      key: validated.project_key,
      name: "",
      description: "",
      lead: null,
      issue_types: [],
    },
  };
}

/**
 * Fetch data from Jira.
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

  try {
    if (action === "jql_search") {
      return fetchJqlSearch(validated as JqlSearchValidated);
    }
    if (action === "get_issue") {
      return fetchGetIssue(validated as GetIssueValidated);
    }
    return fetchGetProject(validated as GetProjectValidated);
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
