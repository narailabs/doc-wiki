#!/usr/bin/env node
/**
 * Build the wiki-stats-since fixture deterministically off a single Date.now()
 * reference. Writes:
 *   <work>/log/events.jsonl  — 12 events across 4 cohorts (2/3/4/3)
 *   <outputs>/now.txt        — the captured now timestamp + abs-10d cutoffs
 */
import * as fs from "node:fs";
import * as path from "node:path";

const WORK = "/Users/narayan/src/doc-wiki/wiki-workspace/iteration-10/wiki-stats-since/work";
const OUTPUTS = "/Users/narayan/src/doc-wiki/wiki-workspace/iteration-10/wiki-stats-since/with_skill/outputs";

// Single now() reference — every cohort offset derives from this.
const nowMs = Date.now();
const now = new Date(nowMs);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Render a Date as a Python-compatible ISO with `+00:00` (event_logger reads
// either Z or +00:00; using +00:00 mirrors what `pythonIsoformatUtc` produces
// when events are logged through the script).
function isoPlus(d) {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const se = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:${se}+00:00`;
}

function isoZ(d) {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const se = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:${se}Z`;
}

// Cohort plan:
//   30-min cohort:  2 events  (within --since 1h)
//   5-day cohort:   3 events  (within --since 30d, within abs-10d cutoff)
//   20-day cohort:  4 events  (within --since 30d, OUTSIDE abs-10d cutoff)
//   60-day cohort:  3 events  (OUTSIDE --since 30d)
//
// Total = 12 events across 4 ops to exercise per-op breakdown.
const cohorts = [
  // 30-minutes-ago: 2 events
  { offsetMs: 30 * MIN, op: "ingest", tokens: 1500, duration_ms: 2300 },
  { offsetMs: 30 * MIN + 5 * MIN, op: "query", tokens: 800, duration_ms: 1200 },

  // 5-days-ago: 3 events
  { offsetMs: 5 * DAY, op: "ingest", tokens: 2200, duration_ms: 3100 },
  { offsetMs: 5 * DAY + 1 * HOUR, op: "lint", tokens: 0, duration_ms: 450 },
  { offsetMs: 5 * DAY + 2 * HOUR, op: "fix", tokens: 600, duration_ms: 980 },

  // 20-days-ago: 4 events
  { offsetMs: 20 * DAY, op: "ingest", tokens: 1800, duration_ms: 2700 },
  { offsetMs: 20 * DAY + 1 * HOUR, op: "query", tokens: 950, duration_ms: 1400 },
  { offsetMs: 20 * DAY + 2 * HOUR, op: "lint", tokens: 0, duration_ms: 380 },
  { offsetMs: 20 * DAY + 3 * HOUR, op: "fix", tokens: 720, duration_ms: 1100 },

  // 60-days-ago: 3 events
  { offsetMs: 60 * DAY, op: "ingest", tokens: 1900, duration_ms: 2500 },
  { offsetMs: 60 * DAY + 1 * HOUR, op: "query", tokens: 870, duration_ms: 1300 },
  { offsetMs: 60 * DAY + 2 * HOUR, op: "lint", tokens: 0, duration_ms: 410 },
];

// Sort oldest-first so events.jsonl reads chronologically (not strictly
// required by the script, but mirrors normal append-only logs).
cohorts.sort((a, b) => b.offsetMs - a.offsetMs);

const logDir = path.join(WORK, "log");
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, "events.jsonl");

const lines = [];
for (const c of cohorts) {
  const ts = isoPlus(new Date(nowMs - c.offsetMs));
  const entry = { ts, op: c.op, tokens: c.tokens, duration_ms: c.duration_ms };
  lines.push(JSON.stringify(entry));
}
fs.writeFileSync(logPath, lines.join("\n") + "\n");

// Compute abs-10d cutoff in both surface forms — falls between 5-day and
// 20-day cohorts because 5d < 10d < 20d.
const cutoff = new Date(nowMs - 10 * DAY);
const absZ = isoZ(cutoff);
const absPlus = isoPlus(cutoff);

fs.mkdirSync(OUTPUTS, { recursive: true });
fs.writeFileSync(
  path.join(OUTPUTS, "now.txt"),
  [
    `now_ms=${nowMs}`,
    `now_iso_z=${isoZ(now)}`,
    `now_iso_plus=${isoPlus(now)}`,
    `abs_iso_10d_z=${absZ}`,
    `abs_iso_10d_plus=${absPlus}`,
    `event_count=${cohorts.length}`,
    `events_path=${logPath}`,
  ].join("\n") + "\n",
);

console.log(`now (Z): ${isoZ(now)}`);
console.log(`abs-10d (Z): ${absZ}`);
console.log(`abs-10d (+00:00): ${absPlus}`);
console.log(`events written: ${cohorts.length} → ${logPath}`);
