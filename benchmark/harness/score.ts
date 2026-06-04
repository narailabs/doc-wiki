#!/usr/bin/env -S npx tsx
// doc-wiki benchmark aggregator.
//
// Walks runs/<repo>/<issue>/<condition>.json, computes per-repo and aggregate
// success rates, writes results/RESULTS.md (human-readable) and
// results/raw.csv (machine-readable).

import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface RunResultMin {
  repo: string;
  issue: string;
  condition: "baseline" | "with-docwiki";
  model: string;
  duration_s: number;
  claude: { cost_usd: number; turns: number; tokens_in: number; tokens_out: number };
  test: { success: boolean };
  atlas: { cost_usd: number; duration_s: number } | null;
  error?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = resolve(HERE, "..");
const RUNS_DIR = join(BENCH_DIR, "runs");
const RESULTS_DIR = join(BENCH_DIR, "results");

function walkResults(): RunResultMin[] {
  const out: RunResultMin[] = [];
  if (!safeStat(RUNS_DIR)) return out;
  for (const repo of readdirSync(RUNS_DIR)) {
    const repoDir = join(RUNS_DIR, repo);
    if (!statSync(repoDir).isDirectory()) continue;
    for (const issue of readdirSync(repoDir)) {
      const issueDir = join(repoDir, issue);
      if (!statSync(issueDir).isDirectory()) continue;
      for (const file of readdirSync(issueDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const data = JSON.parse(readFileSync(join(issueDir, file), "utf-8")) as RunResultMin;
          out.push(data);
        } catch {
          console.warn(`skipped unreadable result: ${join(issueDir, file)}`);
        }
      }
    }
  }
  return out;
}

function safeStat(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface RepoSummary {
  repo: string;
  baselineN: number;
  baselineSuccess: number;
  baselineCost: number;
  withN: number;
  withSuccess: number;
  withCost: number;
  atlasCost: number;
}

interface CellKey {
  repo: string;
  issue: string;
  condition: "baseline" | "with-docwiki";
}

interface CellStats {
  key: CellKey;
  n: number;
  passes: number;
  durations: number[];
  atlas_costs: number[];
}

function cellKeyStr(k: CellKey): string {
  return `${k.repo}/${k.issue}/${k.condition}`;
}

function bucketCells(results: RunResultMin[]): Map<string, CellStats> {
  const cells = new Map<string, CellStats>();
  for (const r of results) {
    if (!r || !r.repo || !r.issue || !r.condition) continue;
    const key: CellKey = { repo: r.repo, issue: r.issue, condition: r.condition };
    const ks = cellKeyStr(key);
    let c = cells.get(ks);
    if (!c) {
      c = { key, n: 0, passes: 0, durations: [], atlas_costs: [] };
      cells.set(ks, c);
    }
    c.n += 1;
    if (r.test && r.test.success === true) c.passes += 1;
    c.durations.push(typeof r.duration_s === "number" ? r.duration_s : 0);
    if (r.atlas && typeof r.atlas.cost_usd === "number" && !isNaN(r.atlas.cost_usd)) {
      c.atlas_costs.push(r.atlas.cost_usd);
    }
  }
  return cells;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function minmax(xs: number[]): [number, number] {
  if (xs.length === 0) return [0, 0];
  return [Math.min(...xs), Math.max(...xs)];
}

function fmtRate(passes: number, n: number): string {
  if (n === 0) return "—";
  return `${passes}/${n}`;
}

function summarize(results: RunResultMin[]): RepoSummary[] {
  const byRepo = new Map<string, RepoSummary>();
  for (const r of results) {
    if (!r || !r.repo || !r.condition) continue;
    const testSuccess = r.test && r.test.success === true;
    const claudeCost = r.claude && typeof r.claude.cost_usd === "number" ? r.claude.cost_usd : 0;
    let s = byRepo.get(r.repo);
    if (!s) {
      s = {
        repo: r.repo,
        baselineN: 0,
        baselineSuccess: 0,
        baselineCost: 0,
        withN: 0,
        withSuccess: 0,
        withCost: 0,
        atlasCost: 0,
      };
      byRepo.set(r.repo, s);
    }
    if (r.condition === "baseline") {
      s.baselineN += 1;
      if (testSuccess) s.baselineSuccess += 1;
      s.baselineCost += claudeCost;
    } else {
      s.withN += 1;
      if (testSuccess) s.withSuccess += 1;
      s.withCost += claudeCost;
      if (r.atlas && typeof r.atlas.cost_usd === "number" && !isNaN(r.atlas.cost_usd)) {
        s.atlasCost = Math.max(s.atlasCost, r.atlas.cost_usd);
      }
    }
  }
  return [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}

function pct(num: number, denom: number): string {
  return denom === 0 ? "—" : `${((num / denom) * 100).toFixed(1)}%`;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function writePerCellSection(results: RunResultMin[]): string[] {
  const cells = bucketCells(results);
  // Group cells by (repo, issue) so baseline + with-docwiki sit next to each other
  const byIssue = new Map<string, { baseline?: CellStats; withDocwiki?: CellStats }>();
  for (const c of cells.values()) {
    const k = `${c.key.repo}/${c.key.issue}`;
    let pair = byIssue.get(k);
    if (!pair) {
      pair = {};
      byIssue.set(k, pair);
    }
    if (c.key.condition === "baseline") pair.baseline = c;
    else pair.withDocwiki = c;
  }

  const lines: string[] = [];
  lines.push("## Per-cell results (with multi-run variance where N>1)");
  lines.push("");
  lines.push(
    "| repo / issue | baseline pass | baseline duration (median, min–max s) | with-doc-wiki pass | wdw duration (s) | Δ pass | atlas $ |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  const sortedKeys = [...byIssue.keys()].sort();
  for (const k of sortedKeys) {
    const pair = byIssue.get(k)!;
    const b = pair.baseline;
    const w = pair.withDocwiki;
    const bRate = b ? fmtRate(b.passes, b.n) : "—";
    const wRate = w ? fmtRate(w.passes, w.n) : "—";
    const bDur = b
      ? `${median(b.durations).toFixed(0)} (${minmax(b.durations)[0].toFixed(0)}–${minmax(b.durations)[1].toFixed(0)})`
      : "—";
    const wDur = w
      ? `${median(w.durations).toFixed(0)} (${minmax(w.durations)[0].toFixed(0)}–${minmax(w.durations)[1].toFixed(0)})`
      : "—";
    const delta =
      b && w && b.n > 0 && w.n > 0
        ? `${(((w.passes / w.n) - (b.passes / b.n)) * 100).toFixed(0)} pp`
        : "—";
    const atlasCost = w
      ? `$${w.atlas_costs.reduce((a, b) => a + b, 0).toFixed(2)}`
      : "—";
    lines.push(`| ${k} | ${bRate} | ${bDur} | ${wRate} | ${wDur} | ${delta} | ${atlasCost} |`);
  }
  lines.push("");
  return lines;
}

function writeMarkdown(results: RunResultMin[], summaries: RepoSummary[]): void {
  const totalBaselineN = summaries.reduce((acc, s) => acc + s.baselineN, 0);
  const totalBaselineSuccess = summaries.reduce((acc, s) => acc + s.baselineSuccess, 0);
  const totalWithN = summaries.reduce((acc, s) => acc + s.withN, 0);
  const totalWithSuccess = summaries.reduce((acc, s) => acc + s.withSuccess, 0);
  const totalBaselineCost = summaries.reduce((acc, s) => acc + s.baselineCost, 0);
  const totalWithCost = summaries.reduce((acc, s) => acc + s.withCost, 0);
  const totalAtlasCost = summaries.reduce((acc, s) => acc + s.atlasCost, 0);

  const lines: string[] = [];
  lines.push("# doc-wiki benchmark — results");
  lines.push("");
  lines.push(`_Generated: ${new Date().toISOString()}. ${results.length} runs in dataset._`);
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push("| Repo | Baseline | With doc-wiki | Δ | Baseline $/run | With-docwiki $/run | Atlas $ |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const s of summaries) {
    const base = pct(s.baselineSuccess, s.baselineN);
    const wd = pct(s.withSuccess, s.withN);
    const delta =
      s.baselineN === 0 || s.withN === 0
        ? "—"
        : `${(((s.withSuccess / s.withN) - (s.baselineSuccess / s.baselineN)) * 100).toFixed(1)} pp`;
    lines.push(
      `| ${s.repo} | ${base} (${s.baselineSuccess}/${s.baselineN}) | ${wd} (${s.withSuccess}/${s.withN}) | ${delta} | ${s.baselineN ? money(s.baselineCost / s.baselineN) : "—"} | ${s.withN ? money(s.withCost / s.withN) : "—"} | ${money(s.atlasCost)} |`,
    );
  }
  lines.push(
    `| **aggregate** | ${pct(totalBaselineSuccess, totalBaselineN)} (${totalBaselineSuccess}/${totalBaselineN}) | ${pct(totalWithSuccess, totalWithN)} (${totalWithSuccess}/${totalWithN}) | ${totalBaselineN && totalWithN ? `${(((totalWithSuccess / totalWithN) - (totalBaselineSuccess / totalBaselineN)) * 100).toFixed(1)} pp` : "—"} | ${totalBaselineN ? money(totalBaselineCost / totalBaselineN) : "—"} | ${totalWithN ? money(totalWithCost / totalWithN) : "—"} | ${money(totalAtlasCost)} |`,
  );
  lines.push("");
  lines.push("## Per-run cost summary");
  lines.push("");
  lines.push(
    `- Total Claude spend (baseline runs): ${money(totalBaselineCost)} across ${totalBaselineN} runs`,
  );
  lines.push(
    `- Total Claude spend (with-doc-wiki runs): ${money(totalWithCost)} across ${totalWithN} runs`,
  );
  lines.push(`- Total atlas spend (one per repo): ${money(totalAtlasCost)}`);
  lines.push(`- **Grand total: ${money(totalBaselineCost + totalWithCost + totalAtlasCost)}**`);
  lines.push("");
  // Per-cell section with variance
  for (const ln of writePerCellSection(results)) lines.push(ln);

  lines.push("## Methodology");
  lines.push("");
  lines.push("See [`PLAN.md`](../PLAN.md). Each repo runs `N` real closed issues. For each issue:");
  lines.push("");
  lines.push("1. Clone at parent of the fix commit.");
  lines.push("2. Install deps.");
  lines.push("3. (With doc-wiki only) build the wiki via `/doc-wiki:atlas`.");
  lines.push("4. Run Claude Code with the issue title + body as prompt.");
  lines.push("5. Run the test the fix PR added/modified.");
  lines.push("6. Success = that test passes. Binary.");
  lines.push("");
  lines.push("Raw run-level data: [`raw.csv`](raw.csv). Per-run transcripts: `runs/<repo>/<issue>/<condition>.json` (not committed; regenerate locally).");
  lines.push("");

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, "RESULTS.md"), lines.join("\n"));
  console.log(`wrote ${join(RESULTS_DIR, "RESULTS.md")}`);
}

function writeCsv(results: RunResultMin[]): void {
  const header = [
    "repo",
    "issue",
    "condition",
    "model",
    "success",
    "duration_s",
    "turns",
    "tokens_in",
    "tokens_out",
    "cost_usd",
    "atlas_cost_usd",
    "atlas_duration_s",
    "error",
  ];
  const rows = results.map((r) => [
    r.repo,
    r.issue,
    r.condition,
    r.model,
    r.test.success ? "1" : "0",
    r.duration_s.toFixed(1),
    String(r.claude.turns),
    String(r.claude.tokens_in),
    String(r.claude.tokens_out),
    r.claude.cost_usd.toFixed(4),
    r.atlas ? r.atlas.cost_usd.toFixed(4) : "",
    r.atlas ? r.atlas.duration_s.toFixed(1) : "",
    r.error ?? "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, "raw.csv"), csv);
  console.log(`wrote ${join(RESULTS_DIR, "raw.csv")}`);
}

function csvCell(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function main(): void {
  const results = walkResults();
  if (results.length === 0) {
    console.log("no run results found under benchmark/runs/ — run benchmark/harness/run.ts first");
    return;
  }
  const summaries = summarize(results);
  writeMarkdown(results, summaries);
  writeCsv(results);
}

main();
