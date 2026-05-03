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
import {
  loadInventory,
  type CodeInventory,
} from "../../../agents/lib/atlas_inventory.js";
import { groupManifestByTopicFacet } from "../../../agents/lib/atlas_synthesize.js";

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

/**
 * Names of every global synthesis page Phase 7 regenerates. Three were
 * added in the audience-aware coverage tranche (commands, configuration,
 * getting-started, troubleshooting) on top of the original three
 * (overview, integrations, deploy). Every entry costs `GLOBAL_PAGE_AVG_USD`
 * once per atlas run.
 */
const STATIC_GLOBAL_PAGES: readonly string[] = [
  "overview",
  "integrations",
  "deploy",
  "commands",
  "configuration",
  "getting-started",
  "troubleshooting",
];
const GLOBAL_PAGE_AVG_USD = 0.20; // synthesis-only, smaller than ingest

/**
 * Count of global synthesis pages that will be regenerated unconditionally
 * in Phase 7 for a given plan. The `facets` argument is reserved for
 * future per-facet-driven globals (e.g., a `data-model-overview` page only
 * when the `data-model` facet is in scope). Today every global is
 * unconditional, so the count is fixed regardless of facets.
 */
export function expectedGlobalCount(facets?: readonly string[]): number {
  void facets;
  return STATIC_GLOBAL_PAGES.length;
}

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
  const globalCost = expectedGlobalCount(plan.facets) * GLOBAL_PAGE_AVG_USD;
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

// ── Gap report ─────────────────────────────────────────────────────

/**
 * Optional gitlog-classification input for the gap report. Mirrors the
 * shape produced by `atlas_gitlog.js classify`: paths the gitlog scan
 * flagged as already-referenced (stale), needing-coverage (uncovered),
 * or unrelated to current topics.
 */
export interface GitlogClassification {
  stale_pages?: string[];
  uncovered_files?: string[];
  unrelated_files?: string[];
}

/**
 * Concrete deliverable describing what the atlas run did NOT manage to
 * document. An actionable checklist written to
 * `wiki/outputs/atlas/<run-id>/gap-report.md` by Phase 8.
 */
export interface GapReport {
  /** Topics in the plan that have no `.md` page in `wiki/<topic>/` at all. */
  topicsWithoutPages: string[];
  /** (topic, facet) pairs from the plan whose expected `wiki/<topic>/<facet>.md` does not exist. */
  facetsWithoutCoverage: Array<{ topic: string; facet: string }>;
  /** Source paths in plan entries whose `output` page does not exist. Deduplicated. */
  sourceFilesWithNoPage: string[];
  /** Files the gitlog scan flagged as needing coverage but no atlas page picked them up. */
  uncoveredFiles: string[];
  /** Connector ids mentioned in atlas pages whose connector has no surfaced documentation. */
  externalServicesWithoutDocumentation: string[];
  /**
   * REST endpoints from the inventory manifest whose `file` is not
   * referenced by any atlas page's frontmatter `sources:`. Empty when no
   * manifest was provided.
   */
  endpointsWithoutDocumentation: string[];
  /**
   * Code-client callsites (`gather()`, `fetchWithCaps()`) from the
   * inventory manifest whose `file` is not referenced by any atlas
   * page's frontmatter `sources:`. Empty when no manifest was provided.
   */
  clientsWithoutDocumentation: string[];
}

/** Builtin connector ids minus `db` — matches the integration-keyword set
 *  used by `atlas_synthesize.assembleIntegrationsInputs`. Inlined here to
 *  avoid cross-package coupling between scripts/ and agents/lib/. */
const _GAP_REPORT_KNOWN_CONNECTORS: readonly string[] = [
  "jira",
  "confluence",
  "github",
  "notion",
  "gcp",
  "aws",
];

