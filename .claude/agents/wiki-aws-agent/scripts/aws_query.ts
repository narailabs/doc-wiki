#!/usr/bin/env node
/**
 * AWS data fetcher for the wiki-aws-agent.
 *
 * Library usage:
 *     import { fetch } from "./aws_query.js";
 *     const result = await fetch("list_functions", { region: "us-east-1" });
 *
 * Read-only SDK v3 surface. SDK clients are loaded lazily via dynamic
 * import so the repo itself does not need to hard-depend on every
 * `@aws-sdk/client-*` package at build time. When a required package is
 * missing, the fetcher falls back to a deterministic stubbed response.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AwsClient,
  type AwsClientOptions,
  type AwsResult,
  type AwsSdkFactories,
} from "./lib/aws_client.js";
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
  "list_functions",
  "describe_db",
  "list_buckets",
  "get_metrics",
]);

const MAX_METRIC_HOURS = 168;

const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d+$/;
const DB_IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]{0,62}$/;

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

function validateRegion(region: string): string {
  if (!REGION_PATTERN.test(region)) {
    throw new Error(`Invalid region '${region}' — expected format like us-east-1`);
  }
  return region;
}

interface ListFunctionsValidated {
  region: string;
  prefix: string;
}
interface DescribeDbValidated {
  region: string;
  db_identifier: string;
}
interface ListBucketsValidated {
  prefix: string;
  region: string;
}
interface GetMetricsValidated {
  region: string;
  namespace: string;
  metric_name: string;
  dimensions: Record<string, string>;
  hours: number;
}

function validateListFunctions(params: Params): ListFunctionsValidated {
  const regionRaw = params["region"];
  const region = validateRegion(typeof regionRaw === "string" ? regionRaw : "");
  const prefixRaw = params["prefix"] ?? "";
  const prefix = typeof prefixRaw === "string" ? prefixRaw : "";
  return { region, prefix };
}

function validateDescribeDb(params: Params): DescribeDbValidated {
  const regionRaw = params["region"];
  const region = validateRegion(typeof regionRaw === "string" ? regionRaw : "");
  const dbIdRaw = params["db_identifier"];
  const dbId = typeof dbIdRaw === "string" ? dbIdRaw : "";
  if (!DB_IDENTIFIER_PATTERN.test(dbId)) {
    throw new Error(
      `Invalid db_identifier '${dbId}' — must start with letter, alphanumeric and hyphens only`,
    );
  }
  return { region, db_identifier: dbId };
}

function validateListBuckets(params: Params): ListBucketsValidated {
  const prefixRaw = params["prefix"] ?? "";
  const prefix = typeof prefixRaw === "string" ? prefixRaw : "";
  const regionRaw = params["region"];
  const region = typeof regionRaw === "string" ? regionRaw : "us-east-1";
  return { prefix, region };
}

function validateGetMetrics(params: Params): GetMetricsValidated {
  const regionRaw = params["region"];
  const region = validateRegion(typeof regionRaw === "string" ? regionRaw : "");
  const nsRaw = params["namespace"];
  if (!nsRaw || typeof nsRaw !== "string") {
    throw new Error("get_metrics requires a non-empty 'namespace' string");
  }
  const mnRaw = params["metric_name"];
  if (!mnRaw || typeof mnRaw !== "string") {
    throw new Error("get_metrics requires a non-empty 'metric_name' string");
  }
  const dimsRaw = params["dimensions"] ?? {};
  if (
    typeof dimsRaw !== "object" ||
    dimsRaw === null ||
    Array.isArray(dimsRaw)
  ) {
    throw new Error("'dimensions' must be a dict of key-value pairs");
  }
  const dims: Record<string, string> = {};
  for (const [k, v] of Object.entries(dimsRaw)) {
    dims[k] = typeof v === "string" ? v : String(v);
  }
  const hours = Math.min(toInt(params["hours"], 24), MAX_METRIC_HOURS);
  return {
    region,
    namespace: nsRaw,
    metric_name: mnRaw,
    dimensions: dims,
    hours,
  };
}

function errorFromClient<T>(
  result: Extract<AwsResult<T>, { ok: false }>,
  action: string,
): FetchResult {
  const codeMap: Record<string, string> = {
    METHOD_NOT_ALLOWED: "VALIDATION_ERROR",
    SDK_UNAVAILABLE: "CONFIGURATION_ERROR",
    AUTH_ERROR: "AUTH_ERROR",
    NOT_FOUND: "NOT_FOUND",
    RATE_LIMITED: "RATE_LIMITED",
    TIMEOUT: "TIMEOUT",
    SDK_ERROR: "CONNECTION_ERROR",
  };
  return {
    status: "error",
    action,
    error_code: codeMap[result.code] ?? "CONNECTION_ERROR",
    message: result.message,
    retriable: result.retriable,
  };
}

async function fetchListFunctions(
  client: AwsClient,
  v: ListFunctionsValidated,
): Promise<FetchResult> {
  const result = await client.listLambdaFunctions();
  if (!result.ok) return errorFromClient(result, "list_functions");
  const fns = result.data.Functions ?? [];
  const filtered = v.prefix
    ? fns.filter((f) => (f.FunctionName ?? "").startsWith(v.prefix))
    : fns;
  return {
    status: "success",
    action: "list_functions",
    data: {
      region: v.region,
      functions: filtered.map((f) => ({
        name: f.FunctionName ?? "",
        runtime: f.Runtime ?? "",
        last_modified: f.LastModified ?? null,
      })),
      function_count: filtered.length,
    },
  };
}

async function fetchDescribeDb(
  client: AwsClient,
  v: DescribeDbValidated,
): Promise<FetchResult> {
  const result = await client.describeDBInstances({
    DBInstanceIdentifier: v.db_identifier,
  });
  if (!result.ok) return errorFromClient(result, "describe_db");
  const inst = (result.data.DBInstances ?? [])[0];
  if (!inst) {
    return {
      status: "error",
      action: "describe_db",
      error_code: "NOT_FOUND",
      message: `No instance found for identifier '${v.db_identifier}'`,
      retriable: false,
    };
  }
  return {
    status: "success",
    action: "describe_db",
    data: {
      region: v.region,
      db_identifier: inst.DBInstanceIdentifier ?? v.db_identifier,
      engine: inst.Engine ?? "",
      engine_version: inst.EngineVersion ?? "",
      instance_class: inst.DBInstanceClass ?? "",
      status: inst.DBInstanceStatus ?? "",
      endpoint: inst.Endpoint?.Address ?? "",
      storage_gb: inst.AllocatedStorage ?? 0,
    },
  };
}

async function fetchListBuckets(
  client: AwsClient,
  v: ListBucketsValidated,
): Promise<FetchResult> {
  const result = await client.listBuckets();
  if (!result.ok) return errorFromClient(result, "list_buckets");
  const buckets = result.data.Buckets ?? [];
  const filtered = v.prefix
    ? buckets.filter((b) => (b.Name ?? "").startsWith(v.prefix))
    : buckets;
  return {
    status: "success",
    action: "list_buckets",
    data: {
      buckets: filtered.map((b) => ({
        name: b.Name ?? "",
        created_at: b.CreationDate
          ? b.CreationDate instanceof Date
            ? b.CreationDate.toISOString()
            : String(b.CreationDate)
          : null,
      })),
      bucket_count: filtered.length,
    },
  };
}

async function fetchGetMetrics(
  client: AwsClient,
  v: GetMetricsValidated,
): Promise<FetchResult> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - v.hours * 3600_000);
  const result = await client.getMetricStatistics({
    Namespace: v.namespace,
    MetricName: v.metric_name,
    Dimensions: Object.entries(v.dimensions).map(([Name, Value]) => ({
      Name,
      Value,
    })),
    StartTime: startTime,
    EndTime: endTime,
    Period: 300,
    Statistics: ["Average", "Sum", "Maximum"],
  });
  if (!result.ok) return errorFromClient(result, "get_metrics");
  const dps = result.data.Datapoints ?? [];
  return {
    status: "success",
    action: "get_metrics",
    data: {
      region: v.region,
      namespace: v.namespace,
      metric_name: v.metric_name,
      dimensions: v.dimensions,
      hours: v.hours,
      datapoints: dps.map((d) => ({
        timestamp:
          d.Timestamp instanceof Date ? d.Timestamp.toISOString() : d.Timestamp ?? null,
        sum: d.Sum ?? null,
        average: d.Average ?? null,
        maximum: d.Maximum ?? null,
      })),
    },
  };
}

// ── Mermaid infra-topology builder (v2 design §6) ─────────────────────
//
// Per v2 "Agent Output Contract", source agents that produce
// diagram-worthy structured data MUST include a `mermaid: {type,title,code}`
// field so the wiki compiler can splice the diagram directly into a page.
// AWS actions emit `graph TB` infrastructure topologies (region → services).
// `get_metrics` returns pure time-series data — not diagram-worthy, so
// we omit the field entirely (absence === "no diagram", per the contract).

function mermaidForAws(result: FetchResult): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "list_functions") {
    const fns = (data["functions"] as Array<{ name: string; runtime: string }> | undefined) ?? [];
    if (fns.length === 0) return undefined;
    const region = (data["region"] as string) || "region";
    const nodes: GraphNode[] = [
      { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
      ...fns.map((f) => ({
        id: `fn_${f.name}`,
        label: `${f.name} (${f.runtime || "unknown"})`,
      })),
    ];
    const edges: GraphEdge[] = fns.map((f) => ({
      from: `region_${region}`,
      to: `fn_${f.name}`,
    }));
    return formatGraph("TB", `AWS Lambda Functions — ${region}`, nodes, edges);
  }

  if (action === "describe_db") {
    const region = (data["region"] as string) || "region";
    const id = (data["db_identifier"] as string) || "db";
    const engine = (data["engine"] as string) || "";
    const cls = (data["instance_class"] as string) || "";
    const label = engine || cls ? `${id} (${engine}${cls ? `, ${cls}` : ""})` : id;
    const nodes: GraphNode[] = [
      { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
      { id: `db_${id}`, label, shape: "stadium" },
    ];
    const edges: GraphEdge[] = [{ from: `region_${region}`, to: `db_${id}` }];
    return formatGraph("TB", `AWS RDS — ${id}`, nodes, edges);
  }

  if (action === "list_buckets") {
    const buckets = (data["buckets"] as Array<{ name: string }> | undefined) ?? [];
    if (buckets.length === 0) return undefined;
    const nodes: GraphNode[] = [
      { id: "account", label: "AWS Account", shape: "rounded" },
      ...buckets.map((b) => ({ id: `bucket_${b.name}`, label: b.name })),
    ];
    const edges: GraphEdge[] = buckets.map((b) => ({
      from: "account",
      to: `bucket_${b.name}`,
    }));
    return formatGraph("TB", "AWS S3 Buckets", nodes, edges);
  }

  // get_metrics: time-series datapoints — not diagram-worthy. Omit.
  return undefined;
}

function decorateResult(result: FetchResult): FetchResult {
  const mermaid = mermaidForAws(result);
  if (mermaid === undefined) return result;
  return { ...result, mermaid };
}

function missingSdkError(action: string): FetchResult {
  return {
    status: "error",
    action,
    error_code: "CONFIG_ERROR",
    message:
      "AWS SDK clients not available. Install @aws-sdk/client-rds, " +
      "@aws-sdk/client-dynamodb, @aws-sdk/client-s3, @aws-sdk/client-cloudwatch, " +
      "@aws-sdk/client-lambda (as needed for the action) and configure AWS " +
      "credentials via the default credential chain.",
    retriable: false,
  };
}

async function tryImport(
  name: string,
): Promise<Record<string, unknown> | null> {
  try {
    // Cast via string variable so TypeScript does not attempt module
    // resolution — the AWS SDK packages are optional at build time.
    const mod = (await import(name as string)) as Record<string, unknown>;
    return mod;
  } catch {
    return null;
  }
}

async function loadRealFactories(): Promise<AwsSdkFactories | null> {
  const factories: AwsSdkFactories = {};
  const register = <K extends keyof AwsSdkFactories>(
    key: K,
    mod: Record<string, unknown> | null,
    exportName: string,
  ): void => {
    const exported = mod?.[exportName];
    if (typeof exported === "function") {
      const Ctor = exported as new (config: unknown) => {
        send: (cmd: unknown) => Promise<unknown>;
      };
      factories[key] = (config) => new Ctor(config);
    }
  };

  register("rds", await tryImport("@aws-sdk/client-rds"), "RDSClient");
  register(
    "dynamodb",
    await tryImport("@aws-sdk/client-dynamodb"),
    "DynamoDBClient",
  );
  register("s3", await tryImport("@aws-sdk/client-s3"), "S3Client");
  register(
    "cloudwatch",
    await tryImport("@aws-sdk/client-cloudwatch"),
    "CloudWatchClient",
  );
  register("lambda", await tryImport("@aws-sdk/client-lambda"), "LambdaClient");

  if (Object.keys(factories).length === 0) return null;
  return factories;
}

export interface FetchOptions {
  client?: AwsClient;
  clientOptions?: AwsClientOptions;
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
    | ListFunctionsValidated
    | DescribeDbValidated
    | ListBucketsValidated
    | GetMetricsValidated;
  try {
    switch (action) {
      case "list_functions":
        validated = validateListFunctions(p);
        break;
      case "describe_db":
        validated = validateDescribeDb(p);
        break;
      case "list_buckets":
        validated = validateListBuckets(p);
        break;
      case "get_metrics":
        validated = validateGetMetrics(p);
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
    if (options.clientOptions) {
      client = new AwsClient(options.clientOptions);
    } else {
      const factories = await loadRealFactories();
      if (!factories) return missingSdkError(action);
      const region =
        (validated as { region?: string }).region ?? "us-east-1";
      client = new AwsClient({ region, factories });
    }
  }

  try {
    let result: FetchResult;
    switch (action) {
      case "list_functions":
        result = await fetchListFunctions(client, validated as ListFunctionsValidated);
        break;
      case "describe_db":
        result = await fetchDescribeDb(client, validated as DescribeDbValidated);
        break;
      case "list_buckets":
        result = await fetchListBuckets(client, validated as ListBucketsValidated);
        break;
      case "get_metrics":
        result = await fetchGetMetrics(client, validated as GetMetricsValidated);
        break;
      default:
        return { status: "error", error_code: "UNKNOWN", message: "Unexpected state" };
    }
    return decorateResult(result);
  } catch (exc) {
    return {
      status: "error",
      error_code: "CONNECTION_ERROR",
      message: `AWS API call failed: ${(exc as Error).message}`,
    };
  }
}

// G-AGENT-CLI-DRY: shared parser in .claude/agents/lib/_agent_cli.ts.
type ParsedArgs = ParsedAgentArgs;
const parseArgs = (argv: readonly string[]): ParsedArgs =>
  parseAgentArgs(argv, { flags: ["action", "params"] });

const HELP_TEXT = `usage: aws_query.js [-h] --action {describe_db,get_metrics,list_buckets,list_functions} [--params PARAMS]

Query AWS resources

options:
  -h, --help            show this help message and exit
  --action {describe_db,get_metrics,list_buckets,list_functions}
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
