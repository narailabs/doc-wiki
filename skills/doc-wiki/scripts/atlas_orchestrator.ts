#!/usr/bin/env node
/**
 * Deterministic helpers for the `/doc-wiki:atlas` orchestrator.
 *
 * The actual phase coordination (LLM-driven Q&A, dispatching `/doc-wiki:ingest`
 * and `/doc-wiki:refresh`, semantic synthesis) lives in the SKILL.md
 * orchestrator. This module owns the parts that benefit from being a
 * deterministic, callable script:
 *
 *   - **State detection**: count atlas-tagged wiki pages, find the last
 *     `op: atlas` event in `log/events.jsonl`, decide fresh / existing / hybrid.
 *   - **Cost estimation**: given a plan (topics × facets) and a wiki, count
 *     expected ingests after subtracting cache hits, multiply by a rolling
 *     per-ingest average from `events.jsonl`, and add a fixed-cost slot for
 *     the global synthesis pass.
 *   - **Plan snapshot**: serialize/deserialize the topic+facet plan to
 *     `wiki/outputs/atlas/<run-id>/plan-snapshot.json` so `--resume` reads
 *     the original plan instead of re-discovering topics mid-run.
 *
 * Usage as a library:
 *     import { detectState, estimateCost, savePlanSnapshot } from "./atlas_orchestrator.js";
 *
 * Usage as a script:
 *     node atlas_orchestrator.js detect-state    --wiki-root <p>
 *     node atlas_orchestrator.js estimate-cost   --wiki-root <p> --plan '<json>'
 *     node atlas_orchestrator.js save-plan       --wiki-root <p> --run-id <id> --plan '<json>'
 *     node atlas_orchestrator.js load-plan       --wiki-root <p> --run-id <id>
 *     node atlas_orchestrator.js per-ingest-avg  --wiki-root <p> [--sample-size <n>]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFlags } from "./_cli_args.js";
import { parseFrontmatter } from "./_frontmatter.js";
import { computeHash, checkCache } from "./cache_manager.js";

// ── Types ───────────────────────────────────────────────────────────

export type WikiState = "fresh" | "existing" | "hybrid";

/**
 * One unit of work the atlas pipeline plans to perform. The orchestrator
 * uses these entries to drive Phase 6 ingestion and Phase 4 cost estimation.
 */
export interface PlanEntry {
  topic: string;
  facet: string;
  /** Repo-relative source paths (file or folder). May be empty for facets
   *  whose source is gathered dynamically (e.g., data-model from ORM). */
  sources: string[];
  /** Wiki-relative output path the ingest should write to. */
  output: string;
}

export interface Plan {
  topics: string[];
  facets: string[];
  entries: PlanEntry[];
  /** ISO-8601 timestamp the plan was finalized. */
  created_at: string;
}

export interface CostEstimate {
  /** Number of per-topic ingests that will actually run after cache hits. */
  expected_ingests: number;
  /** Cache-hit count: pre-existing pages whose source content is unchanged. */
  cache_hits: number;
  /** Per-ingest average (USD) used for estimation. */
  per_ingest_avg_usd: number;
  /** Estimated cost of all per-topic ingests. */
  topic_cost_usd: number;
  /** Estimated cost of the three global synthesis calls. */
  global_cost_usd: number;
  /** Sum of the above. */
  total_estimated_usd: number;
  /** Per-topic / per-facet breakdown for the dry-run report. */
  breakdown: Array<{
    topic: string;
    facet: string;
    expected: boolean;
    cached: boolean;
  }>;
}

// ── State detection ────────────────────────────────────────────────

/**
 * Walk `<wikiRoot>/wiki/` and count `.md` pages whose frontmatter contains
 * a non-empty `atlas_run_id` field. Pages without the field (manual ingests
 * or pre-atlas pages) are not counted.
 */
export function countAtlasPages(wikiRoot: string): number {
  const wikiContent = path.join(wikiRoot, "wiki");
  if (!fs.existsSync(wikiContent)) return 0;
  let count = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile() || !full.endsWith(".md")) continue;
      let body: string;
      try {
        body = fs.readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const { frontmatter } = parseFrontmatter(body);
      if (!frontmatter) continue;
      const runId = frontmatter["atlas_run_id"];
      if (typeof runId === "string" && runId.length > 0) count++;
    }
  };
  walk(wikiContent);
  return count;
}

/**
 * Total `.md` pages under `<wikiRoot>/wiki/`, regardless of whether they
 * carry atlas frontmatter. Used to distinguish "wiki has manual content
 * but no atlas history" (hybrid) from "fresh wiki" (no content at all).
 */