/**
 * Build a gap report for the given plan. Read-only — does not write
 * anything. The orchestrator (Phase 8) is responsible for serializing the
 * returned object to `wiki/outputs/atlas/<run-id>/gap-report.md`.
 *
 * When `inventory` is supplied (typically loaded from
 * `<wikiRoot>/outputs/atlas/<runId>/code-inventory.json` by the caller),
 * the report also surfaces REST endpoints and code-client callsites
 * whose source file is not referenced from any atlas page's frontmatter
 * `sources:` array. Without an inventory, both new fields are empty.
 */
export function assembleGapReport(
  wikiRoot: string,
  plan: Plan,
  gitlog?: GitlogClassification,
  inventory?: CodeInventory,
): GapReport {
  const wikiContent = path.join(wikiRoot, "wiki");

  // 1. Topics whose directory holds no .md page at all.
  const topicsWithPages = new Set<string>();
  if (fs.existsSync(wikiContent)) {
    for (const topic of plan.topics) {
      const topicDir = path.join(wikiContent, topic);
      if (!fs.existsSync(topicDir)) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(topicDir, { withFileTypes: true });
      } catch {
        continue;
      }
      if (entries.some((e) => e.isFile() && e.name.endsWith(".md"))) {
        topicsWithPages.add(topic);
      }
    }
  }
  const topicsWithoutPages = plan.topics.filter((t) => !topicsWithPages.has(t));

  // 2. (topic, facet) pairs whose expected output page is missing.
  const facetsWithoutCoverage: Array<{ topic: string; facet: string }> = [];
  for (const topic of plan.topics) {
    for (const facet of plan.facets) {
      const expected = path.join(wikiContent, topic, `${facet}.md`);
      if (!fs.existsSync(expected)) {
        facetsWithoutCoverage.push({ topic, facet });
      }
    }
  }

  // 3. Source paths from plan entries whose output page wasn't produced.
  const missingSources = new Set<string>();
  for (const entry of plan.entries) {
    const outAbs = path.isAbsolute(entry.output)
      ? entry.output
      : path.join(wikiRoot, entry.output);
    if (fs.existsSync(outAbs)) continue;
    for (const src of entry.sources) missingSources.add(src);
  }
  const sourceFilesWithNoPage = [...missingSources].sort();

  // 4. Gitlog uncovered_files — pass through if provided.
  const uncoveredFiles = gitlog?.uncovered_files ? [...gitlog.uncovered_files] : [];

  // 5. Connectors mentioned in atlas pages but missing from integrations.md.
  // Single wiki walk also collects every page's `sources:` frontmatter so
  // step 6 (manifest-driven) doesn't re-walk.
  const externalServicesWithoutDocumentation: string[] = [];
  const integrationsPath = path.join(wikiContent, "integrations.md");
  let integrationsBody = "";
  if (fs.existsSync(integrationsPath)) {
    try {
      integrationsBody = fs.readFileSync(integrationsPath, "utf-8").toLowerCase();
    } catch {
      integrationsBody = "";
    }
  }
  const archMentions = new Set<string>();
  const pageSources = new Set<string>();
  if (fs.existsSync(wikiContent)) {
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
        // Frontmatter sources — used by step 6 below.
        const { frontmatter } = parseFrontmatter(body);
        const fmSources = frontmatter?.["sources"];
        if (Array.isArray(fmSources)) {
          for (const s of fmSources) {
            if (typeof s === "string" && s.length > 0) pageSources.add(s);
          }
        }
        // Connector keyword scan (lowercased body).
        const lower = body.toLowerCase();
        for (const k of _GAP_REPORT_KNOWN_CONNECTORS) {
          if (lower.includes(k)) archMentions.add(k);
        }
      }
    };
    walk(wikiContent);
  }
  for (const k of archMentions) {
    if (!integrationsBody.includes(k)) externalServicesWithoutDocumentation.push(k);
  }
  externalServicesWithoutDocumentation.sort();

  // 6. Manifest-driven: REST endpoints + code clients whose source file
  // is not referenced by any atlas page. Empty arrays when `inventory`
  // is undefined, matching the shape callers without inventory expect.
  const endpointsWithoutDocumentation: string[] = [];
  const clientsWithoutDocumentation: string[] = [];
  if (inventory) {
    const isFileDocumented = (file: string): boolean => {
      if (file.length === 0) return true; // ignore empty paths
      if (pageSources.has(file)) return true;
      for (const src of pageSources) {
        const dir = src.endsWith("/") ? src : src + "/";
        if (file.startsWith(dir)) return true;
      }
      return false;
    };
    for (const ep of inventory.rest_endpoints) {
      if (!isFileDocumented(ep.file)) {
        endpointsWithoutDocumentation.push(
          `${ep.method} ${ep.path} (${ep.file}:${ep.line})`,
        );
      }
    }
    for (const c of inventory.code_clients) {
      if (!isFileDocumented(c.file)) {
        clientsWithoutDocumentation.push(`${c.kind}() at ${c.file}:${c.line}`);
      }
    }
    endpointsWithoutDocumentation.sort();
    clientsWithoutDocumentation.sort();
  }

  return {
    topicsWithoutPages,
    facetsWithoutCoverage,
    sourceFilesWithNoPage,
    uncoveredFiles,
    externalServicesWithoutDocumentation,
    endpointsWithoutDocumentation,
    clientsWithoutDocumentation,
  };
}

