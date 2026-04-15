#!/usr/bin/env node
/**
 * Notion data fetcher for the wiki-notion-agent.
 *
 * Library usage:
 *     import { fetch } from "./notion_fetch.js";
 *     const result = await fetch("search", { query: "architecture", max_results: 25 });
 *
 * Read-only Notion Public API client. Credentials resolve via
 * `resolveSecret` with `env_var` fallback (`NOTION_TOKEN`).
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../lib/_json_py.js";
import {
  NotionClient,
  extractTitleFromPage,
  loadNotionCredentials,
  type NotionClientOptions,
  type NotionResult,
} from "./lib/notion_client.js";
import {
  formatGraph,
  type GraphEdge,
  type GraphNode,
  type MermaidBlock,
} from "../../lib/mermaid_format.js";

export const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "search",
  "get_page",
  "get_database",
  "query_database",
]);

const MAX_RESULTS_DEFAULT = 25;
const MAX_RESULTS_CAP = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_NO_DASH_PATTERN = /^[0-9a-f]{32}$/;
const VALID_FILTER_TYPES: ReadonlySet<string> = new Set(["page", "database"]);

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

function validateUuid(value: string, fieldName: string): string {
  const v = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(v) && !UUID_NO_DASH_PATTERN.test(v)) {
    throw new Error(`Invalid ${fieldName} '${value}' — expected UUID format`);
  }
  return v;
}

interface SearchValidated {
  query: string;
  filter_type: string;
  max_results: number;
}
interface GetPageValidated {
  page_id: string;
}
interface GetDatabaseValidated {
  database_id: string;
}
interface QueryDatabaseValidated {
  database_id: string;
  filter: Record<string, unknown> | null;
  max_results: number;
}

function validateSearch(params: Params): SearchValidated {
  const queryRaw = params["query"];
  if (!queryRaw || typeof queryRaw !== "string") {
    throw new Error("search requires a non-empty 'query' string");
  }
  const filterTypeRaw = params["filter_type"] ?? "";
  const filterType = typeof filterTypeRaw === "string" ? filterTypeRaw : "";
  if (filterType && !VALID_FILTER_TYPES.has(filterType)) {
    throw new Error(
      `Invalid filter_type '${filterType}' — expected page or database`,
    );
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return {
    query: queryRaw.trim(),
    filter_type: filterType,
    max_results: maxResults,
  };
}

function validateGetPage(params: Params): GetPageValidated {
  const raw = params["page_id"];
  const pageId = validateUuid(typeof raw === "string" ? raw : "", "page_id");
  return { page_id: pageId };
}

function validateGetDatabase(params: Params): GetDatabaseValidated {
  const raw = params["database_id"];
  const dbId = validateUuid(typeof raw === "string" ? raw : "", "database_id");
  return { database_id: dbId };
}

function validateQueryDatabase(params: Params): QueryDatabaseValidated {
  const raw = params["database_id"];
  const dbId = validateUuid(typeof raw === "string" ? raw : "", "database_id");
  const dbFilterRaw = params["filter"];
  let dbFilter: Record<string, unknown> | null = null;
  if (dbFilterRaw !== undefined && dbFilterRaw !== null) {
    if (typeof dbFilterRaw !== "object" || Array.isArray(dbFilterRaw)) {
      throw new Error("'filter' must be a dict (Notion filter object)");
    }
    dbFilter = dbFilterRaw as Record<string, unknown>;
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return { database_id: dbId, filter: dbFilter, max_results: maxResults };
}

function errorFromClient<T>(
  result: Extract<NotionResult<T>, { ok: false }>,
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

async function fetchSearch(
  client: NotionClient,
  v: SearchValidated,
): Promise<FetchResult> {
  const result = await client.search(
    v.query,
    v.filter_type || undefined,
    v.max_results,
  );
  if (!result.ok) return errorFromClient(result, "search");
  const results = Array.isArray(result.data.results) ? result.data.results : [];
  return {
    status: "success",
    action: "search",
    data: {
      total: results.length,
      results: results.map((r) => ({
        id: r.id,
        object_type:
          "last_edited_time" in r && "properties" in r ? "page" : "database",
      })),
    },
    truncated: Boolean(result.data.has_more),
  };
}

async function fetchGetPage(
  client: NotionClient,
  v: GetPageValidated,
): Promise<FetchResult> {
  const result = await client.getPage(v.page_id);
  if (!result.ok) return errorFromClient(result, "get_page");
  const page = result.data;
  return {
    status: "success",
    action: "get_page",
    data: {
      id: page.id,
      title: extractTitleFromPage(page),
      parent_type: page.parent?.type ?? "",
      last_edited: page.last_edited_time ?? null,
      properties: page.properties ?? {},
      content_markdown: "",
    },
  };
}

async function fetchGetDatabase(
  client: NotionClient,
  v: GetDatabaseValidated,
): Promise<FetchResult> {
  const result = await client.getDatabase(v.database_id);
  if (!result.ok) return errorFromClient(result, "get_database");
  const db = result.data;
  return {
    status: "success",
    action: "get_database",
    data: {
      id: db.id,
      title: (db.title ?? []).map((t) => t.plain_text ?? "").join(""),
      description: (db.description ?? []).map((t) => t.plain_text ?? "").join(""),
      properties: db.properties ?? {},
      is_inline: db.is_inline ?? false,
    },
  };
}

async function fetchQueryDatabase(
  client: NotionClient,
  v: QueryDatabaseValidated,
): Promise<FetchResult> {
  const result = await client.queryDatabase(v.database_id, v.filter, v.max_results);
  if (!result.ok) return errorFromClient(result, "query_database");
  const results = Array.isArray(result.data.results) ? result.data.results : [];
  return {
    status: "success",
    action: "query_database",
    data: {
      database_id: v.database_id,
      total: results.length,
      results: results.map((r) => ({
        id: r.id,
        title: extractTitleFromPage(r),
        last_edited: r.last_edited_time ?? null,
      })),
    },
    truncated: Boolean(result.data.has_more),
  };
}

/**
 * G-AGENT-MERMAID: build a page-tree `graph TD` for diagram-worthy
 * Notion actions.
 *
 * - `search`: root = "Results", children = each hit (labeled with the
 *   hit's object_type for quick visual typing).
 * - `query_database`: root = database_id, children = queried pages by
 *   title.
 * Other actions (get_page, get_database) return a single scalar record
 * that isn't diagram-worthy, so mermaid is omitted.
 */
