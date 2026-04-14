#!/usr/bin/env node
/**
 * Event logger for the documentation wiki.
 *
 * Logs structured events to log/events.jsonl and computes aggregate statistics.
 *
 * Usage as a library:
 *     import { logEvent, getStats } from "./event_logger.js";
 *     logEvent("/path/to/wiki", "ingest", {source: "slides.pptx", cost_usd: 0.05});
 *     const stats = getStats("/path/to/wiki", "2026-04-01T00:00:00+00:00");
 *
 * Usage as a script:
 *     node event_logger.js log --op ingest --wiki-root /path --details '{"source":"slides.pptx"}'
 *     node event_logger.js stats --wiki-root /path --since 7d
 *
 * This is a TypeScript port of event_logger.py; file output and CLI output
 * match the Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pyFloat, pythonJsonDumps, pythonJsonDumpsFloats } from "./_json_py.js";

// ── Timestamp helpers ───────────────────────────────────────────────

/**
 * Produce a Python-compatible `datetime.now(timezone.utc).isoformat()`
 * for the given date. Python's default isoformat:
 *   - no microseconds when they are exactly 0 (`2026-04-12T10:30:00+00:00`)
 *   - 6-digit microseconds otherwise (`2026-04-12T10:30:00.123456+00:00`)
 *   - UTC offset rendered as `+00:00`, not `Z`
 *
 * JavaScript's `Date` has millisecond precision, so when microseconds are
 * present we pad with 3 trailing zeros to produce 6 digits.
 */
export function pythonIsoformatUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const se = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = d.getUTCMilliseconds();
  if (ms === 0) {
    // Mirror Python's omission of the microseconds component when it's zero.
    return `${y}-${mo}-${da}T${h}:${mi}:${se}+00:00`;
  }
  const micros = String(ms).padStart(3, "0") + "000";
  return `${y}-${mo}-${da}T${h}:${mi}:${se}.${micros}+00:00`;
}

/**
 * Parse a Python-compatible ISO 8601 timestamp into epoch milliseconds.
 * Accepts:
 *   - "YYYY-MM-DDTHH:MM:SS[.ffffff][+HH:MM | -HH:MM | Z]"
 *   - a naive form without offset (treated as local time, matching Python)
 * Returns NaN for unparseable inputs so callers can detect errors.
 */
export function parsePythonIsoformat(s: string): number {
  // First try native Date parsing — handles most ISO-8601 inputs the same
  // way Python does, including `Z` and `+00:00`. But Python accepts naive
  // timestamps too, which Date() treats as local. That's acceptable since
  // Python's fromisoformat() treats naive input as local-naive as well.
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  return NaN;
}

// ── Per-agent-call event shape (v2 §13) ─────────────────────────────

/**
 * One sub-agent dispatch logged as part of a parent op (e.g. `ingest`
 * dispatches `wiki-jira-agent` then `wiki-db-agent`, producing two
 * `AgentCallEvent` entries under the enclosing event's `agent_calls[]`).
 *
 * Per v2 design §13. Fields whose values the orchestrator cannot cheaply
 * compute (e.g. `tokens_in` for a deterministic no-LLM agent) should be
 * set to 0.
 */
export interface AgentCallEvent {
  agent: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  elapsed_ms: number;
  status: "success" | "error" | "skipped";
  /** Optional — used for deterministic (non-LLM) agents. */
  note?: string;
}

/**
 * When `details.agent_calls` is an array of `AgentCallEvent`, compute
 * `total_tokens_in`, `total_tokens_out`, `total_cost_usd` if the caller
 * didn't pre-populate them. Returns a shallow copy so we don't mutate
 * the caller's object.
 */
