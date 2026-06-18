/**
 * Tests for atlas_orchestrator.ts — the deterministic helpers used by the
 * `/doc-wiki:atlas` skill orchestrator. State detection, page counting,
 * cost estimation, and plan-snapshot persistence.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import {
  countAtlasPages,
  countAllPages,
  getLastAtlasRunId,
  detectState,
  estimateCost,
  expectedGlobalCount,
  savePlanSnapshot,
  loadPlanSnapshot,
  getRollingPerIngestAvg,
  assembleGapReport,
  renderGapReportMarkdown,
  STATIC_GLOBAL_PAGES,
  CROSS_SERVICE_GLOBAL_PAGES,
  main,
} from "../atlas_orchestrator.js";
import {
  generateInventory,
  persistInventory,
} from "../../../../agents/lib/atlas_inventory.js";
import {
  makeTmpPath,
  cleanupTmpPath,
  makeInitializedWiki,
} from "./fixtures.js";

// ── Helpers ─────────────────────────────────────────────────────────

function writeAtlasPage(
  wikiRoot: string,
  relPath: string,
  facet: string,
  runId: string,
  sources: string[] = [],
): void {
  const full = path.join(wikiRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    "---\n" +
      yaml.dump({
        title: facet,
        atlas_facet: facet,
        atlas_run_id: runId,
        sources,
      }) +
      "---\n\nbody\n",
  );
}

function writeNonAtlasPage(wikiRoot: string, relPath: string): void {
  const full = path.join(wikiRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    "---\n" +
      yaml.dump({ title: "manual", sources: ["src/manual.md"] }) +
      "---\n\nbody\n",
  );
}

function writeEvent(
  wikiRoot: string,
  event: Record<string, unknown>,
): void {
  fs.appendFileSync(
    path.join(wikiRoot, "log", "events.jsonl"),
    JSON.stringify(event) + "\n",
  );
}

// ── countAtlasPages / countAllPages ─────────────────────────────────

describe("countAtlasPages", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-count-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns 0 when the wiki content dir has no atlas-tagged pages", () => {
    expect(countAtlasPages(wikiRoot)).toBe(0);
  });

  it("counts only pages with atlas_run_id frontmatter", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    writeAtlasPage(wikiRoot, "wiki/billing/data-model.md", "data-model", "r1");
    writeNonAtlasPage(wikiRoot, "wiki/auth/manual.md");
    expect(countAtlasPages(wikiRoot)).toBe(2);
  });
});

describe("countAllPages", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-all-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("counts every .md page including non-atlas ones", () => {
    // makeInitializedWiki creates index.md, summaries.md, overview.md
    const baseline = countAllPages(wikiRoot);
    writeNonAtlasPage(wikiRoot, "wiki/auth/manual.md");
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    expect(countAllPages(wikiRoot)).toBe(baseline + 2);
  });
});

// ── getLastAtlasRunId ───────────────────────────────────────────────

describe("getLastAtlasRunId", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-runid-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null when no atlas events exist", () => {
    expect(getLastAtlasRunId(wikiRoot)).toBeNull();
  });

  it("reads atlas_run_id at the top level of the event", () => {
    writeEvent(wikiRoot, { op: "atlas", atlas_run_id: "2026-04-30T10-00-00" });
    expect(getLastAtlasRunId(wikiRoot)).toBe("2026-04-30T10-00-00");
  });

  it("reads atlas_run_id under details", () => {
    writeEvent(wikiRoot, {
      op: "atlas",
      details: { atlas_run_id: "2026-04-30T11-00-00" },
    });
    expect(getLastAtlasRunId(wikiRoot)).toBe("2026-04-30T11-00-00");
  });

  it("returns the most recent atlas event", () => {
    writeEvent(wikiRoot, { op: "atlas", atlas_run_id: "older" });
    writeEvent(wikiRoot, { op: "ingest" });
    writeEvent(wikiRoot, { op: "atlas", atlas_run_id: "newer" });
    expect(getLastAtlasRunId(wikiRoot)).toBe("newer");
  });

  it("returns empty string when the event exists but lacks a run_id", () => {
    writeEvent(wikiRoot, { op: "atlas" });
    expect(getLastAtlasRunId(wikiRoot)).toBe("");
  });
});

// ── detectState ────────────────────────────────────────────────────

describe("detectState", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-state-");
    wikiRoot = makeInitializedWiki(tmpPath);
    // makeInitializedWiki writes 3 starter pages (index/summaries/overview)
    // so countAllPages() > 0 by default. Remove them to get a truly fresh wiki.
    for (const f of ["index.md", "summaries.md", "overview.md"]) {
      fs.unlinkSync(path.join(wikiRoot, "wiki", f));
    }
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns 'fresh' when wiki is empty and no atlas events", () => {
    expect(detectState(wikiRoot)).toBe("fresh");
  });

  it("returns 'fresh' when atlas pages < threshold even with prior atlas event", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    writeEvent(wikiRoot, { op: "atlas", atlas_run_id: "r1" });
    expect(detectState(wikiRoot)).toBe("fresh");
  });

  it("returns 'existing' when atlas pages >= threshold AND atlas event exists", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    writeAtlasPage(wikiRoot, "wiki/billing/architecture.md", "architecture", "r1");
    writeAtlasPage(wikiRoot, "wiki/admin/architecture.md", "architecture", "r1");
    writeEvent(wikiRoot, { op: "atlas", atlas_run_id: "r1" });
    expect(detectState(wikiRoot)).toBe("existing");
  });

  it("returns 'hybrid' when wiki has manual pages but no atlas events", () => {
    writeNonAtlasPage(wikiRoot, "wiki/auth/manual.md");
    writeNonAtlasPage(wikiRoot, "wiki/billing/manual.md");
    expect(detectState(wikiRoot)).toBe("hybrid");
  });

  it("respects custom threshold", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    writeEvent(wikiRoot, { op: "atlas", atlas_run_id: "r1" });
    expect(detectState(wikiRoot, /* threshold */ 1)).toBe("existing");
  });
});