export function countAllPages(wikiRoot: string): number {
  const wikiContent = path.join(wikiRoot, "wiki");
  if (!fs.existsSync(wikiContent)) return 0;
  let count = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (e.isFile() && full.endsWith(".md")) count++;
    }
  };
  walk(wikiContent);
  return count;
}

/**
 * Scan `log/events.jsonl` for the most recent `op: atlas` event and return
 * its `atlas_run_id` (if present in the event details). Returns `null` if
 * the log is missing, empty, or has no atlas events.
 */
export function getLastAtlasRunId(wikiRoot: string): string | null {
  const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
  if (!fs.existsSync(eventsPath)) return null;
  let lines: string[];
  try {
    lines = fs.readFileSync(eventsPath, "utf-8").split("\n");
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      if (rec["op"] !== "atlas") continue;
      // run_id may live at top level or under details.atlas_run_id.
      if (typeof rec["atlas_run_id"] === "string") return rec["atlas_run_id"];
      const details = rec["details"];
      if (details && typeof details === "object" && !Array.isArray(details)) {
        const d = details as Record<string, unknown>;
        if (typeof d["atlas_run_id"] === "string") return d["atlas_run_id"];
      }
      // No run_id but the event existed — return empty marker so callers
      // can distinguish "atlas has run before" from "never run".
      return "";
    }
  }
  return null;
}

/**
 * Decide the wiki state (Phase 1 of `/doc-wiki:atlas`).
 *
 * Rules (matches the spec table):
 *   - **fresh**:    `atlasPages < atlasPageThreshold` AND no prior atlas event
 *   - **existing**: `atlasPages >= atlasPageThreshold` AND prior atlas event exists
 *   - **hybrid**:   wiki has any pages but no prior atlas event (e.g., wiki was
 *                   built only via manual `/doc-wiki:ingest`)
 *
 * The threshold defaults to 3, matching the spec.
 */
export function detectState(
  wikiRoot: string,
  atlasPageThreshold: number = 3,
): WikiState {
  const atlasPages = countAtlasPages(wikiRoot);
  const lastRunId = getLastAtlasRunId(wikiRoot);
  const allPages = countAllPages(wikiRoot);

  if (atlasPages >= atlasPageThreshold && lastRunId !== null) {
    return "existing";
  }
  if (allPages > 0 && lastRunId === null) {
    return "hybrid";
  }
  return "fresh";
}

// ── Per-ingest cost average ────────────────────────────────────────

const DEFAULT_PER_INGEST_AVG_USD = 0.20;

/**
 * Read recent `op: ingest` events from `log/events.jsonl` and return a
 * rolling-average `cost_usd` over up to `sampleSize` entries. Falls back
 * to {@link DEFAULT_PER_INGEST_AVG_USD} when the log is missing or empty.
 *
 * The sample is taken from the most-recent events backwards; older runs
 * (which may be on different models or different repo sizes) are skipped.
 */
export function getRollingPerIngestAvg(
  wikiRoot: string,
  sampleSize: number = 50,
): number {
  const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
  if (!fs.existsSync(eventsPath)) return DEFAULT_PER_INGEST_AVG_USD;
  let lines: string[];
  try {
    lines = fs.readFileSync(eventsPath, "utf-8").split("\n");
  } catch {
    return DEFAULT_PER_INGEST_AVG_USD;
  }
  const samples: number[] = [];
  for (let i = lines.length - 1; i >= 0 && samples.length < sampleSize; i--) {
    const line = lines[i];
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const rec = parsed as Record<string, unknown>;
    if (rec["op"] !== "ingest") continue;
    // Cost may live at top level or in details.total_cost_usd.
    let cost: number | null = null;
    if (typeof rec["cost_usd"] === "number") cost = rec["cost_usd"];
    else if (rec["details"] && typeof rec["details"] === "object") {
      const d = rec["details"] as Record<string, unknown>;
      if (typeof d["total_cost_usd"] === "number") cost = d["total_cost_usd"];
      else if (typeof d["cost_usd"] === "number") cost = d["cost_usd"];
    }
    if (cost !== null && cost >= 0) samples.push(cost);
  }
  if (samples.length === 0) return DEFAULT_PER_INGEST_AVG_USD;
  const sum = samples.reduce((a, b) => a + b, 0);
  return sum / samples.length;
}

// ── Cost estimation ────────────────────────────────────────────────

const GLOBAL_PAGES_COUNT = 3; // overview, integrations, deploy
const GLOBAL_PAGE_AVG_USD = 0.20; // synthesis-only, smaller than ingest

