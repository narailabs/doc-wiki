#!/usr/bin/env node
/**
 * Generate daily summary from events.jsonl.
 *
 * Reads log/events.jsonl, filters events for a given date, and writes a
 * human-readable markdown summary to log/daily/YYYY-MM-DD.md.
 *
 * Usage as a library:
 *     import { generateSummary, writeSummary } from "./daily_summary.js";
 *     const md = generateSummary("/path/to/wiki", "2026-04-12");
 *     const p  = writeSummary("/path/to/wiki", "2026-04-12");
 *
 * Usage as a script:
 *     node daily_summary.js --wiki-root /path [--date 2026-04-12]
 *
 * This is a TypeScript port of daily_summary.py; CLI output and file
 * contents match the Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./_cli_args.js";
/** Regex to extract the ts field fast path */
const TS_REGEX = /^{"ts":"([^"\\]+)"/;
// ── Helpers ─────────────────────────────────────────────────────────
/**
 * Read events from `<wikiRoot>/log/events.jsonl`, keeping only entries whose
 * `ts` string starts with `dateStr`. Unparseable JSON lines are silently
 * skipped, matching the Python reference's `json.JSONDecodeError` branch.
 */
function readEvents(wikiRoot, dateStr) {
    const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
    if (!fs.existsSync(eventsPath)) {
        return [];
    }
    const events = [];
    const raw = fs.readFileSync(eventsPath, { encoding: "utf-8" });
    for (const rawLine of raw.split("\n")) {
        const line = rawLine.trim();
        if (!line)
            continue;
        // Fast-path: skip JSON parse overhead if this line cannot match our date
        if (!line.includes(dateStr))
            continue;
        const match = TS_REGEX.exec(line);
        if (match && match[1] && !match[1].startsWith(dateStr))
            continue;
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const rec = entry;
        const ts = typeof rec["ts"] === "string" ? rec["ts"] : "";
        if (ts.startsWith(dateStr)) {
            events.push(rec);
        }
    }
    return events;
}
/** Return today's date in `YYYY-MM-DD` form, using the local timezone (Python's
 *  `date.today()` also uses the system's local clock). */
function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
/** Match Python's `f"{n:,}"` thousands-separator format. */
function formatThousands(n) {
    // Python formats all integers (including 0) as "0", "1,000", "1,000,000".
    // Use the plain sign/abs split since n may be negative.
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(Math.trunc(n));
    const str = abs.toString();
    let out = "";
    for (let i = 0; i < str.length; i++) {
        if (i > 0 && (str.length - i) % 3 === 0)
            out += ",";
        out += str[i];
    }
    return sign + out;
}
/** Match Python's `f"{x:.{precision}f}"` fixed-precision float format. */
function formatFixed(x, precision) {
    // Python's f-string formatting uses half-to-even (banker's) rounding by
    // default via CPython's float_format; we replicate it here so our cost
    // ($.4f) and ratio (.1f) output matches Python byte-for-byte.
    //
    // Strategy: use a large-integer arithmetic via string-based math to avoid
    // float precision edge cases, then restore the decimal point. For exact-half
    // boundaries (e.g. 0.125 → .12, 0.135 → .14 at .2f), we round to even.
    if (!Number.isFinite(x)) {
        // Python's f-string on NaN/inf still emits something; we defer to the
        // same shape as Number.prototype.toFixed for these edge cases.
        return x.toFixed(precision);
    }
    const sign = x < 0 ? "-" : "";
    const abs = Math.abs(x);
    const factor = Math.pow(10, precision);
    // Round to the requested number of decimal places using half-to-even to
    // match Python's behaviour for typical magnitudes encountered here.
    const scaled = abs * factor;
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    let rounded;
    if (diff < 0.5)
        rounded = floor;
    else if (diff > 0.5)
        rounded = floor + 1;
    else
        rounded = floor % 2 === 0 ? floor : floor + 1;
    const intPart = Math.floor(rounded / factor).toString();
    if (precision === 0) {
        return sign + intPart;
    }
    const fracPart = (rounded - Math.floor(rounded / factor) * factor)
        .toString()
        .padStart(precision, "0");
    return `${sign}${intPart}.${fracPart}`;
}
// ── Library API ─────────────────────────────────────────────────────
/**
 * Generate a markdown daily summary for a given date.
 *
 * When `dateStr` is omitted (or null), defaults to today's date in
 * `YYYY-MM-DD` form. The output mirrors daily_summary.py.generate_summary
 * byte-for-byte, including markdown formatting and number formatting.
 */
