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
import {
  GithubClient,
  loadGithubCredentials,
  type GithubClientOptions,
  type GithubResult,
} from "./lib/github_client.js";
import {
  formatGraph,
  type GraphEdge,
  type GraphNode,
  type MermaidBlock,
} from "../../lib/mermaid_format.js";
import {
  parseAgentArgs,
  type ParsedAgentArgs,
} from "../../lib/_agent_cli.js";

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
  labels: string[];
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
    throw new Error(`Invalid state '${state}' — expected open, closed, or all`);
  }
  const labelsRaw = params["labels"] ?? [];
  if (!Array.isArray(labelsRaw) || !labelsRaw.every((x) => typeof x === "string")) {
    throw new Error("'labels' must be a list of strings");
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return {
    owner,
    repo,
    state,
    labels: labelsRaw as string[],
    max_results: maxResults,
  };
}

function validateGetPulls(params: Params): GetPullsValidated {
  const [owner, repo] = validateOwnerRepo(params);
  const stateRaw = params["state"];
  const state = typeof stateRaw === "string" ? stateRaw : "open";
  if (!VALID_STATES.has(state)) {
    throw new Error(`Invalid state '${state}' — expected open, closed, or all`);
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

function errorFromClient<T>(
  result: Extract<GithubResult<T>, { ok: false }>,
  action: string,
): FetchResult {
  const codeMap: Record<string, string> = {
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

async function fetchRepoInfo(
  client: GithubClient,
  v: RepoInfoValidated,
): Promise<FetchResult> {
  const result = await client.getRepo(v.owner, v.repo);
  if (!result.ok) return errorFromClient(result, "repo_info");
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

async function fetchSearchCode(
  client: GithubClient,
  v: SearchCodeValidated,
): Promise<FetchResult> {
  const result = await client.searchCode(v.owner, v.repo, v.query, v.max_results);
  if (!result.ok) return errorFromClient(result, "search_code");
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

// GitHub caps per_page at 100 for list endpoints.
const GITHUB_MAX_PER_PAGE = 100;

/**
 * G-GITHUB-PAGINATE: walk `page=1, 2, 3, …` until we hit `max_results`
 * or the listing yields fewer than `per_page` items (the last page).
 * Returns the accumulated rows (capped at `max_results`) and a
 * `truncated` flag indicating the cap was reached before the end.
 *
 * On page-level HTTP errors, returns the error alongside whatever was
 * accumulated so far — callers decide whether to surface or swallow.
 */
async function paginate<T>(
  maxResults: number,
  fetchPage: (page: number, perPage: number) => Promise<GithubResult<T[]>>,
): Promise<
  | { ok: true; items: T[]; truncated: boolean }
  | { ok: false; error: Extract<GithubResult<T[]>, { ok: false }> }
> {
  const perPage = Math.min(GITHUB_MAX_PER_PAGE, Math.max(1, maxResults));
  const acc: T[] = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    const result = await fetchPage(page, perPage);
    if (!result.ok) return { ok: false, error: result };
    const chunk = Array.isArray(result.data) ? result.data : [];
    acc.push(...chunk);
    // Natural end of listing (short page).
    if (chunk.length < perPage) break;
    // Cap reached — mark truncated since more pages likely exist.
    if (acc.length >= maxResults) {
      truncated = true;
      break;
    }
  }
  const capped = acc.slice(0, maxResults);
  return { ok: true, items: capped, truncated };
}

async function fetchGetIssues(
  client: GithubClient,
  v: GetIssuesValidated,
): Promise<FetchResult> {
  const page = await paginate(v.max_results, (pageNum, perPage) =>
    client.listIssues(v.owner, v.repo, {
      state: v.state,
      labels: v.labels,
      perPage,
      page: pageNum,
    }),
  );
  if (!page.ok) return errorFromClient(page.error, "get_issues");
  const issues = page.items;
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
        labels: (i.labels ?? []).map((l) =>
          typeof l === "string" ? l : l.name ?? "",
        ),
        url: i.html_url ?? "",
        updated_at: i.updated_at ?? null,
      })),
    },
    truncated: page.truncated,
  };
}

async function fetchGetPulls(
  client: GithubClient,
  v: GetPullsValidated,
): Promise<FetchResult> {
  const page = await paginate(v.max_results, (pageNum, perPage) =>
    client.listPulls(v.owner, v.repo, {
      state: v.state,
      perPage,
      page: pageNum,
    }),
  );
  if (!page.ok) return errorFromClient(page.error, "get_pulls");
  const pulls = page.items;
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
    truncated: page.truncated,
  };
}