// ── estimateCost ───────────────────────────────────────────────────

describe("estimateCost", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-cost-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("counts every entry as expected when nothing is cached", () => {
    const plan = {
      topics: ["auth", "billing"],
      facets: ["architecture", "data-model"],
      entries: [
        { topic: "auth", facet: "architecture", sources: [], output: "wiki/auth/architecture.md" },
        { topic: "auth", facet: "data-model", sources: [], output: "wiki/auth/data-model.md" },
        { topic: "billing", facet: "architecture", sources: [], output: "wiki/billing/architecture.md" },
        { topic: "billing", facet: "data-model", sources: [], output: "wiki/billing/data-model.md" },
      ],
      created_at: new Date().toISOString(),
    };
    const est = estimateCost(wikiRoot, plan, /* avg */ 0.20);
    expect(est.expected_ingests).toBe(4);
    expect(est.cache_hits).toBe(0);
    expect(est.topic_cost_usd).toBe(0.80); // 4 * 0.20
    // 7 base globals (cross-service disabled by default) × $0.20 each.
    expect(est.global_cost_usd).toBe(1.40);
    expect(est.total_estimated_usd).toBe(2.20);

    // With cross-service enabled: 13 globals × $0.20 each.
    const estCs = estimateCost(wikiRoot, plan, /* avg */ 0.20, /* crossServiceEnabled */ true);
    expect(estCs.global_cost_usd).toBe(2.60);
    expect(estCs.total_estimated_usd).toBe(3.40);
    expect(est.breakdown).toHaveLength(4);
    for (const b of est.breakdown) {
      expect(b.expected).toBe(true);
      expect(b.cached).toBe(false);
    }
  });

  it("returns zero topic cost when all entries have empty source lists and avg is positive", () => {
    // Empty sources => never cached => always counted as expected.
    const plan = {
      topics: ["x"],
      facets: ["a"],
      entries: [{ topic: "x", facet: "a", sources: [], output: "wiki/x/a.md" }],
      created_at: new Date().toISOString(),
    };
    const est = estimateCost(wikiRoot, plan, 0);
    expect(est.expected_ingests).toBe(1);
    expect(est.topic_cost_usd).toBe(0);
  });
});

// ── savePlanSnapshot / loadPlanSnapshot ────────────────────────────

describe("plan snapshot round-trip", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-snap-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null when no snapshot exists", () => {
    expect(loadPlanSnapshot(wikiRoot, "missing")).toBeNull();
  });

  it("persists and reads back the same plan", () => {
    const plan = {
      topics: ["auth", "billing"],
      facets: ["architecture"],
      entries: [
        { topic: "auth", facet: "architecture", sources: ["src/auth/"], output: "wiki/auth/architecture.md" },
      ],
      created_at: "2026-04-30T12-00-00",
    };
    savePlanSnapshot(wikiRoot, "run-1", plan);
    expect(loadPlanSnapshot(wikiRoot, "run-1")).toEqual(plan);
  });

  it("creates the run-id directory tree if missing", () => {
    const plan = {
      topics: [],
      facets: [],
      entries: [],
      created_at: "x",
    };
    savePlanSnapshot(wikiRoot, "run-2", plan);
    expect(
      fs.existsSync(path.join(wikiRoot, "outputs", "atlas", "run-2", "plan-snapshot.json")),
    ).toBe(true);
  });

  it("returns null for a malformed snapshot file", () => {
    const dir = path.join(wikiRoot, "outputs", "atlas", "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plan-snapshot.json"), "not-json{{{");
    expect(loadPlanSnapshot(wikiRoot, "broken")).toBeNull();
  });
});

// ── getRollingPerIngestAvg ─────────────────────────────────────────

describe("expectedGlobalCount", () => {
  it("returns 7 base pages when cross-service is disabled (default)", () => {
    expect(expectedGlobalCount()).toBe(7);
    expect(expectedGlobalCount([])).toBe(7);
    expect(expectedGlobalCount(["architecture", "data-model"])).toBe(7);
    expect(expectedGlobalCount(["architecture"])).toBe(7);
  });

  it("returns 13 pages when cross-service is enabled", () => {
    expect(expectedGlobalCount(undefined, true)).toBe(13);
    expect(expectedGlobalCount([], true)).toBe(13);
    expect(expectedGlobalCount(["architecture"], true)).toBe(13);
  });
});