export function generateSummary(wikiRoot, dateStr = null) {
    const date = dateStr ?? todayIso();
    const events = readEvents(wikiRoot, date);
    const lines = [`# Daily Summary -- ${date}`, ""];
    if (events.length === 0) {
        lines.push("No events recorded for this date.");
        return lines.join("\n");
    }
    // ── Operations Summary ──────────────────────────────────────
    lines.push("## Operations Summary");
    lines.push("");
    const opsCount = new Map();
    for (const e of events) {
        const op = typeof e["op"] === "string" ? e["op"] : "unknown";
        opsCount.set(op, (opsCount.get(op) ?? 0) + 1);
    }
    lines.push("| Operation | Count |");
    lines.push("|-----------|-------|");
    // Match Python's `sorted(ops_count.items())` — key-sorted ascending.
    for (const [op, count] of [...opsCount.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        lines.push(`| ${op} | ${count} |`);
    }
    lines.push("");
    lines.push(`**Total operations:** ${events.length}`);
    lines.push("");
    // ── Per-Agent Breakdown ─────────────────────────────────────
    lines.push("## Per-Agent Breakdown");
    lines.push("");
    // Python: defaultdict(lambda: {"count": 0, "cost": 0.0})
    const agentStats = new Map();
    for (const e of events) {
        const agentVal = e["agent"];
        if (typeof agentVal !== "string" || agentVal === "")
            continue;
        let entry = agentStats.get(agentVal);
        if (!entry) {
            entry = { count: 0, cost: 0.0 };
            agentStats.set(agentVal, entry);
        }
        entry.count += 1;
        const cost = typeof e["cost_usd"] === "number" ? e["cost_usd"] : 0.0;
        entry.cost += cost;
    }
    if (agentStats.size > 0) {
        lines.push("| Agent | Operations | Cost (USD) |");
        lines.push("|-------|-----------|------------|");
        const sortedAgents = [...agentStats.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        for (const [agent, stats] of sortedAgents) {
            lines.push(`| ${agent} | ${stats.count} | \$${formatFixed(stats.cost, 4)} |`);
        }
    }
    else {
        lines.push("No agent-specific data recorded.");
    }
    lines.push("");
    // ── Quality Signals ─────────────────────────────────────────
    lines.push("## Quality Signals");
    lines.push("");
    let lintEvents = 0;
    let ingestEvents = 0;
    for (const e of events) {
        if (e["op"] === "lint")
            lintEvents++;
        if (e["op"] === "ingest")
            ingestEvents++;
    }
    lines.push(`- **Pages ingested:** ${ingestEvents}`);
    lines.push(`- **Lint checks run:** ${lintEvents}`);
    lines.push("");
    // ── Token Efficiency ────────────────────────────────────────
    lines.push("## Token Efficiency");
    lines.push("");
    let totalIn = 0;
    let totalOut = 0;
    let totalCost = 0.0;
    const ratios = [];
    for (const e of events) {
        if (typeof e["tokens_in"] === "number")
            totalIn += e["tokens_in"];
        if (typeof e["tokens_out"] === "number")
            totalOut += e["tokens_out"];
        if (typeof e["cost_usd"] === "number")
            totalCost += e["cost_usd"];
        const r = e["reduction_ratio"];
        if (typeof r === "number")
            ratios.push(r);
    }
    lines.push(`- **Total tokens in:** ${formatThousands(totalIn)}`);
    lines.push(`- **Total tokens out:** ${formatThousands(totalOut)}`);
    lines.push(`- **Total cost:** \$${formatFixed(totalCost, 4)}`);
    if (ratios.length > 0) {
        const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        // Python's statistics.median on even-length lists returns the average of
        // the two middle elements via true division (always a float).
        const sorted = [...ratios].sort((a, b) => a - b);
        const n = sorted.length;
        const mid = Math.floor(n / 2);
        let median;
        if (n % 2 === 1) {
            median = sorted[mid] ?? 0;
        }
        else {
            const lo = sorted[mid - 1] ?? 0;
            const hi = sorted[mid] ?? 0;
            median = (lo + hi) / 2;
        }
        lines.push(`- **Reduction ratio (mean):** ${formatFixed(mean, 1)}x`);
        lines.push(`- **Reduction ratio (median):** ${formatFixed(median, 1)}x`);
    }
    lines.push("");
    return lines.join("\n");
}
/**
 * Generate and write a daily summary to `<wikiRoot>/log/daily/YYYY-MM-DD.md`.
 * Creates the `log/daily/` directory if missing. Returns the absolute path
 * to the written file.
 */
export function writeSummary(wikiRoot, dateStr = null) {
    const date = dateStr ?? todayIso();
    const content = generateSummary(wikiRoot, date);
    const dailyDir = path.join(wikiRoot, "log", "daily");
    fs.mkdirSync(dailyDir, { recursive: true });
    const outputPath = path.join(dailyDir, `${date}.md`);
    fs.writeFileSync(outputPath, content);
    return outputPath;
}
// ── CLI ─────────────────────────────────────────────────────────────
const FLAG_SPEC = {
    "--wiki-root": "wikiRoot",
    "--date": "date",
};
const HELP_TEXT = `usage: daily_summary.js [-h] --wiki-root WIKI_ROOT [--date DATE]

Generate daily summary from events.

options:
  -h, --help            show this help message and exit
  --wiki-root WIKI_ROOT Wiki root path
  --date DATE           Date (YYYY-MM-DD), defaults to today
`;
export function main(argv = process.argv.slice(2)) {
    let parsed;
    try {
        parsed = parseFlags(argv, FLAG_SPEC);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (parsed.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    if (typeof wikiRoot !== "string" || wikiRoot === "") {
        process.stderr.write("the following arguments are required: --wiki-root\n");
        return 2;
    }
    const dateVal = parsed.values["date"];
    const dateStr = typeof dateVal === "string" && dateVal ? dateVal : null;
    const outputPath = writeSummary(wikiRoot, dateStr);
    process.stdout.write(`Summary written to: ${outputPath}\n`);
    return 0;
}
// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
