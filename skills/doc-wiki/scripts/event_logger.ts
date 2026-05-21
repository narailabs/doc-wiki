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
  fs.appendFileSync(p, JSON.stringify(entry) + "\n");

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

  // W1: when the caller supplied a `since` value but parsing failed (e.g.
  // `--since 1z` — invalid granularity that `parseRelativeSince` returned
  // unchanged, then `parsePythonIsoformat` couldn't parse), warn loudly
  // instead of silently dropping the filter. Silent fallback to "no filter"
  // hides a user error and can cause downstream stats reports to conflate
  // filtered vs unfiltered runs. The warning goes to stderr so stdout stays
  // machine-readable.
  if (since !== null && since !== undefined && Number.isNaN(sinceMs)) {
    process.stderr.write(
      `[event_logger] warning: unrecognized --since value: ${JSON.stringify(
        since,
      )} — returning all events unfiltered\n`,
    );
  }

  const raw = fs.readFileSync(p, { encoding: "utf-8" });
  const events: Array<Record<string, unknown>> = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (sinceMs !== null && !Number.isNaN(sinceMs)) {
      // Fast-path: extract `ts` via anchored regex to skip JSON.parse for old
      // events. Relies on `appendEvent` writing `ts` as the first key with no
      // leading whitespace (see the "Preserve Python's dict-literal key order"
      // comment in `appendEvent`); if a writer ever breaks that invariant the
      // regex misses and we silently degrade to the slow path below.
      const m = line.match(/^{"ts":"([^"]+)"/);
      if (m) {
        const entryMs = parsePythonIsoformat(m[1] as string);
        // G-EVENTS-TS-STRICT (see slow path below for the original rationale):
        // fail-closed on unparseable `ts` so events that can't be placed on
        // the timeline are excluded from --since windows.
        if (Number.isNaN(entryMs) || entryMs < sinceMs) {
          continue;
        }
      }
    }

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      // W2: a malformed line (partial write, torn append, manual edit gone
      // wrong) used to throw out of _readEvents. We now skip it so a single
      // corrupt line doesn't kill the whole read, but mirror the W1 pattern
      // above — write to stderr so the operator notices instead of silently
      // under-counting downstream stats.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[event_logger] warning: skipping malformed JSON line: ${msg}\n`,
      );
      continue;
    }

    if (sinceMs !== null && !Number.isNaN(sinceMs)) {
      const entryTs = entry["ts"];
      const entryMs =
        typeof entryTs === "string" ? parsePythonIsoformat(entryTs) : NaN;
      // G-EVENTS-TS-STRICT: when --since is active, drop events whose
      // `ts` cannot be parsed. Previously a NaN skipped only the
      // `entryMs < sinceMs` check and fell through into `events.push`,
      // so users asking "events in the last 24h" saw events with
      // malformed timestamps. Fail-closed: if we can't place it on
      // the timeline, it's not in the window.
      if (Number.isNaN(entryMs) || entryMs < sinceMs) {
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
 *   total_events: number                            -- count of events in the window
 *   ops_by_type: { [op: string]: number }
 *   total_cost_usd: number
 *   reduction_ratio: { mean, p50, p95 } (only keys present when ratios > 0)
 *   per_agent_cost: { [agent: string]: number }
 *   total_tokens_by_op: { [op: string]: number }    -- v2.1: sum of event.tokens / .total_tokens / .tokens_in+out per op
 *   avg_duration_ms_by_op: { [op: string]: number } -- v2.1: average of event.duration_ms per op (rounded to 2dp)
 *
 * A6 — `opts.includeZeroTokens`:
 *   By default, ops whose events carry no token fields (e.g. deterministic
 *   `init`, `lint` runs that emit no LLM call) are omitted from
 *   `total_tokens_by_op` because including them would dilute per-op cost
 *   averages with zeros. When set, every op observed in the event log
 *   appears in `total_tokens_by_op` — those without any token data
 *   render as `0`. Useful for capacity-style dashboards that need a
 *   stable, predictable key set across runs.
 */
export function getStats(
  wikiRoot: string,
  since: string | null = null,
  opts: { includeRatios?: boolean; includeZeroTokens?: boolean } = {},
): Record<string, unknown> {
  const events = _readEvents(wikiRoot, since);

  const opsByType: Record<string, number> = {};
  let totalCost = 0.0;
  const ratios: number[] = [];
  const perAgentCost: Record<string, number> = {};
  const tokensByOp: Record<string, number> = {};
  const durationSumByOp: Record<string, number> = {};
  const durationCountByOp: Record<string, number> = {};

  for (const e of events) {
    const op = typeof e["op"] === "string" ? e["op"] : "unknown";
    opsByType[op] = (opsByType[op] ?? 0) + 1;

    // Accept `total_cost_usd` as a fallback for `cost_usd`. The atlas
    // op writes `total_cost_usd` directly (per SKILL.md finalize step),
    // and `_normalizeAgentCalls` synthesizes the same field from
    // `agent_calls[]`. Without this fallback, both classes of events
    // contribute $0 to the top-level total even though their costs
    // are real.
    const costRaw = e["cost_usd"] ?? e["total_cost_usd"];
    const cost = typeof costRaw === "number" ? costRaw : 0.0;
    totalCost += cost;

    // v2.1 per-op token aggregation. Accept several event-level keys so
    // producers that emit `tokens`, `total_tokens`, or `tokens_in + tokens_out`
    // are all honoured without requiring a single canonical schema.
    let tokensOnEvent = 0;
    const directTokens = e["tokens"] ?? e["total_tokens"];
    if (typeof directTokens === "number") {
      tokensOnEvent = directTokens;
    } else {
      const tIn = e["tokens_in"];
      const tOut = e["tokens_out"];
      const inN = typeof tIn === "number" ? tIn : 0;
      const outN = typeof tOut === "number" ? tOut : 0;
      tokensOnEvent = inN + outN;
    }
    if (tokensOnEvent > 0) {
      tokensByOp[op] = (tokensByOp[op] ?? 0) + tokensOnEvent;
    }

    // v2.1 per-op duration aggregation. duration_ms or total_duration_ms
    // are both common; fall back to total_duration_seconds × 1000.
    let durationOnEvent: number | null = null;
    const durMs = e["duration_ms"] ?? e["total_duration_ms"];
    if (typeof durMs === "number") {
      durationOnEvent = durMs;
    } else {
      const durSec = e["total_duration_seconds"];
      if (typeof durSec === "number") durationOnEvent = durSec * 1000;
    }
    if (durationOnEvent !== null && durationOnEvent >= 0) {
      durationSumByOp[op] = (durationSumByOp[op] ?? 0) + durationOnEvent;
      durationCountByOp[op] = (durationCountByOp[op] ?? 0) + 1;
    }

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
    // own key (so /doc-wiki:stats reports jira/confluence/gcp separately
    // even if the parent op was `ingest`).
    const calls = e["agent_calls"];
    if (Array.isArray(calls)) {
      for (const c of calls) {
        if (!c || typeof c !== "object") continue;
        const rec = c as Record<string, unknown>;
        const subAgent = rec["agent"];
        const subCost = rec["cost_usd"];
        if (
          typeof subAgent === "string" &&
          subAgent &&
          typeof subCost === "number"
        ) {
          perAgentCost[subAgent] = (perAgentCost[subAgent] ?? 0) + subCost;
        }
      }
    }
  }

  const avgDurationByOp: Record<string, number> = {};
  for (const op of Object.keys(durationSumByOp)) {
    const sum = durationSumByOp[op] ?? 0;
    const count = durationCountByOp[op] ?? 1;
    avgDurationByOp[op] = Math.round((sum / count) * 100) / 100;
  }

  // A6: when explicit-zero is requested, backfill every op observed in
  // the event log so the key set of `total_tokens_by_op` exactly matches
  // `ops_by_type`. Default behaviour is unchanged: ops whose events
  // contributed no token data stay omitted.
  if (opts.includeZeroTokens) {
    for (const op of Object.keys(opsByType)) {
      if (!(op in tokensByOp)) tokensByOp[op] = 0;
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
    total_events: events.length,
    ops_by_type: opsByType,
    total_cost_usd: totalCost,
    reduction_ratio: ratioStats,
    per_agent_cost: perAgentCost,
    total_tokens_by_op: tokensByOp,
    avg_duration_ms_by_op: avgDurationByOp,
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
  /** A6: when true, total_tokens_by_op contains a 0-entry for every op
   *  observed in the log (including ops that emitted no token data). */
  includeZeroTokens?: boolean;
  /** Sugar over `--details '{"source":"..."}'` — SKILL.md step 12 documents
   *  this flag for the common ingest case. Merged into `details.source`
   *  before logging; if `--details` already carries `source`, the explicit
   *  flag wins. */
  source?: string;
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
    // A6: boolean-style flag — no value follows. Consume just one token.
    if (a === "--include-zero-tokens") {
      out.includeZeroTokens = true;
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
      case "source":
        out.source = value ?? "";
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

log options:
  --op OP               Operation name (required)
  --wiki-root PATH      Wiki root (required)
  --details JSON        Event details as a JSON object (default: {})
  --source SOURCE       Sugar that merges into details.source — convenient
                        for ingest events that just need a source identifier
                        without a hand-built JSON blob.

stats options:
  --since SINCE         Filter events to ts >= SINCE (ISO-8601 or
                        relative shorthand like '7d', '24h', '15m')
  --include-zero-tokens Include every observed op in total_tokens_by_op,
                        even ops whose events carried no token data
                        (those render as 0). Default: omit zero-token
                        ops to keep per-op cost averages clean.
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

    // W1: validate --since at the CLI boundary before doing any work.
    // Node's `Date.parse` is surprisingly lenient — `Date.parse("1z")`
    // returns a valid (ancient) timestamp instead of NaN — so we can't
    // rely on a post-parse NaN guard to catch garbage input. Instead,
    // require the value to either match the relative-duration shape
    // (N + d|h|m) or start with an ISO-like `YYYY-MM-DD` prefix. Anything
    // else exits non-zero with a clear error so the caller knows their
    // filter was ignored rather than silently returning all events.
    if (args.since !== null && args.since !== undefined) {
      const isRelative = /^\d+[dhm]$/.test(args.since);
      const isAbsolute = /^\d{4}-\d{2}-\d{2}/.test(args.since);
      if (!isRelative && !isAbsolute) {
        process.stderr.write(
          `[event_logger] error: --since value ${JSON.stringify(
            args.since,
          )} is not a valid relative duration (e.g. 7d, 24h, 15m) or absolute ISO timestamp (YYYY-MM-DD...)\n`,
        );
        return 2;
      }
    }

    const since =
      args.since !== null && args.since !== undefined
        ? parseRelativeSince(args.since)
        : null;
    const result = getStats(args.wikiRoot, since, {
      includeRatios: true,
      includeZeroTokens: args.includeZeroTokens === true,
    });
    delete result["_ratios"];
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  if (args.command === "log") {
    if (!args.op || !args.wikiRoot) {
      process.stderr.write("--op and --wiki-root are required\n");
      return 2;
    }
    const details = JSON.parse(args.details ?? "{}") as Record<string, unknown>;
    if (typeof args.source === "string" && args.source !== "") {
      details["source"] = args.source;
    }
    const entry = logEvent(args.wikiRoot, args.op, details);
    process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
    return 0;
  }

  // Fallback: bare --op style (no subcommand)
  if (args.op && args.wikiRoot) {
    const details = JSON.parse(args.details ?? "{}") as Record<string, unknown>;
    if (typeof args.source === "string" && args.source !== "") {
      details["source"] = args.source;
    }
    const entry = logEvent(args.wikiRoot, args.op, details);
    process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
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