/**
 * Estimate the cost of running a plan on a wiki. For each `(topic, facet)`
 * entry whose first source resolves to existing readable content with a
 * cache hit (per `cache_manager`), the entry is marked **cached** and not
 * counted toward the topic ingest cost. All other entries are counted.
 *
 * The orchestrator displays the resulting estimate in Phase 4 and aborts
 * if `total_estimated_usd > --max-cost`.
 */
export function estimateCost(
  wikiRoot: string,
  plan: Plan,
  perIngestAvgUsd?: number,
): CostEstimate {
  const avg = perIngestAvgUsd ?? getRollingPerIngestAvg(wikiRoot);
  let cacheHits = 0;
  let expectedIngests = 0;
  const breakdown: CostEstimate["breakdown"] = [];

  for (const entry of plan.entries) {
    const cached = _isPlanEntryCached(wikiRoot, entry);
    if (cached) {
      cacheHits++;
      breakdown.push({ topic: entry.topic, facet: entry.facet, expected: false, cached: true });
    } else {
      expectedIngests++;
      breakdown.push({ topic: entry.topic, facet: entry.facet, expected: true, cached: false });
    }
  }

  const topicCost = expectedIngests * avg;
  const globalCost = GLOBAL_PAGES_COUNT * GLOBAL_PAGE_AVG_USD;
  return {
    expected_ingests: expectedIngests,
    cache_hits: cacheHits,
    per_ingest_avg_usd: avg,
    topic_cost_usd: round2(topicCost),
    global_cost_usd: round2(globalCost),
    total_estimated_usd: round2(topicCost + globalCost),
    breakdown,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A `PlanEntry` is "cached" when every source resolves to readable content
 * whose body-only SHA256 hits the wiki's cache. If any source is unreadable
 * or missing from the cache, the entry counts as expected.
 *
 * Empty source lists (e.g. data-model entries) are never cached — they
 * always run.
 */
function _isPlanEntryCached(wikiRoot: string, entry: PlanEntry): boolean {
  if (entry.sources.length === 0) return false;
  for (const src of entry.sources) {
    const abs = path.isAbsolute(src) ? src : path.resolve(src);
    if (!fs.existsSync(abs)) return false;
    let body: string;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        // Directory sources hash the entry list deterministically. Cheap,
        // not perfect — a directory ingest will re-run on any file add.
        body = _dirSignature(abs);
      } else {
        body = fs.readFileSync(abs, "utf-8");
      }
    } catch {
      return false;
    }
    const h = computeHash(body, /* bodyOnly */ false);
    if (checkCache(wikiRoot, h) === null) return false;
  }
  return true;
}

function _dirSignature(dir: string): string {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  const lines: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`${e.isDirectory() ? "D" : "F"} ${e.name}`);
  }
  return lines.join("\n");
}

// ── Plan snapshot ──────────────────────────────────────────────────

/**
 * Where the snapshot for `runId` lives on disk.
 */
function _planSnapshotPath(wikiRoot: string, runId: string): string {
  return path.join(wikiRoot, "outputs", "atlas", runId, "plan-snapshot.json");
}

/**
 * Persist `plan` as JSON to `wiki/outputs/atlas/<runId>/plan-snapshot.json`.
 * Creates parent directories if needed. Overwrites any existing file —
 * snapshots are idempotent within one run.
 */
export function savePlanSnapshot(
  wikiRoot: string,
  runId: string,
  plan: Plan,
): void {
  const target = _planSnapshotPath(wikiRoot, runId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(plan, null, 2) + "\n");
}

/**
 * Read the snapshot for `runId`, returning `null` if missing or malformed.
 *
 * Defensive shape-check: returns null unless the file parses as a Plan with
 * `topics`, `facets`, and `entries` arrays. Out-of-shape fields (e.g. an
 * old version with no `created_at`) are tolerated; the orchestrator can
 * decide whether to keep going.
 */