describe("getRollingPerIngestAvg", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-avg-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns the default when events.jsonl is empty", () => {
    const avg = getRollingPerIngestAvg(wikiRoot);
    expect(avg).toBeGreaterThan(0);
  });

  it("averages cost_usd across recent ingest events", () => {
    writeEvent(wikiRoot, { op: "ingest", cost_usd: 0.10 });
    writeEvent(wikiRoot, { op: "ingest", cost_usd: 0.20 });
    writeEvent(wikiRoot, { op: "ingest", cost_usd: 0.30 });
    expect(getRollingPerIngestAvg(wikiRoot)).toBeCloseTo(0.20, 5);
  });

  it("falls back to details.total_cost_usd when present", () => {
    writeEvent(wikiRoot, { op: "ingest", details: { total_cost_usd: 0.40 } });
    writeEvent(wikiRoot, { op: "ingest", details: { total_cost_usd: 0.60 } });
    expect(getRollingPerIngestAvg(wikiRoot)).toBeCloseTo(0.50, 5);
  });

  it("ignores non-ingest events", () => {
    writeEvent(wikiRoot, { op: "lint", cost_usd: 5.0 });
    writeEvent(wikiRoot, { op: "ingest", cost_usd: 0.10 });
    expect(getRollingPerIngestAvg(wikiRoot)).toBeCloseTo(0.10, 5);
  });

  it("respects sample-size cap", () => {
    for (let i = 0; i < 10; i++) {
      writeEvent(wikiRoot, { op: "ingest", cost_usd: 1.0 });
    }
    writeEvent(wikiRoot, { op: "ingest", cost_usd: 0.0 });
    // sampleSize=1 → only the most recent event counts
    expect(getRollingPerIngestAvg(wikiRoot, 1)).toBe(0.0);
  });
});

// ── assembleGapReport / renderGapReportMarkdown ────────────────────