async function fetchGetFile(
  client: GithubClient,
  v: GetFileValidated,
): Promise<FetchResult> {
  const result = await client.getFile(v.owner, v.repo, v.path, v.ref);
  if (!result.ok) return errorFromClient(result, "get_file");
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
function parsePackageJsonDeps(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const deps = [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ];
    // Preserve insertion order but drop duplicates.
    return [...new Set(deps)];
  } catch {
    return [];
  }
}

/** Parse `requirements.txt` contents into an ordered list of dep names. */
function parseRequirementsTxt(content: string): string[] {
  const deps: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    // Strip version specifiers, extras, and environment markers.
    const m = line.match(/^([A-Za-z0-9_.\-]+)/);
    if (!m) continue;
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    deps.push(name);
  }
  return deps;
}

function mermaidForGithub(result: FetchResult): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  if (result["action"] !== "get_file") return undefined;
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  const filePath = ((data["path"] as string) ?? "").toLowerCase();
  const content = (data["content"] as string) ?? "";
  if (content === "") return undefined;

  let deps: string[] = [];
  if (filePath.endsWith("package.json")) {
    deps = parsePackageJsonDeps(content);
  } else if (filePath.endsWith("requirements.txt")) {
    deps = parseRequirementsTxt(content);
  }

  if (deps.length === 0) return undefined;
  // Cap at a reasonable node count so very large manifests don't
  // generate un-renderable Mermaid blocks. Users with more deps can
  // still see the full list in `data.content`.
  const capped = deps.slice(0, 40);
  const rootLabel = (data["path"] as string) || "repo";
  const nodes: GraphNode[] = [
    { id: "root", label: rootLabel, shape: "rounded" },
    ...capped.map((d, i) => ({ id: `dep_${i}`, label: d })),
  ];
  const edges: GraphEdge[] = capped.map((_, i) => ({
    from: "root",
    to: `dep_${i}`,
  }));
  return formatGraph("LR", "Dependency Graph", nodes, edges);
}

function decorateResult(result: FetchResult): FetchResult {
  const mermaid = mermaidForGithub(result);
  if (mermaid === undefined) return result;
  return { ...result, mermaid };
}

function missingCredentialsError(action: string): FetchResult {
  return {
    status: "error",
    action,
    error_code: "CONFIG_ERROR",
    message:
      "GitHub credentials not configured. Set GITHUB_TOKEN (personal access " +
      "token) or register a credential provider via " +
      ".claude/agents/lib/credential_providers/.",
    retriable: false,
  };
}

export interface FetchOptions {
  client?: GithubClient;
  clientOptions?: GithubClientOptions;
}

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
        throw new Error("unreachable");
    }
  } catch (exc) {
    return {
      status: "error",
      error_code: "VALIDATION_ERROR",
      message: (exc as Error).message,
    };
  }

  let client = options.client;
  if (!client) {
    const opts = options.clientOptions ?? (await loadGithubCredentials());
    if (!opts) return missingCredentialsError(action);
    client = new GithubClient(opts);
  }

  try {
    let result: FetchResult;
    switch (action) {
      case "repo_info":
        result = await fetchRepoInfo(client, validated as RepoInfoValidated);
        break;
      case "search_code":
        result = await fetchSearchCode(client, validated as SearchCodeValidated);
        break;
      case "get_issues":
        result = await fetchGetIssues(client, validated as GetIssuesValidated);
        break;
      case "get_pulls":
        result = await fetchGetPulls(client, validated as GetPullsValidated);
        break;
      case "get_file":
        result = await fetchGetFile(client, validated as GetFileValidated);
        break;
      default:
        return {
          status: "error",
          error_code: "UNKNOWN",
          message: "Unexpected state",
        };
    }
    return decorateResult(result);
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `GitHub API call failed: ${(exc as Error).message}`,
    };
  }
}

// G-AGENT-CLI-DRY: shared parser in .claude/agents/lib/_agent_cli.ts.
// Keep the local ParsedArgs alias so the rest of the file keeps
// reading with the same name.
type ParsedArgs = ParsedAgentArgs;
const parseArgs = (argv: readonly string[]): ParsedArgs =>
  parseAgentArgs(argv, { flags: ["action", "params"] });

const HELP_TEXT = `usage: github_fetch.js [-h] --action {get_file,get_issues,get_pulls,repo_info,search_code} [--params PARAMS]

Fetch data from GitHub

options:
  -h, --help            show this help message and exit
  --action {get_file,get_issues,get_pulls,repo_info,search_code}
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
