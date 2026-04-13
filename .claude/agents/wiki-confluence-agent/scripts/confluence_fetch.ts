#!/usr/bin/env node
/**
 * Confluence data fetcher for the wiki-confluence-agent.
 *
 * Library usage:
 *     import { fetch } from "./confluence_fetch.js";
 *     const result = await fetch("cql_search", { cql: "space = DEV AND type = page" });
 *
 * CLI usage:
 *     node confluence_fetch.js --action cql_search --params '{"cql": "space = DEV"}'
 *     node confluence_fetch.js --action get_page --params '{"page_id": "12345678"}'
 *     node confluence_fetch.js --action get_space --params '{"space_key": "DEV"}'
 *
 * Read-only Atlassian Confluence client. Credentials resolve via
 * `resolveSecret` with `env_var` fallback (`CONFLUENCE_SITE_URL`,
 * `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`). Falls back to a stubbed
 * response when credentials are unavailable so offline runs stay green.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";
import {
  ConfluenceClient,
  loadConfluenceCredentials,
  type ConfluenceClientOptions,
  type ConfluenceResult,
} from "./lib/confluence_client.js";

export const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "cql_search",
  "get_page",
  "get_space",
]);

const MAX_RESULTS_DEFAULT = 25;
const MAX_RESULTS_CAP = 500;

const PAGE_ID_PATTERN = /^\d+$/;
const SPACE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,19}$/;

export type FetchResult = Record<string, unknown>;
type Params = Record<string, unknown>;

interface CqlSearchValidated {
  cql: string;
  max_results: number;
}
interface GetPageValidated {
  page_id: string;
  expand: string[];
}
interface GetSpaceValidated {
  space_key: string;
}

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

function validateCqlSearch(params: Params): CqlSearchValidated {
  const cql = params["cql"];
  if (!cql || typeof cql !== "string") {
    throw new Error("cql_search requires a non-empty 'cql' string");
  }
  const maxResults = Math.min(
    toInt(params["max_results"], MAX_RESULTS_DEFAULT),
    MAX_RESULTS_CAP,
  );
  return { cql: cql.trim(), max_results: maxResults };
}

function validateGetPage(params: Params): GetPageValidated {
  const pageIdRaw = params["page_id"];
  const pageId =
    pageIdRaw === undefined || pageIdRaw === null ? "" : String(pageIdRaw);
  if (!PAGE_ID_PATTERN.test(pageId)) {
    throw new Error(`Invalid page_id '${pageId}' — expected numeric ID`);
  }
  const expand = params["expand"] ?? [];
  if (!Array.isArray(expand) || !expand.every((x) => typeof x === "string")) {
    throw new Error("'expand' must be a list of strings");
  }
  return { page_id: pageId, expand: expand as string[] };
}

function validateGetSpace(params: Params): GetSpaceValidated {
  const spaceKeyRaw = params["space_key"];
  const spaceKey = typeof spaceKeyRaw === "string" ? spaceKeyRaw : "";
  if (!SPACE_KEY_PATTERN.test(spaceKey)) {
    throw new Error(
      `Invalid space_key '${spaceKey}' — expected uppercase key like DEV`,
    );
  }
  return { space_key: spaceKey };
}

function errorFromClient<T>(
  result: Extract<ConfluenceResult<T>, { ok: false }>,
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

async function fetchCqlSearch(
  client: ConfluenceClient,
  validated: CqlSearchValidated,
): Promise<FetchResult> {
  const result = await client.searchCql(validated.cql, validated.max_results);
  if (!result.ok) return errorFromClient(result, "cql_search");
  const results = Array.isArray(result.data.results) ? result.data.results : [];
  const total = result.data.totalSize ?? results.length;
  return {
    status: "success",
    action: "cql_search",
    data: {
      total,
      pages: results.map((p) => ({
        id: p.id,
        title: p.title ?? "",
        space_key: p.space?.key ?? "",
        version: p.version?.number ?? 0,
        last_modified: p.version?.when ?? null,
      })),
    },
    truncated: results.length >= validated.max_results && total > results.length,
  };
}

async function fetchGetPage(
  client: ConfluenceClient,
  validated: GetPageValidated,
): Promise<FetchResult> {
  const expand =
    validated.expand.length > 0
      ? validated.expand
      : ["body.storage", "space", "version"];
  const result = await client.getContent(validated.page_id, expand);
  if (!result.ok) return errorFromClient(result, "get_page");
  const data = result.data;
  return {
    status: "success",
    action: "get_page",
    data: {
      id: data.id,
      title: data.title ?? "",
      space_key: data.space?.key ?? "",
      version: data.version?.number ?? 0,
      body_markdown: data.body?.storage?.value ?? "",
      last_modified: data.version?.when ?? null,
    },
  };
}

async function fetchGetSpace(
  client: ConfluenceClient,
  validated: GetSpaceValidated,
): Promise<FetchResult> {
  const result = await client.getSpace(validated.space_key);
  if (!result.ok) return errorFromClient(result, "get_space");
  const data = result.data;
  return {
    status: "success",
    action: "get_space",
    data: {
      key: data.key,
      name: data.name ?? "",
      description: data.description?.plain?.value ?? "",
      type: data.type ?? "global",
      homepage_id: data.homepage?.id ?? null,
    },
  };
}

function missingCredentialsError(action: string): FetchResult {
  return {
    status: "error",
    action,
    error_code: "CONFIG_ERROR",
    message:
      "Confluence credentials not configured. Set CONFLUENCE_SITE_URL, " +
      "CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN (or register a credential " +
      "provider via .claude/agents/lib/credential_providers/).",
    retriable: false,
  };
}

export interface FetchOptions {
  client?: ConfluenceClient;
  clientOptions?: ConfluenceClientOptions;
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
  let validated: CqlSearchValidated | GetPageValidated | GetSpaceValidated;
  try {
    if (action === "cql_search") validated = validateCqlSearch(p);
    else if (action === "get_page") validated = validateGetPage(p);
    else validated = validateGetSpace(p);
  } catch (exc) {
    return {
      status: "error",
      error_code: "VALIDATION_ERROR",
      message: (exc as Error).message,
    };
  }

  let client = options.client;
  if (!client) {
    const opts = options.clientOptions ?? (await loadConfluenceCredentials());
    if (!opts) {
      return missingCredentialsError(action);
    }
    client = new ConfluenceClient(opts);
  }

  try {
    if (action === "cql_search") {
      return await fetchCqlSearch(client, validated as CqlSearchValidated);
    }
    if (action === "get_page") {
      return await fetchGetPage(client, validated as GetPageValidated);
    }
    return await fetchGetSpace(client, validated as GetSpaceValidated);
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `Confluence API call failed: ${(exc as Error).message}`,
    };
  }
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

const HELP_TEXT = `usage: confluence_fetch.js [-h] --action {cql_search,get_page,get_space} [--params PARAMS]

Fetch data from Confluence

options:
  -h, --help            show this help message and exit
  --action {cql_search,get_page,get_space}
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