describe("assembleGapReport", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-gap-");
    wikiRoot = makeInitializedWiki(tmpPath);
    // Drop the starter pages so wiki content reflects only what tests create.
    for (const f of ["index.md", "summaries.md", "overview.md"]) {
      const p = path.join(wikiRoot, "wiki", f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("flags topics whose directory has no pages", () => {
    const plan = {
      topics: ["auth", "billing"],
      facets: ["architecture"],
      entries: [
        {
          topic: "auth",
          facet: "architecture",
          sources: ["src/auth/"],
          output: "wiki/auth/architecture.md",
        },
        {
          topic: "billing",
          facet: "architecture",
          sources: ["src/billing/"],
          output: "wiki/billing/architecture.md",
        },
      ],
      created_at: new Date().toISOString(),
    };
    // Only auth has a page on disk.
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");

    const report = assembleGapReport(wikiRoot, plan);
    expect(report.topicsWithoutPages).toEqual(["billing"]);
    // Auth/architecture is covered, billing/architecture is not.
    expect(report.facetsWithoutCoverage).toEqual([
      { topic: "billing", facet: "architecture" },
    ]);
    // Billing's source paths are flagged because the output page is missing.
    expect(report.sourceFilesWithNoPage).toContain("src/billing/");
    expect(report.sourceFilesWithNoPage).not.toContain("src/auth/");
  });

  it("dedupes source paths repeated across plan entries", () => {
    const plan = {
      topics: ["auth"],
      facets: ["architecture", "data-model"],
      entries: [
        {
          topic: "auth",
          facet: "architecture",
          sources: ["src/auth/", "shared/lib/"],
          output: "wiki/auth/architecture.md",
        },
        {
          topic: "auth",
          facet: "data-model",
          sources: ["src/auth/", "shared/lib/"],
          output: "wiki/auth/data-model.md",
        },
      ],
      created_at: new Date().toISOString(),
    };
    const report = assembleGapReport(wikiRoot, plan);
    expect(report.sourceFilesWithNoPage).toEqual(["shared/lib/", "src/auth/"]);
  });

  it("passes through gitlog uncovered_files when provided", () => {
    const plan = {
      topics: ["auth"],
      facets: ["architecture"],
      entries: [],
      created_at: new Date().toISOString(),
    };
    const report = assembleGapReport(wikiRoot, plan, {
      uncovered_files: ["src/new-thing.ts", "src/another.ts"],
      stale_pages: [],
      unrelated_files: [],
    });
    expect(report.uncoveredFiles).toEqual(["src/new-thing.ts", "src/another.ts"]);
  });

  it("flags connectors mentioned in atlas pages but missing from integrations.md", () => {
    const plan = {
      topics: ["auth"],
      facets: ["architecture"],
      entries: [],
      created_at: new Date().toISOString(),
    };
    // architecture page mentions jira and github
    fs.mkdirSync(path.join(wikiRoot, "wiki", "auth"), { recursive: true });
    fs.writeFileSync(
      path.join(wikiRoot, "wiki", "auth", "architecture.md"),
      "---\n" +
        yaml.dump({ atlas_facet: "architecture", atlas_run_id: "r1" }) +
        "---\n\nWe sync to JIRA and emit to GitHub Actions.\n",
    );
    // integrations.md exists but only documents jira
    fs.writeFileSync(
      path.join(wikiRoot, "wiki", "integrations.md"),
      "---\n" +
        yaml.dump({ atlas_facet: "integrations", atlas_run_id: "r1" }) +
        "---\n\nJira sync.\n",
    );

    const report = assembleGapReport(wikiRoot, plan);
    expect(report.externalServicesWithoutDocumentation).toContain("github");
    expect(report.externalServicesWithoutDocumentation).not.toContain("jira");
  });

  it("returns empty arrays when everything is documented", () => {
    const plan = {
      topics: ["auth"],
      facets: ["architecture"],
      entries: [
        {
          topic: "auth",
          facet: "architecture",
          sources: ["src/auth/"],
          output: "wiki/auth/architecture.md",
        },
      ],
      created_at: new Date().toISOString(),
    };
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    const report = assembleGapReport(wikiRoot, plan);
    expect(report.topicsWithoutPages).toEqual([]);
    expect(report.facetsWithoutCoverage).toEqual([]);
    expect(report.sourceFilesWithNoPage).toEqual([]);
    expect(report.uncoveredFiles).toEqual([]);
    // Manifest-driven fields default to [] when no inventory is passed.
    expect(report.endpointsWithoutDocumentation).toEqual([]);
    expect(report.clientsWithoutDocumentation).toEqual([]);
  });

  it("flags REST endpoints whose file is not in any page's frontmatter sources", () => {
    const plan = {
      topics: ["auth"],
      facets: ["api"],
      entries: [],
      created_at: new Date().toISOString(),
    };
    // auth/api.md sources only src/auth/login.ts — NOT src/users/list.ts
    writeAtlasPage(
      wikiRoot,
      "wiki/auth/api.md",
      "api",
      "r1",
      ["src/auth/login.ts"],
    );
    const inventory = {
      atlas_run_id: "r1",
      generated_at: "2026-05-01T00:00:00Z",
      repo_root: "/x",
      project_metadata: {
        name: "x",
        version: "0",
        language: "typescript",
        runtime: "node",
        manifests_seen: ["package.json"],
      },
      orm_entities: [],
      rest_endpoints: [
        {
          framework: "express",
          method: "POST",
          path: "/api/login",
          file: "src/auth/login.ts",
          line: 12,
        },
        {
          framework: "express",
          method: "GET",
          path: "/api/users",
          file: "src/users/list.ts",
          line: 8,
        },
      ],
      code_clients: [],
      stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 },
      notes: [],
    };
    const report = assembleGapReport(wikiRoot, plan, undefined, inventory);
    expect(report.endpointsWithoutDocumentation).toEqual([
      "GET /api/users (src/users/list.ts:8)",
    ]);
  });

  it("flags code clients whose file is not in any page's frontmatter sources", () => {
    const plan = {
      topics: [],
      facets: [],
      entries: [],
      created_at: new Date().toISOString(),
    };
    writeAtlasPage(
      wikiRoot,
      "wiki/orchestration/architecture.md",
      "architecture",
      "r1",
      ["src/orchestrator.ts"],
    );
    const inventory = {
      atlas_run_id: "r1",
      generated_at: "2026-05-01T00:00:00Z",
      repo_root: "/x",
      project_metadata: {
        name: "x",
        version: "0",
        language: "typescript",
        runtime: "node",
        manifests_seen: ["package.json"],
      },
      orm_entities: [],
      rest_endpoints: [],
      code_clients: [
        { kind: "gather", file: "src/orchestrator.ts", line: 18 },
        { kind: "fetchWithCaps", file: "src/fetch.ts", line: 7 },
      ],
      stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 },
      notes: [],
    };
    const report = assembleGapReport(wikiRoot, plan, undefined, inventory);
    expect(report.clientsWithoutDocumentation).toEqual([
      "fetchWithCaps() at src/fetch.ts:7",
    ]);
  });

  it("treats a directory in a page's sources as covering descendant files", () => {
    const plan = {
      topics: [],
      facets: [],
      entries: [],
      created_at: new Date().toISOString(),
    };
    // Page sources `src/auth/` (directory) — should cover src/auth/anything.ts
    writeAtlasPage(
      wikiRoot,
      "wiki/auth/architecture.md",
      "architecture",
      "r1",
      ["src/auth/"],
    );
    const inventory = {
      atlas_run_id: "r1",
      generated_at: "2026-05-01T00:00:00Z",
      repo_root: "/x",
      project_metadata: {
        name: "x",
        version: "0",
        language: "typescript",
        runtime: "node",
        manifests_seen: ["package.json"],
      },
      orm_entities: [],
      rest_endpoints: [
        {
          framework: "express",
          method: "POST",
          path: "/api/login",
          file: "src/auth/login.ts",
          line: 12,
        },
      ],
      code_clients: [],
      stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 },
      notes: [],
    };
    const report = assembleGapReport(wikiRoot, plan, undefined, inventory);
    expect(report.endpointsWithoutDocumentation).toEqual([]);
  });
});

