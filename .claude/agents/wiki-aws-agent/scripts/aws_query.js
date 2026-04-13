#!/usr/bin/env node
/**
 * AWS data fetcher for the wiki-aws-agent.
 *
 * Library usage:
 *     import { fetch } from "./aws_query.js";
 *     const result = fetch("list_functions", { region: "us-east-1" });
 *
 * CLI usage:
 *     node aws_query.js --action list_functions --params '{"region": "us-east-1"}'
 *     node aws_query.js --action describe_db --params '{"region": "us-east-1", "db_identifier": "acme-rds"}'
 *     node aws_query.js --action list_buckets --params '{"prefix": "acme-"}'
 *     node aws_query.js --action get_metrics --params '{"region": "us-east-1", "namespace": "AWS/Lambda", "metric_name": "Errors"}'
 *
 * This is a TypeScript port of aws_query.py. The Python reference has
 * commented-out boto3 calls (stubbed behaviour); this TS port matches
 * that stub so CLI JSON output is byte-identical.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";
// ── Constants ───────────────────────────────────────────────────────
export const VALID_ACTIONS = new Set([
    "list_functions",
    "describe_db",
    "list_buckets",
    "get_metrics",
]);
const MAX_METRIC_HOURS = 168; // 7 days
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d+$/;
const DB_IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]{0,62}$/;
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
function validateRegion(region) {
    if (!REGION_PATTERN.test(region)) {
        throw new Error(`Invalid region '${region}' — expected format like us-east-1`);
    }
    return region;
}
function validateListFunctions(params) {
    const regionRaw = params["region"];
    const region = validateRegion(typeof regionRaw === "string" ? regionRaw : "");
    const prefixRaw = params["prefix"] ?? "";
    const prefix = typeof prefixRaw === "string" ? prefixRaw : "";
    return { region, prefix };
}
function validateDescribeDb(params) {
    const regionRaw = params["region"];
    const region = validateRegion(typeof regionRaw === "string" ? regionRaw : "");
    const dbIdRaw = params["db_identifier"];
    const dbId = typeof dbIdRaw === "string" ? dbIdRaw : "";
    if (!DB_IDENTIFIER_PATTERN.test(dbId)) {
        throw new Error(`Invalid db_identifier '${dbId}' — must start with letter, alphanumeric and hyphens only`);
    }
    return { region, db_identifier: dbId };
}
function validateListBuckets(params) {
    const prefixRaw = params["prefix"] ?? "";
    const prefix = typeof prefixRaw === "string" ? prefixRaw : "";
    return { prefix };
}
function validateGetMetrics(params) {
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
    if (typeof dimsRaw !== "object" ||
        dimsRaw === null ||
        Array.isArray(dimsRaw)) {
        throw new Error("'dimensions' must be a dict of key-value pairs");
    }
    const hours = Math.min(toInt(params["hours"], 24), MAX_METRIC_HOURS);
    return {
        region,
        namespace: nsRaw,
        metric_name: mnRaw,
        dimensions: dimsRaw,
        hours,
    };
}
function fetchListFunctions(validated) {
    return {
        status: "success",
        action: "list_functions",
        data: {
            region: validated.region,
            functions: [],
            function_count: 0,
        },
    };
}
function fetchDescribeDb(validated) {
    return {
        status: "success",
        action: "describe_db",
        data: {
            region: validated.region,
            db_identifier: validated.db_identifier,
            engine: "",
            engine_version: "",
            instance_class: "",
            status: "",
            endpoint: "",
            storage_gb: 0,
        },
    };
}
function fetchListBuckets(validated) {
    void validated;
    return {
        status: "success",
        action: "list_buckets",
        data: {
            buckets: [],
            bucket_count: 0,
        },
    };
}
function fetchGetMetrics(validated) {
    return {
        status: "success",
        action: "get_metrics",
        data: {
            region: validated.region,
            namespace: validated.namespace,
            metric_name: validated.metric_name,
            dimensions: validated.dimensions,
            hours: validated.hours,
            datapoints: [],
        },
    };
}
/**
 * Fetch data from AWS.
 */
export function fetch(action, params = null) {
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
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "VALIDATION_ERROR",
            message: exc.message,
        };
    }
    try {
        switch (action) {
            case "list_functions":
                return fetchListFunctions(validated);
            case "describe_db":
                return fetchDescribeDb(validated);
            case "list_buckets":
                return fetchListBuckets(validated);
            case "get_metrics":
                return fetchGetMetrics(validated);
        }
    }
    catch (exc) {
        return {
            status: "error",
            error_code: "CONNECTION_ERROR",
            message: `AWS API call failed: ${exc.message}`,
        };
    }
    return {
        status: "error",
        error_code: "UNKNOWN",
        message: "Unexpected state",
    };
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
const HELP_TEXT = `usage: aws_query.js [-h] --action {describe_db,get_metrics,list_buckets,list_functions} [--params PARAMS]

Query AWS resources

options:
  -h, --help            show this help message and exit
  --action {describe_db,get_metrics,list_buckets,list_functions}
                        Action to perform
  --params PARAMS       JSON string of action parameters
`;
export function main(argv = process.argv.slice(2)) {
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