function _normalizeAgentCalls(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const calls = details["agent_calls"];
  if (!Array.isArray(calls)) return details;
  const out: Record<string, unknown> = { ...details };
  let ti = 0;
  let to = 0;
  let cu = 0;
  for (const c of calls) {
    if (c && typeof c === "object") {
      const rec = c as Record<string, unknown>;
      if (typeof rec["tokens_in"] === "number") ti += rec["tokens_in"];
      if (typeof rec["tokens_out"] === "number") to += rec["tokens_out"];
      if (typeof rec["cost_usd"] === "number") cu += rec["cost_usd"];
    }
  }
  if (out["total_tokens_in"] === undefined) out["total_tokens_in"] = ti;
  if (out["total_tokens_out"] === undefined) out["total_tokens_out"] = to;
  if (out["total_cost_usd"] === undefined) out["total_cost_usd"] = cu;
  return out;
}

// ── Paths ───────────────────────────────────────────────────────────

function _eventsPath(wikiRoot: string): string {
  const p = path.join(wikiRoot, "log", "events.jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

// ── Logging ─────────────────────────────────────────────────────────

/**
 * Append a JSON-line event to `log/events.jsonl`.
 *
 * Auto-adds an ISO timestamp in the `ts` field.
 * All keys from `details` are merged into the top-level entry.
 *
 * Returns the full logged entry dict.
 */
export function logEvent(
  wikiRoot: string,
  op: string,
  details: Record<string, unknown>,
): Record<string, unknown> {
  // Normalize agent_calls[] → compute totals if caller omitted them.
  const normalized = _normalizeAgentCalls(details);

  // Preserve Python's dict-literal key order: `ts` first, then `op`,
  // then the merged `details` keys in insertion order.
  const entry: Record<string, unknown> = {
    ts: pythonIsoformatUtc(new Date()),
    op,
  };
  for (const [k, v] of Object.entries(normalized)) {
    entry[k] = v;
  }

  const p = _eventsPath(wikiRoot);
  // Python uses json.dumps(entry) (default separators: ", " and ": ").
  fs.appendFileSync(p, pythonJsonDumps(entry) + "\n");

  return entry;
}

// ── Stats ───────────────────────────────────────────────────────────

function _readEvents(
  wikiRoot: string,
  since: string | null = null,
): Array<Record<string, unknown>> {
  const p = _eventsPath(wikiRoot);
  if (!fs.existsSync(p)) {
    return [];
  }

  const sinceMs =
    since !== null && since !== undefined ? parsePythonIsoformat(since) : null;

  const raw = fs.readFileSync(p, { encoding: "utf-8" });
  const events: Array<Record<string, unknown>> = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const entry = JSON.parse(line) as Record<string, unknown>;
    if (sinceMs !== null && !Number.isNaN(sinceMs)) {
      const entryTs = entry["ts"];
      const entryMs =
        typeof entryTs === "string" ? parsePythonIsoformat(entryTs) : NaN;
      if (!Number.isNaN(entryMs) && entryMs < sinceMs) {
        continue;
      }
    }
    events.push(entry);
  }
  return events;
}

/**
 * Convert a relative duration like `'7d'` or `'24h'` to an ISO timestamp
 * (relative to "now"). Falls back to returning the input unchanged when
 * it does not match the `N[dhm]` shape, matching the Python helper.
 */
export function parseRelativeSince(sinceStr: string): string {
  const match = sinceStr.match(/^(\d+)([dhm])$/);
  if (!match) {
    return sinceStr;
  }
  const value = parseInt(match[1] ?? "0", 10);
  const unit = match[2];
  let deltaMs: number;
  if (unit === "d") {
    deltaMs = value * 86_400_000;
  } else if (unit === "h") {
    deltaMs = value * 3_600_000;
  } else if (unit === "m") {
    deltaMs = value * 60_000;
  } else {
    return sinceStr;
  }
  return pythonIsoformatUtc(new Date(Date.now() - deltaMs));
}

/** Mean of a non-empty list of numbers (matches `statistics.mean`). */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Median of a non-empty list of numbers (matches `statistics.median`).
 * For even-length lists, returns the average of the two middle values.
 * Accepts either a pre-sorted copy or an unsorted one (we sort internally).
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    const lo = sorted[mid - 1] ?? 0;
    const hi = sorted[mid] ?? 0;
    return (lo + hi) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Compute aggregate statistics from the event log.
 *
 * Returns a dict with:
 *   total_ops: number
 *   ops_by_type: { [op: string]: number }
 *   total_cost_usd: number
 *   reduction_ratio: { mean, p50, p95 } (only keys present when ratios > 0)
 *   per_agent_cost: { [agent: string]: number }
 */
export function getStats(
  wikiRoot: string,
  since: string | null = null,
  opts: { includeRatios?: boolean } = {},
): Record<string, unknown> {
  const events = _readEvents(wikiRoot, since);

  const opsByType: Record<string, number> = {};
  let totalCost = 0.0;
  const ratios: number[] = [];
  const perAgentCost: Record<string, number> = {};

  for (const e of events) {
    const op = typeof e["op"] === "string" ? e["op"] : "unknown";
    opsByType[op] = (opsByType[op] ?? 0) + 1;

    const costVal = e["cost_usd"];
    const cost = typeof costVal === "number" ? costVal : 0.0;
    totalCost += cost;

    if ("reduction_ratio" in e) {
      const r = e["reduction_ratio"];
      if (typeof r === "number") ratios.push(r);
    }

    const agentVal = e["agent"];
    if (typeof agentVal === "string" && agentVal) {
      perAgentCost[agentVal] = (perAgentCost[agentVal] ?? 0) + cost;
    }

    // v2 §13: per-agent-call breakdown. When the event carries an
    // agent_calls[] array, aggregate each sub-agent's cost under its
    // own key (so /wiki-stats reports jira/confluence/gcp separately
    // even if the parent op was `ingest`).
    const calls = e["agent_calls"];
    if (Array.isArray(calls)) {
      for (const c of calls) {
        if (!c || typeof c !== "object") continue;
        const rec = c as Record<string, unknown>;
        const subAgent = rec["agent"];
        const subCost = rec["cost_usd"];
        if (typeof subAgent === "string" && subAgent &&
            typeof subCost === "number") {
          perAgentCost[subAgent] = (perAgentCost[subAgent] ?? 0) + subCost;
        }
      }
    }
  }

  // Reduction ratio statistics — only populated when we saw any ratios.
  const ratioStats: Record<string, number> = {};
  if (ratios.length > 0) {
    const sortedRatios = [...ratios].sort((a, b) => a - b);
    ratioStats["mean"] = mean(ratios);
    ratioStats["p50"] = median(ratios);
    // p95: nearest-rank method matching Python: idx = min(int(n*0.95), n-1)
    let idx95 = Math.floor(sortedRatios.length * 0.95);
    idx95 = Math.min(idx95, sortedRatios.length - 1);
    ratioStats["p95"] = sortedRatios[idx95] ?? 0;
  }

  const result: Record<string, unknown> = {
    total_ops: events.length,
    ops_by_type: opsByType,
    total_cost_usd: totalCost,
    reduction_ratio: ratioStats,
    per_agent_cost: perAgentCost,
  };
  if (opts.includeRatios) {
    // Used by the CLI stats path to decide whether reduction_ratio fields
    // should render as Python int or float. Strip before JSON output.
    result["_ratios"] = ratios;
  }
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  command?: string;
  op?: string;
  wikiRoot?: string;
  details?: string;
  since?: string | null;
  help?: boolean;
}

/**
 * Hand-rolled argparse-equivalent for event_logger. Supports three
 * invocation shapes matching the Python CLI:
 *
 *   node event_logger.js log --op ... --wiki-root ... --details '...'
 *   node event_logger.js stats --wiki-root ... [--since ...]
 *   node event_logger.js --op ... --wiki-root ... --details '...'   (bare fallback)
 *
 * The bare form is the Python CLI's legacy entrypoint — argparse's
 * `parse_known_args` swallows the unknown positional and falls through to
 * a second parser in main().
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  if (argv.length === 0) return out;

  let i = 0;
  const first = argv[0];
  if (first === "-h" || first === "--help") {
    out.help = true;
    return out;
  }
  if (first === "log" || first === "stats") {
    out.command = first;
    i = 1;
  }

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
      case "op":
        out.op = value ?? "";
        break;
      case "wiki-root":
        out.wikiRoot = value ?? "";
        break;
      case "details":
        out.details = value ?? "{}";
        break;
      case "since":
        out.since = value ?? null;
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: event_logger.js [-h] {log,stats} ...

Wiki event logger and stats tool.

positional arguments:
  {log,stats}
    log                 Log an event
    stats               Show aggregated stats

options:
  -h, --help            show this help message and exit
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

  if (args.command === "stats") {
    if (!args.wikiRoot) {
      process.stderr.write("--wiki-root is required\n");
      return 2;
    }
    const since =
      args.since !== null && args.since !== undefined
        ? parseRelativeSince(args.since)
        : null;
    const result = getStats(args.wikiRoot, since, { includeRatios: true });
    const ratios = (result["_ratios"] as number[]) ?? [];
    delete result["_ratios"];

    // total_cost_usd and per_agent_cost always render as Python floats
    // because Python initializes them with 0.0 and accumulates via +=.
    const perAgentWrapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      result["per_agent_cost"] as Record<string, number>,
    )) {
      perAgentWrapped[k] = pyFloat(v);
    }

    // reduction_ratio fields are conditional: Python emits int when all
    // input ratios were integers AND the aggregate is itself integer-valued.
    // Median also renders as float for any even-count list because Python 3's
    // `/` operator is true division (statistics.median uses `(a + b) / 2`).
    const hasFloatRatio = ratios.some((v) => !Number.isInteger(v));
    const ratioSrc = result["reduction_ratio"] as Record<string, number>;
    const ratioWrapped: Record<string, unknown> = {};
    if ("mean" in ratioSrc) {
      const v = ratioSrc["mean"] as number;
      ratioWrapped["mean"] =
        hasFloatRatio || !Number.isInteger(v) ? pyFloat(v) : v;
    }
    if ("p50" in ratioSrc) {
      const v = ratioSrc["p50"] as number;
      ratioWrapped["p50"] =
        hasFloatRatio || ratios.length % 2 === 0 || !Number.isInteger(v)
          ? pyFloat(v)
          : v;
    }
    if ("p95" in ratioSrc) {
      const v = ratioSrc["p95"] as number;
      // p95 uses nearest-rank selection: element returned as-is, so it's
      // int when all inputs were int.
      ratioWrapped["p95"] = hasFloatRatio ? pyFloat(v) : v;
    }

    const wrapped = {
      ...result,
      total_cost_usd: pyFloat(result["total_cost_usd"] as number),
      reduction_ratio: ratioWrapped,
      per_agent_cost: perAgentWrapped,
    };
    process.stdout.write(pythonJsonDumpsFloats(wrapped, 2) + "\n");
    return 0;
  }

  if (args.command === "log") {
    if (!args.op || !args.wikiRoot) {
      process.stderr.write("--op and --wiki-root are required\n");
      return 2;
    }
    const details = JSON.parse(args.details ?? "{}") as Record<string, unknown>;
    const entry = logEvent(args.wikiRoot, args.op, details);
    process.stdout.write(pythonJsonDumps(entry, 2) + "\n");
    return 0;
  }

  // Fallback: bare --op style (no subcommand)
  if (args.op && args.wikiRoot) {
    const details = JSON.parse(args.details ?? "{}") as Record<string, unknown>;
    const entry = logEvent(args.wikiRoot, args.op, details);
    process.stdout.write(pythonJsonDumps(entry, 2) + "\n");
    return 0;
  }

  process.stderr.write("--op and --wiki-root are required\n");
  return 2;
}

// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