describe("renderGapReportMarkdown", () => {
  it("emits all sections with placeholder text when empty", () => {
    const md = renderGapReportMarkdown(
      {
        topicsWithoutPages: [],
        facetsWithoutCoverage: [],
        sourceFilesWithNoPage: [],
        uncoveredFiles: [],
        externalServicesWithoutDocumentation: [],
        endpointsWithoutDocumentation: [],
        clientsWithoutDocumentation: [],
        crossServiceClientsDetected: 0,
        crossServiceQueuesDetected: 0,
      },
      "2026-04-30T12-00-00",
    );
    expect(md).toContain("Atlas gap report — 2026-04-30T12-00-00");
    expect(md).toContain("## Topics without any pages");
    expect(md).toContain("## Facets without coverage");
    expect(md).toContain("## Source files with no wiki page");
    expect(md).toContain("## Uncovered files (gitlog)");
    expect(md).toContain("## External services mentioned but undocumented");
    expect(md).toContain("## REST endpoints without documentation");
    expect(md).toContain("## Code clients without documentation");
    expect(md.match(/_\(none\)_/g)?.length).toBe(7);
    // Cross-service coverage line is always rendered.
    expect(md).toContain("Cross-service: 0 HTTP clients, 0 queue endpoints detected");
  });

  it("formats facets-without-coverage as a markdown table", () => {
    const md = renderGapReportMarkdown(
      {
        topicsWithoutPages: [],
        facetsWithoutCoverage: [
          { topic: "auth", facet: "data-model" },
          { topic: "billing", facet: "api" },
        ],
        sourceFilesWithNoPage: [],
        uncoveredFiles: [],
        externalServicesWithoutDocumentation: [],
        endpointsWithoutDocumentation: [],
        clientsWithoutDocumentation: [],
      },
      "r1",
    );
    expect(md).toContain("| topic | facet |");
    expect(md).toContain("| auth | data-model |");
    expect(md).toContain("| billing | api |");
  });

  it("renders REST endpoints + code clients sections when populated", () => {
    const md = renderGapReportMarkdown(
      {
        topicsWithoutPages: [],
        facetsWithoutCoverage: [],
        sourceFilesWithNoPage: [],
        uncoveredFiles: [],
        externalServicesWithoutDocumentation: [],
        endpointsWithoutDocumentation: [
          "GET /api/users (src/routes/users.ts:42)",
        ],
        clientsWithoutDocumentation: [
          "gather() at src/orchestrator.ts:18",
        ],
      },
      "r1",
    );
    expect(md).toContain("- GET /api/users (src/routes/users.ts:42)");
    expect(md).toContain("- gather() at src/orchestrator.ts:18");
  });
});

// ── F2: estimate-cost CLI reads ecosystem.cross_service.enabled from config ──