/** Render a {@link GapReport} as a Markdown document for `gap-report.md`. */
export function renderGapReportMarkdown(report: GapReport, runId: string): string {
  const lines: string[] = [];
  lines.push(`# Atlas gap report — ${runId}`);
  lines.push("");
  lines.push(
    "Items below were in scope for this atlas run but did not land as wiki pages. " +
      "Use this list to drive a follow-up `--scope` ingest, file a tracking issue, " +
      "or accept the gap as out-of-scope.",
  );
  lines.push("");

  lines.push("## Topics without any pages");
  if (report.topicsWithoutPages.length === 0) {
    lines.push("");
    lines.push("_(none)_");
  } else {
    lines.push("");
    for (const t of report.topicsWithoutPages) lines.push(`- ${t}`);
  }
  lines.push("");

  lines.push("## Facets without coverage");
  if (report.facetsWithoutCoverage.length === 0) {
    lines.push("");
    lines.push("_(none)_");
  } else {
    lines.push("");
    lines.push("| topic | facet |");
    lines.push("|---|---|");
    for (const { topic, facet } of report.facetsWithoutCoverage) {
      lines.push(`| ${topic} | ${facet} |`);
    }
  }
  lines.push("");

  lines.push("## Source files with no wiki page");
  if (report.sourceFilesWithNoPage.length === 0) {
    lines.push("");
    lines.push("_(none)_");
  } else {
    lines.push("");
    for (const s of report.sourceFilesWithNoPage) lines.push(`- \`${s}\``);
  }
  lines.push("");

  lines.push("## Uncovered files (gitlog)");
  if (report.uncoveredFiles.length === 0) {
    lines.push("");
    lines.push("_(none)_");
  } else {
    lines.push("");
    for (const f of report.uncoveredFiles) lines.push(`- \`${f}\``);
  }
  lines.push("");

  lines.push("## External services mentioned but undocumented");
  if (report.externalServicesWithoutDocumentation.length === 0) {
    lines.push("");
    lines.push("_(none)_");
  } else {
    lines.push("");
    for (const s of report.externalServicesWithoutDocumentation) lines.push(`- ${s}`);
  }
  lines.push("");

  lines.push("## REST endpoints without documentation");
  if (report.endpointsWithoutDocumentation.length === 0) {
    lines.push("");
    lines.push("_(none)_");
  } else {
    lines.push("");
    for (const e of report.endpointsWithoutDocumentation) lines.push(`- ${e}`);
  }
  lines.push("");

  lines.push("## Code clients without documentation");
  if (report.clientsWithoutDocumentation.length === 0) {
    lines.push("");
    lines.push("_(none)_");
  } else {
    lines.push("");
    for (const c of report.clientsWithoutDocumentation) lines.push(`- ${c}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--plan": "plan",
  "--run-id": "runId",
  "--sample-size": "sampleSize",
  "--per-ingest-avg-usd": "perIngestAvgUsd",
  "--gitlog": "gitlog",
  "--topics": "topics",
} as const;

const HELP_TEXT = `usage: atlas_orchestrator.js {detect-state,estimate-cost,save-plan,load-plan,per-ingest-avg,gap-report,compute-sources} [...]

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
  gap-report        --wiki-root <p> --plan '<json>' [--run-id <id>] [--gitlog '<json>']
                    Build the gap report. With --run-id, also writes
                    wiki/outputs/atlas/<run-id>/gap-report.md.
                    Stdout: GapReport JSON (and {written: path} when --run-id is given).
  compute-sources   --wiki-root <p> --run-id <id> --topics <csv>
                    Group the Phase-1b inventory into topic+facet source
                    lists for the manifest-backed facets (data-model, api).
                    Use these to populate the Plan instead of glob heuristics.
                    Stdout: {topic: {"data-model": [...], "api": [...]}}.
                    Empty {} when the manifest is missing.
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

  if (sub === "gap-report") {
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
    let gitlog: GitlogClassification | undefined;
    const gitlogRaw = parsed.values["gitlog"];
    if (typeof gitlogRaw === "string" && gitlogRaw.length > 0) {
      try {
        gitlog = JSON.parse(gitlogRaw) as GitlogClassification;
      } catch (e) {
        process.stderr.write(`--gitlog is not valid JSON: ${(e as Error).message}\n`);
        return 2;
      }
    }
    // Load the per-run inventory manifest if --run-id is given. It's
    // optional — a missing manifest leaves the manifest-driven report
    // fields empty, matching the gitlog-omitted shape.
    const runIdRaw = parsed.values["runId"];
    let inventory: CodeInventory | undefined;
    if (typeof runIdRaw === "string" && runIdRaw.length > 0) {
      inventory = loadInventory(wikiRoot, runIdRaw) ?? undefined;
    }
    const report = assembleGapReport(wikiRoot, plan, gitlog, inventory);
    if (typeof runIdRaw === "string" && runIdRaw.length > 0) {
      const md = renderGapReportMarkdown(report, runIdRaw);
      const target = path.join(
        wikiRoot,
        "outputs",
        "atlas",
        runIdRaw,
        "gap-report.md",
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, md);
      process.stdout.write(JSON.stringify({ ...report, written: target }) + "\n");
    } else {
      process.stdout.write(JSON.stringify(report) + "\n");
    }
    return 0;
  }

  if (sub === "compute-sources") {
    const runIdRaw = parsed.values["runId"];
    const topicsRaw = parsed.values["topics"];
    if (typeof runIdRaw !== "string" || runIdRaw.length === 0) {
      process.stderr.write("--run-id is required\n");
      return 2;
    }
    if (typeof topicsRaw !== "string" || topicsRaw.length === 0) {
      process.stderr.write("--topics is required (comma-separated)\n");
      return 2;
    }
    const topics = topicsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (topics.length === 0) {
      process.stderr.write("--topics produced an empty list\n");
      return 2;
    }
    const inventory = loadInventory(wikiRoot, runIdRaw);
    if (!inventory) {
      // Missing manifest is non-fatal — emit empty map so the orchestrator
      // falls back to SKILL.md heuristic sources for every topic+facet.
      process.stdout.write(JSON.stringify({}) + "\n");
      return 0;
    }
    const grouped = groupManifestByTopicFacet(inventory, topics);
    process.stdout.write(JSON.stringify(grouped) + "\n");
    return 0;
  }

  process.stderr.write(`unknown subcommand: ${sub}\n`);
  return 2;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
