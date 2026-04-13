#!/usr/bin/env node
/**
 * GitHub data fetcher for the wiki-github-agent.
 *
 * Library usage:
 *     import { fetch } from "./github_fetch.js";
 *     const result = fetch("repo_info", { owner: "acme", repo: "backend" });
 *
 * CLI usage:
 *     node github_fetch.js --action repo_info --params '{"owner": "acme", "repo": "backend"}'
 *     node github_fetch.js --action search_code --params '{"owner": "acme", "repo": "backend", "query": "class Auth"}'
 *     node github_fetch.js --action get_issues --params '{"owner": "acme", "repo": "backend", "state": "open"}'
 *     node github_fetch.js --action get_pulls --params '{"owner": "acme", "repo": "backend"}'
 *     node github_fetch.js --action get_file --params '{"owner": "acme", "repo": "backend", "path": "README.md"}'
 *
 * This is a TypeScript port of github_fetch.py. HTTP calls are stubbed in
 * the Python reference (commented-out `requests` calls); this TS port
 * matches that stub exactly so CLI JSON output is byte-identical.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";

// ── Constants ───────────────────────────────────────────────────────

export const VALID_ACTIONS: ReadonlySet<string> = new Set([
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

const VALID_STATES: ReadonlySet<string> = new Set(["open", "closed", "all"]);

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

function validateOwnerRepo(params: Params): [string, string] {
  const ownerRaw = params["owner"];
  const repoRaw = params["repo"];
  const owner = typeof ownerRaw === "string" ? ownerRaw : "";
  const repo = typeof repoRaw === "string" ? repoRaw : "";
  if (!OWNER_REPO_PATTERN.test(owner)) {
    throw new Error(
      `Invalid owner '${owner}' — alphanumeric, dots, dashes, underscores only`,
    );
  }
  if (!OWNER_REPO_PATTERN.test(repo)) {
    throw new Error(
      `Invalid repo '${repo}' — alphanumeric, dots, dashes, underscores only`,
    );
  }
  return [owner, repo];
}

interface RepoInfoValidated {
  owner: string;
  repo: string;
}

interface SearchCodeValidated {
  owner: string;
  repo: string;
  query: string;
  max_results: number;
}

interface GetIssuesValidated {
  owner: string;
  repo: string;
  state: string;
  labels: unknown[];
  max_results: number;
}

interface GetPullsValidated {
  owner: string;
  repo: string;
  state: string;
  max_results: number;
}

interface GetFileValidated {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

function validateRepoInfo(params: Params): RepoInfoValidated {
  const [owner, repo] = validateOwnerRepo(params);
  return { owner, repo };
}

function validateSearchCode(params: Params): SearchCodeValidated {
  const [owner, repo] = validateOwnerRepo(params);
  const queryRaw = params["query"];
  if (!queryRaw || typeof queryRaw !== "string") {
    throw new Error("search_code requires a non-empty 'query' string");
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return { owner, repo, query: queryRaw.trim(), max_results: maxResults };
}

function validateGetIssues(params: Params): GetIssuesValidated {
  const [owner, repo] = validateOwnerRepo(params);
  const stateRaw = params["state"];
  const state = typeof stateRaw === "string" ? stateRaw : "open";
  if (!VALID_STATES.has(state)) {
    throw new Error(
      `Invalid state '${state}' — expected open, closed, or all`,
    );
  }
  const labels = params["labels"] ?? [];
  if (!Array.isArray(labels)) {
    throw new Error("'labels' must be a list of strings");
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return { owner, repo, state, labels, max_results: maxResults };
}

function validateGetPulls(params: Params): GetPullsValidated {
  const [owner, repo] = validateOwnerRepo(params);
  const stateRaw = params["state"];
  const state = typeof stateRaw === "string" ? stateRaw : "open";
  if (!VALID_STATES.has(state)) {
    throw new Error(
      `Invalid state '${state}' — expected open, closed, or all`,
    );
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return { owner, repo, state, max_results: maxResults };
}

function validateGetFile(params: Params): GetFileValidated {
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

function fetchRepoInfo(validated: RepoInfoValidated): FetchResult {
  return {
    status: "success",
    action: "repo_info",
    data: {
      full_name: `${validated.owner}/${validated.repo}`,
      description: "",
      default_branch: "main",
      language: null,
      stars: 0,
      open_issues: 0,
      topics: [],
      updated_at: null,
    },
  };
}

function fetchSearchCode(validated: SearchCodeValidated): FetchResult {
  void validated;
  return {
    status: "success",
    action: "search_code",
    data: {
      total: 0,
      items: [],
    },
    truncated: false,
  };
}

function fetchGetIssues(validated: GetIssuesValidated): FetchResult {
  void validated;
  return {
    status: "success",
    action: "get_issues",
    data: {
      total: 0,
      issues: [],
    },
    truncated: false,
  };
}

function fetchGetPulls(validated: GetPullsValidated): FetchResult {
  void validated;
  return {
    status: "success",
    action: "get_pulls",
    data: {
      total: 0,
      pulls: [],
    },
    truncated: false,
  };
}

function fetchGetFile(validated: GetFileValidated): FetchResult {
  return {
    status: "success",
    action: "get_file",
    data: {
      path: validated.path,
      ref: validated.ref,
      size_bytes: 0,
      content: "",
      encoding: "utf-8",
    },
  };
}

/**
 * Fetch data from GitHub.
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
    | RepoInfoValidated
    | SearchCodeValidated
    | GetIssuesValidated
    | GetPullsValidated
    | GetFileValidated;
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
        // Unreachable — VALID_ACTIONS gate above catches this.
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
      case "repo_info":
        return fetchRepoInfo(validated as RepoInfoValidated);
      case "search_code":
        return fetchSearchCode(validated as SearchCodeValidated);
      case "get_issues":
        return fetchGetIssues(validated as GetIssuesValidated);
      case "get_pulls":
        return fetchGetPulls(validated as GetPullsValidated);
      case "get_file":
        return fetchGetFile(validated as GetFileValidated);
    }
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `GitHub API call failed: ${(exc as Error).message}`,
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

const HELP_TEXT = `usage: github_fetch.js [-h] --action {get_file,get_issues,get_pulls,repo_info,search_code} [--params PARAMS]

Fetch data from GitHub

options:
  -h, --help            show this help message and exit
  --action {get_file,get_issues,get_pulls,repo_info,search_code}
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