describe("main() estimate-cost — crossServiceEnabled from config (PR #58 review)", () => {
  let tmpPath: string;
  let wikiRoot: string;
  let stdoutChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  const PLAN_ONE_ENTRY = JSON.stringify({
    topics: ["auth"],
    facets: ["architecture"],
    entries: [
      { topic: "auth", facet: "architecture", sources: [], output: "wiki/auth/architecture.md" },
    ],
    created_at: new Date().toISOString(),
  });

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-ec-");
    wikiRoot = makeInitializedWiki(tmpPath);
    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(chunk.toString());
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    cleanupTmpPath(tmpPath);
  });

  function writeWikiConfig(crossServiceEnabled: boolean): void {
    const config = {
      wiki: { name: "Test Wiki", domain: "testing" },
      autonomy: { mode: "balanced" },
      ecosystem: { cross_service: { enabled: crossServiceEnabled } },
    };
    fs.writeFileSync(path.join(wikiRoot, "wiki.config.yaml"), yaml.dump(config));
  }

  it("F2-enabled: estimate-cost includes 6 cross-service pages when config has enabled:true → 13 globals", () => {
    writeWikiConfig(true);
    const exit = main([
      "estimate-cost",
      "--wiki-root", wikiRoot,
      "--plan", PLAN_ONE_ENTRY,
      "--per-ingest-avg-usd", "0.20",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as { global_cost_usd: number };
    // 13 globals × $0.20 = $2.60
    expect(out.global_cost_usd).toBeCloseTo(2.60, 5);
  });

  it("F2-disabled: estimate-cost excludes cross-service pages when config has enabled:false → 7 globals", () => {
    writeWikiConfig(false);
    const exit = main([
      "estimate-cost",
      "--wiki-root", wikiRoot,
      "--plan", PLAN_ONE_ENTRY,
      "--per-ingest-avg-usd", "0.20",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as { global_cost_usd: number };
    // 7 globals × $0.20 = $1.40
    expect(out.global_cost_usd).toBeCloseTo(1.40, 5);
  });

  it("F2-absent: estimate-cost defaults to false (7 globals) when cross_service key is absent from config", () => {
    // makeInitializedWiki writes a config without ecosystem.cross_service
    const exit = main([
      "estimate-cost",
      "--wiki-root", wikiRoot,
      "--plan", PLAN_ONE_ENTRY,
      "--per-ingest-avg-usd", "0.20",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as { global_cost_usd: number };
    expect(out.global_cost_usd).toBeCloseTo(1.40, 5);
  });
});

// ── estimate-cost AUTO: reflects whether cross-service will actually run ──

describe("main() estimate-cost — cross-service AUTO from inventory (--run-id)", () => {
  let tmpPath: string;
  let wikiRoot: string;
  let stdoutChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  const RUN_ID = "2026-06-09T12-00-00";
  const PLAN_ONE_ENTRY = JSON.stringify({
    topics: ["auth"],
    facets: ["architecture"],
    entries: [
      { topic: "auth", facet: "architecture", sources: [], output: "wiki/auth/architecture.md" },
    ],
    created_at: new Date().toISOString(),
  });

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-cs-auto-");
    wikiRoot = makeInitializedWiki(tmpPath);
    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(chunk.toString());
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    cleanupTmpPath(tmpPath);
  });

  /** Build + persist a real inventory for a 2-service repo at the given runId. */
  function persistMultiServiceInventory(): void {
    const repo = path.join(tmpPath, "repo");
    fs.mkdirSync(path.join(repo, "svc-a", "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "svc-a", "pom.xml"), "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(
      path.join(repo, "svc-a", "src", "C.java"),
      '@RestController class C { @GetMapping("/a/ping") String p(){return "";} }',
    );
    fs.mkdirSync(path.join(repo, "svc-b"), { recursive: true });
    fs.writeFileSync(path.join(repo, "svc-b", "package.json"), '{"name":"svc-b"}');
    const inv = generateInventory(repo, RUN_ID, { enableRest: true, enableCrossService: true });
    persistInventory(wikiRoot, inv);
  }

  /** Build + persist a monolith inventory (no services). */
  function persistMonolithInventory(): void {
    const repo = path.join(tmpPath, "repo");
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, "package.json"), '{"name":"mono"}');
    const inv = generateInventory(repo, RUN_ID, {});
    persistInventory(wikiRoot, inv);
  }

  it("AUTO: includes the 6 cross-service pages (13 globals) when the inventory has ≥2 services", () => {
    persistMultiServiceInventory();
    const exit = main([
      "estimate-cost",
      "--wiki-root", wikiRoot,
      "--run-id", RUN_ID,
      "--plan", PLAN_ONE_ENTRY,
      "--per-ingest-avg-usd", "0.20",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as { global_cost_usd: number };
    expect(out.global_cost_usd).toBeCloseTo(2.60, 5); // 13 × 0.20
  });

  it("AUTO: excludes cross-service pages (7 globals) for a monolith inventory", () => {
    persistMonolithInventory();
    const exit = main([
      "estimate-cost",
      "--wiki-root", wikiRoot,
      "--run-id", RUN_ID,
      "--plan", PLAN_ONE_ENTRY,
      "--per-ingest-avg-usd", "0.20",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as { global_cost_usd: number };
    expect(out.global_cost_usd).toBeCloseTo(1.40, 5); // 7 × 0.20
  });

  it("config enabled:false overrides AUTO even when the inventory has ≥2 services", () => {
    persistMultiServiceInventory();
    fs.writeFileSync(
      path.join(wikiRoot, "wiki.config.yaml"),
      yaml.dump({
        wiki: { name: "Test Wiki", domain: "testing" },
        autonomy: { mode: "balanced" },
        ecosystem: { cross_service: { enabled: false } },
      }),
    );
    const exit = main([
      "estimate-cost",
      "--wiki-root", wikiRoot,
      "--run-id", RUN_ID,
      "--plan", PLAN_ONE_ENTRY,
      "--per-ingest-avg-usd", "0.20",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as { global_cost_usd: number };
    expect(out.global_cost_usd).toBeCloseTo(1.40, 5); // 7 globals — config wins
  });

  it("falls back to config-only (7 globals) when --run-id is given but no manifest exists", () => {
    const exit = main([
      "estimate-cost",
      "--wiki-root", wikiRoot,
      "--run-id", RUN_ID,
      "--plan", PLAN_ONE_ENTRY,
      "--per-ingest-avg-usd", "0.20",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as { global_cost_usd: number };
    expect(out.global_cost_usd).toBeCloseTo(1.40, 5);
  });
});

describe("main() compute-sources subcommand", () => {
  let tmpPath: string;
  let wikiRoot: string;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-cs-");
    wikiRoot = makeInitializedWiki(tmpPath);
    stdoutChunks = [];
    stderrChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(chunk.toString());
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(chunk.toString());
      return true;
    });
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    cleanupTmpPath(tmpPath);
  });

  function persistInventoryWith(overrides: {
    runId: string;
    orm?: Array<{ class_name: string; source_file: string }>;
    rest?: Array<{ method: string; path: string; file: string }>;
  }): void {
    const inv = generateInventory(wikiRoot, overrides.runId);
    inv.orm_entities = (overrides.orm ?? []).map((e) => ({
      profile: "sqlalchemy",
      class_name: e.class_name,
      table_name: e.class_name.toLowerCase(),
      schema_name: "",
      source_file: e.source_file,
      columns: [],
      relationships: [],
    }));
    inv.rest_endpoints = (overrides.rest ?? []).map((r) => ({
      framework: "fastapi",
      method: r.method,
      path: r.path,
      file: r.file,
      line: 1,
    }));
    persistInventory(wikiRoot, inv);
  }

  it("groups orm and rest entries by topic+facet", () => {
    persistInventoryWith({
      runId: "2026-05-03T00-00-00",
      orm: [{ class_name: "User", source_file: "src/auth/models.py" }],
      rest: [{ method: "GET", path: "/x", file: "src/billing/api.ts" }],
    });
    const exit = main([
      "compute-sources",
      "--wiki-root", wikiRoot,
      "--run-id", "2026-05-03T00-00-00",
      "--topics", "auth,billing",
    ]);
    expect(exit).toBe(0);
    const out = JSON.parse(stdoutChunks.join("").trim()) as Record<string, unknown>;
    expect(out["auth"]).toEqual({ "data-model": ["src/auth/models.py"], api: [] });
    expect(out["billing"]).toEqual({ "data-model": [], api: ["src/billing/api.ts"] });
  });

  it("emits empty {} when the manifest is missing (non-fatal fallback)", () => {
    const exit = main([
      "compute-sources",
      "--wiki-root", wikiRoot,
      "--run-id", "2026-05-03T99-99-99",
      "--topics", "auth",
    ]);
    expect(exit).toBe(0);
    expect(stdoutChunks.join("").trim()).toBe("{}");
  });

  it("rejects missing --topics", () => {
    persistInventoryWith({ runId: "2026-05-03T00-00-00" });
    const exit = main([
      "compute-sources",
      "--wiki-root", wikiRoot,
      "--run-id", "2026-05-03T00-00-00",
    ]);
    expect(exit).toBe(2);
    expect(stderrChunks.join("")).toContain("--topics is required");
  });

  it("rejects missing --run-id", () => {
    const exit = main([
      "compute-sources",
      "--wiki-root", wikiRoot,
      "--topics", "auth",
    ]);
    expect(exit).toBe(2);
    expect(stderrChunks.join("")).toContain("--run-id is required");
  });
});

// ── Archive exclusion ──────────────────────────────────────────────

describe("countAtlasPages archive exclusion", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-archive-");
    wikiRoot = makeInitializedWiki(tmpPath);
    // Remove the starter pages so we start with a clean count.
    for (const f of ["index.md", "summaries.md", "overview.md"]) {
      fs.unlinkSync(path.join(wikiRoot, "wiki", f));
    }
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("countAtlasPages ignores atlas-tagged pages under _archive/", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    writeAtlasPage(wikiRoot, "wiki/_archive/billing/architecture.md", "architecture", "r1");
    writeAtlasPage(wikiRoot, "wiki/_archive/admin/architecture.md", "architecture", "r1");
    // Only the live page should be counted.
    expect(countAtlasPages(wikiRoot)).toBe(1);
  });

  it("countAllPages ignores pages under _archive/", () => {
    writeNonAtlasPage(wikiRoot, "wiki/live/page.md");
    writeNonAtlasPage(wikiRoot, "wiki/_archive/old/page.md");
    expect(countAllPages(wikiRoot)).toBe(1);
  });

  it("detect-state ignores archived atlas pages when counting toward threshold", () => {
    // 1 live atlas page + 5 archived atlas pages + a prior atlas event.
    // Without exclusion, countAtlasPages would return 6 >= 3 → "existing".
    // With exclusion it returns 1 < 3 → "fresh".
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "r1");
    for (let i = 0; i < 5; i++) {
      writeAtlasPage(wikiRoot, `wiki/_archive/topic${i}/architecture.md`, "architecture", "r1");
    }
    writeEvent(wikiRoot, { op: "atlas", atlas_run_id: "r1" });
    expect(detectState(wikiRoot)).toBe("fresh");
  });
});

// ── STATIC_GLOBAL_PAGES / CROSS_SERVICE_GLOBAL_PAGES — slugs ──────────

describe("STATIC_GLOBAL_PAGES and CROSS_SERVICE_GLOBAL_PAGES slugs", () => {
  const CROSS_SERVICE_SLUGS = [
    "service-map",
    "service-dependencies",
    "client-registry",
    "queue-registry",
    "database-traces",
    "shared-libraries",
  ] as const;

  const ORIGINAL_SLUGS = [
    "overview",
    "integrations",
    "deploy",
    "commands",
    "configuration",
    "getting-started",
    "troubleshooting",
  ] as const;

  it("STATIC_GLOBAL_PAGES includes all 7 base slugs", () => {
    for (const slug of ORIGINAL_SLUGS) {
      expect(STATIC_GLOBAL_PAGES).toContain(slug);
    }
  });

  it("STATIC_GLOBAL_PAGES has exactly 7 entries (cross-service slugs moved out)", () => {
    expect(STATIC_GLOBAL_PAGES.length).toBe(7);
  });

  it("CROSS_SERVICE_GLOBAL_PAGES includes all 6 cross-service slugs", () => {
    for (const slug of CROSS_SERVICE_SLUGS) {
      expect(CROSS_SERVICE_GLOBAL_PAGES).toContain(slug);
    }
  });

  it("CROSS_SERVICE_GLOBAL_PAGES has exactly 6 entries", () => {
    expect(CROSS_SERVICE_GLOBAL_PAGES.length).toBe(6);
  });

  it("combined STATIC + CROSS_SERVICE still covers all 13 slugs", () => {
    const all = [...STATIC_GLOBAL_PAGES, ...CROSS_SERVICE_GLOBAL_PAGES];
    for (const slug of [...ORIGINAL_SLUGS, ...CROSS_SERVICE_SLUGS]) {
      expect(all).toContain(slug);
    }
    expect(all.length).toBe(13);
  });
});

// ── assembleGapReport cross-service buckets ────────────────────────

describe("assembleGapReport cross-service buckets", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-cs-gap-");
    wikiRoot = makeInitializedWiki(tmpPath);
    for (const f of ["index.md", "summaries.md", "overview.md"]) {
      const p = path.join(wikiRoot, "wiki", f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  const EMPTY_PLAN = {
    topics: [],
    facets: [],
    entries: [],
    created_at: new Date().toISOString(),
  };

  it("yields crossServiceClientsDetected:0 and crossServiceQueuesDetected:0 when no inventory", () => {
    const report = assembleGapReport(wikiRoot, EMPTY_PLAN);
    expect(report.crossServiceClientsDetected).toBe(0);
    expect(report.crossServiceQueuesDetected).toBe(0);
  });

  it("yields 0 when inventory has no services", () => {
    const inventory = {
      atlas_run_id: "r1",
      generated_at: "2026-06-07T00:00:00Z",
      repo_root: "/x",
      project_metadata: { name: "x", version: "0", language: "typescript", runtime: "node", manifests_seen: [] },
      orm_entities: [],
      rest_endpoints: [],
      code_clients: [],
      services: [],
      stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 },
      notes: [],
    };
    const report = assembleGapReport(wikiRoot, EMPTY_PLAN, undefined, inventory);
    expect(report.crossServiceClientsDetected).toBe(0);
    expect(report.crossServiceQueuesDetected).toBe(0);
  });

  it("sums http_clients and queue_endpoints across services", () => {
    const inventory = {
      atlas_run_id: "r1",
      generated_at: "2026-06-07T00:00:00Z",
      repo_root: "/x",
      project_metadata: { name: "x", version: "0", language: "typescript", runtime: "node", manifests_seen: [] },
      orm_entities: [],
      rest_endpoints: [],
      code_clients: [],
      services: [
        {
          identity: { id: "svc-a", name: "svc-a", root: "services/svc-a", kind: "service" as const },
          project_metadata: { name: "svc-a", version: "0", language: "java", runtime: "java", manifests_seen: [] },
          orm_entities: [],
          rest_endpoints: [],
          http_clients: [
            { framework: "feign", method: "GET", target_ref: "svc-b", path: "/api/items", file: "services/svc-a/src/Client.java", line: 10 },
          ],
          queue_endpoints: [],
          external_sources: [],
          library_deps: [],
          auth_issuer: "",
        },
        {
          identity: { id: "svc-b", name: "svc-b", root: "services/svc-b", kind: "service" as const },
          project_metadata: { name: "svc-b", version: "0", language: "java", runtime: "java", manifests_seen: [] },
          orm_entities: [],
          rest_endpoints: [],
          http_clients: [],
          queue_endpoints: [
            { framework: "spring_kafka", role: "producer" as const, queue_name: "orders", file: "services/svc-b/src/Producer.java", line: 5 },
          ],
          external_sources: [],
          library_deps: [],
          auth_issuer: "",
        },
      ],
      stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 },
      notes: [],
    };
    const report = assembleGapReport(wikiRoot, EMPTY_PLAN, undefined, inventory);
    expect(report.crossServiceClientsDetected).toBe(1);
    expect(report.crossServiceQueuesDetected).toBe(1);
  });
});

// ── renderGapReportMarkdown cross-service line ─────────────────────

describe("renderGapReportMarkdown cross-service line", () => {
  it("renders cross-service counts when both are zero", () => {
    const md = renderGapReportMarkdown(
      {
        topicsWithoutPages: [],
        facetsWithoutCoverage: [],
        sourceFilesWithNoPage: [],
        uncoveredFiles: [],
        externalServicesWithoutDocumentation: [],
        endpointsWithoutDocumentation: [],
        clientsWithoutDocumentation: [],
        crossServiceClientsDetected: 0,
        crossServiceQueuesDetected: 0,
      },
      "r1",
    );
    expect(md).toContain("Cross-service: 0 HTTP clients, 0 queue endpoints detected");
  });

  it("renders correct counts when both are non-zero", () => {
    const md = renderGapReportMarkdown(
      {
        topicsWithoutPages: [],
        facetsWithoutCoverage: [],
        sourceFilesWithNoPage: [],
        uncoveredFiles: [],
        externalServicesWithoutDocumentation: [],
        endpointsWithoutDocumentation: [],
        clientsWithoutDocumentation: [],
        crossServiceClientsDetected: 3,
        crossServiceQueuesDetected: 7,
      },
      "r1",
    );
    expect(md).toContain("Cross-service: 3 HTTP clients, 7 queue endpoints detected");
  });
});

describe("assembleGapReport archive exclusion", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-orch-gap-archive-");
    wikiRoot = makeInitializedWiki(tmpPath);
    for (const f of ["index.md", "summaries.md", "overview.md"]) {
      const p = path.join(wikiRoot, "wiki", f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("assembleGapReport does not count archived atlas pages as covering plan entries", () => {
    const plan = {
      topics: ["auth"],
      facets: ["architecture"],
      entries: [
        {
          topic: "auth",
          facet: "architecture",
          sources: ["src/auth/"],
          output: "wiki/auth/architecture.md",
        },
      ],
      created_at: new Date().toISOString(),
    };
    // Only an archived copy exists — the live output path is missing.
    writeAtlasPage(wikiRoot, "wiki/_archive/auth/architecture.md", "architecture", "r1");

    const report = assembleGapReport(wikiRoot, plan);
    // Archived page must not satisfy coverage; auth/architecture must be flagged.
    expect(report.topicsWithoutPages).toEqual(["auth"]);
    expect(report.facetsWithoutCoverage).toEqual([
      { topic: "auth", facet: "architecture" },
    ]);
    expect(report.sourceFilesWithNoPage).toContain("src/auth/");
  });
});