function mermaidForNotion(result: FetchResult): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "search") {
    const results =
      (data["results"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (results.length === 0) return undefined;
    const capped = results.slice(0, 30);
    const nodes: GraphNode[] = [
      { id: "root", label: "Search Results", shape: "rounded" },
    ];
    const edges: GraphEdge[] = [];
    for (const [i, r] of capped.entries()) {
      const id = ((r["id"] as string | undefined) ?? `r${i}`).slice(0, 8);
      const objType = ((r["object_type"] as string | undefined) ?? "page")
        .slice(0, 20);
      nodes.push({ id: `r${i}`, label: `${objType} ${id}` });
      edges.push({ from: "root", to: `r${i}` });
    }
    return formatGraph("TB", "Notion Search Hierarchy", nodes, edges);
  }

  if (action === "query_database") {
    const databaseId = (data["database_id"] as string | undefined) ?? "database";
    const results =
      (data["results"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (results.length === 0) return undefined;
    const capped = results.slice(0, 30);
    const dbLabel = databaseId.length > 8 ? databaseId.slice(0, 8) + "…" : databaseId;
    const nodes: GraphNode[] = [
      { id: "db", label: `DB ${dbLabel}`, shape: "rounded" },
    ];
    const edges: GraphEdge[] = [];
    for (const [i, r] of capped.entries()) {
      const title = ((r["title"] as string | undefined) ?? `row ${i}`).slice(0, 60);
      nodes.push({ id: `p${i}`, label: title });
      edges.push({ from: "db", to: `p${i}` });
    }
    return formatGraph("TB", "Notion Page Tree", nodes, edges);
  }

  return undefined;
}

function decorateResult(result: FetchResult): FetchResult {
  const mermaid = mermaidForNotion(result);
  if (mermaid === undefined) return result;
  return { ...result, mermaid };
}

function missingCredentialsError(action: string): FetchResult {
  return {
    status: "error",
    action,
    error_code: "CONFIG_ERROR",
    message:
      "Notion credentials not configured. Set NOTION_TOKEN or register a " +
      "credential provider via .claude/agents/lib/credential_providers/.",
    retriable: false,
  };
}

export interface FetchOptions {
  client?: NotionClient;
  clientOptions?: NotionClientOptions;
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
    | SearchValidated
    | GetPageValidated
    | GetDatabaseValidated
    | QueryDatabaseValidated;
  try {
    switch (action) {
      case "search":
        validated = validateSearch(p);
        break;
      case "get_page":
        validated = validateGetPage(p);
        break;
      case "get_database":
        validated = validateGetDatabase(p);
        break;
      case "query_database":
        validated = validateQueryDatabase(p);
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
    const opts = options.clientOptions ?? (await loadNotionCredentials());
    if (!opts) return missingCredentialsError(action);
    client = new NotionClient(opts);
  }

  try {
    let result: FetchResult | undefined;
    switch (action) {
      case "search":
        result = await fetchSearch(client, validated as SearchValidated);
        break;
      case "get_page":
        result = await fetchGetPage(client, validated as GetPageValidated);
        break;
      case "get_database":
        result = await fetchGetDatabase(
          client,
          validated as GetDatabaseValidated,
        );
        break;
      case "query_database":
        result = await fetchQueryDatabase(
          client,
          validated as QueryDatabaseValidated,
        );
        break;
    }
    if (result !== undefined) return decorateResult(result);
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `Notion API call failed: ${(exc as Error).message}`,
    };
  }

  return { status: "error", error_code: "UNKNOWN", message: "Unexpected state" };
}

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

const HELP_TEXT = `usage: notion_fetch.js [-h] --action {get_database,get_page,query_database,search} [--params PARAMS]

Fetch data from Notion

options:
  -h, --help            show this help message and exit
  --action {get_database,get_page,query_database,search}
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