export function loadPlanSnapshot(
  wikiRoot: string,
  runId: string,
): Plan | null {
  const target = _planSnapshotPath(wikiRoot, runId);
  if (!fs.existsSync(target)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(target, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (
    !Array.isArray(rec["topics"]) ||
    !Array.isArray(rec["facets"]) ||
    !Array.isArray(rec["entries"])
  ) {
    return null;
  }
  return {
    topics: rec["topics"].filter((x): x is string => typeof x === "string"),
    facets: rec["facets"].filter((x): x is string => typeof x === "string"),
    entries: (rec["entries"] as unknown[])
      .filter((e): e is Record<string, unknown> =>
        Boolean(e) && typeof e === "object" && !Array.isArray(e),
      )
      .map((e) => ({
        topic: typeof e["topic"] === "string" ? e["topic"] : "",
        facet: typeof e["facet"] === "string" ? e["facet"] : "",
        sources: Array.isArray(e["sources"])
          ? e["sources"].filter((s): s is string => typeof s === "string")
          : [],
        output: typeof e["output"] === "string" ? e["output"] : "",
      })),
    created_at:
      typeof rec["created_at"] === "string" ? rec["created_at"] : "",
  };
}

// ── CLI ────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--plan": "plan",
  "--run-id": "runId",
  "--sample-size": "sampleSize",
  "--per-ingest-avg-usd": "perIngestAvgUsd",
} as const;

const HELP_TEXT = `usage: atlas_orchestrator.js {detect-state,estimate-cost,save-plan,load-plan,per-ingest-avg} [...]

Deterministic helpers for the /doc-wiki:atlas orchestrator.

Subcommands:
  detect-state      --wiki-root <p>
                    Stdout: {state, atlas_pages, all_pages, last_run_id}.
  estimate-cost     --wiki-root <p> --plan '<json>' [--per-ingest-avg-usd <n>]
                    Stdout: full CostEstimate JSON.
  save-plan         --wiki-root <p> --run-id <id> --plan '<json>'
                    Persist a plan snapshot. Stdout: {saved: true, path}.
  load-plan         --wiki-root <p> --run-id <id>
                    Load a saved snapshot. Stdout: the Plan, or null.
  per-ingest-avg    --wiki-root <p> [--sample-size <n>]
                    Print the rolling per-ingest cost average. Stdout: {avg_usd}.
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const sub = argv[0];
  let parsed;
  try {
    parsed = parseFlags(argv.slice(1), FLAG_SPEC);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const wikiRoot = parsed.values["wikiRoot"];
  if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
    process.stderr.write("--wiki-root is required\n");
    return 2;
  }

  if (sub === "detect-state") {
    const state = detectState(wikiRoot);
    process.stdout.write(
      JSON.stringify({
        state,
        atlas_pages: countAtlasPages(wikiRoot),
        all_pages: countAllPages(wikiRoot),
        last_run_id: getLastAtlasRunId(wikiRoot),
      }) + "\n",
    );
    return 0;
  }

  if (sub === "estimate-cost") {
    const planRaw = parsed.values["plan"];
    if (typeof planRaw !== "string" || planRaw.length === 0) {
      process.stderr.write("--plan is required\n");
      return 2;
    }
    let plan: Plan;
    try {
      plan = JSON.parse(planRaw) as Plan;
    } catch (e) {
      process.stderr.write(`--plan is not valid JSON: ${(e as Error).message}\n`);
      return 2;
    }
    const avgRaw = parsed.values["perIngestAvgUsd"];
    const avg =
      typeof avgRaw === "string" && avgRaw.length > 0
        ? Number.parseFloat(avgRaw)
        : undefined;
    const estimate = estimateCost(wikiRoot, plan, avg);
    process.stdout.write(JSON.stringify(estimate) + "\n");
    return 0;
  }

  if (sub === "save-plan") {
    const runId = parsed.values["runId"];
    const planRaw = parsed.values["plan"];
    if (typeof runId !== "string" || runId.length === 0) {
      process.stderr.write("--run-id is required\n");
      return 2;
    }
    if (typeof planRaw !== "string" || planRaw.length === 0) {
      process.stderr.write("--plan is required\n");
      return 2;
    }
    let plan: Plan;
    try {
      plan = JSON.parse(planRaw) as Plan;
    } catch (e) {
      process.stderr.write(`--plan is not valid JSON: ${(e as Error).message}\n`);
      return 2;
    }
    savePlanSnapshot(wikiRoot, runId, plan);
    const target = _planSnapshotPath(wikiRoot, runId);
    process.stdout.write(JSON.stringify({ saved: true, path: target }) + "\n");
    return 0;
  }

  if (sub === "load-plan") {
    const runId = parsed.values["runId"];
    if (typeof runId !== "string" || runId.length === 0) {
      process.stderr.write("--run-id is required\n");
      return 2;
    }
    const plan = loadPlanSnapshot(wikiRoot, runId);
    process.stdout.write(JSON.stringify(plan) + "\n");
    return 0;
  }

  if (sub === "per-ingest-avg") {
    const sampleRaw = parsed.values["sampleSize"];
    const sampleSize =
      typeof sampleRaw === "string" && sampleRaw.length > 0
        ? Number.parseInt(sampleRaw, 10)
        : undefined;
    const avg = getRollingPerIngestAvg(wikiRoot, sampleSize);
    process.stdout.write(JSON.stringify({ avg_usd: round2(avg) }) + "\n");
    return 0;
  }

  process.stderr.write(`unknown subcommand: ${sub}\n`);
  return 2;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
