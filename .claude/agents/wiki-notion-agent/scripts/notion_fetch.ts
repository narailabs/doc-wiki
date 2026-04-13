#!/usr/bin/env node
/**
 * Notion data fetcher for the wiki-notion-agent.
 *
 * Library usage:
 *     import { fetch } from "./notion_fetch.js";
 *     const result = fetch("search", { query: "architecture", max_results: 25 });
 *
 * CLI usage:
 *     node notion_fetch.js --action search --params '{"query": "architecture"}'
 *     node notion_fetch.js --action get_page --params '{"page_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}'
 *     node notion_fetch.js --action get_database --params '{"database_id": "..."}'
 *     node notion_fetch.js --action query_database --params '{"database_id": "...", "filter": {...}}'
 *
 * This is a TypeScript port of notion_fetch.py. The Python reference stubs
 * the HTTP request path — this TS port matches that stub so the CLI JSON
 * output is byte-identical to the Python version.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";

// ── Constants ───────────────────────────────────────────────────────

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
    if (
      typeof dbFilterRaw !== "object" ||
      Array.isArray(dbFilterRaw)
    ) {
      throw new Error("'filter' must be a dict (Notion filter object)");
    }
    dbFilter = dbFilterRaw as Record<string, unknown>;
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return {
    database_id: dbId,
    filter: dbFilter,
    max_results: maxResults,
  };
}

function fetchSearch(validated: SearchValidated): FetchResult {
  void validated;
  return {
    status: "success",
    action: "search",
    data: {
      total: 0,
      results: [],
    },
    truncated: false,
  };
}

function fetchGetPage(validated: GetPageValidated): FetchResult {
  return {
    status: "success",
    action: "get_page",
    data: {
      id: validated.page_id,
      title: "",
      parent_type: "",
      last_edited: null,
      properties: {},
      content_markdown: "",
    },
  };
}

function fetchGetDatabase(validated: GetDatabaseValidated): FetchResult {
  return {
    status: "success",
    action: "get_database",
    data: {
      id: validated.database_id,
      title: "",
      description: "",
      properties: {},
      is_inline: false,
    },
  };
}

function fetchQueryDatabase(validated: QueryDatabaseValidated): FetchResult {
  return {
    status: "success",
    action: "query_database",
    data: {
      database_id: validated.database_id,
      total: 0,
      results: [],
    },
    truncated: false,
  };
}

/**
 * Fetch data from Notion.
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

  try {
    switch (action) {
      case "search":
        return fetchSearch(validated as SearchValidated);
      case "get_page":
        return fetchGetPage(validated as GetPageValidated);
      case "get_database":
        return fetchGetDatabase(validated as GetDatabaseValidated);
      case "query_database":
        return fetchQueryDatabase(validated as QueryDatabaseValidated);
    }
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `Notion API call failed: ${(exc as Error).message}`,
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

const HELP_TEXT = `usage: notion_fetch.js [-h] --action {get_database,get_page,query_database,search} [--params PARAMS]

Fetch data from Notion

options:
  -h, --help            show this help message and exit
  --action {get_database,get_page,query_database,search}
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
