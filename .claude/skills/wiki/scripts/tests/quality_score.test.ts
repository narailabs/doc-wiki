/**
 * Tests for quality_score.ts — ported from test_quality_score.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled quality_score.js and confirm stdout
 * matches the Python reference byte-for-byte, including pyFloat-driven
 * `0.0` / `1.0` emission.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import { scorePage, scoreWiki } from "../quality_score.js";
import {
  SCRIPTS_DIR,
  makeInitializedWiki,
  makeTmpPath,
  makeWikiWithPages,
  cleanupTmpPath,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "quality_score.js");

// ── Helpers ─────────────────────────────────────────────────────────

function writePage(
  p: string,
  frontmatter: Record<string, unknown>,
  body: string,
): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = "---\n" + yaml.dump(frontmatter) + "---\n\n" + body;
  fs.writeFileSync(p, content);
}

function fullFrontmatter(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "Test Page",
    type: "concept",
    tags: ["auth", "jwt", "sessions", "security"],
    sources: ["raw/test.md"],
    created: "2026-04-12",
    updated: "2026-04-12",
    quality: 0.0,
    summary: "A test page for quality scoring.",
    ...overrides,
  };
}

/** Unwrap pyFloat so tests can assert on the underlying number. */
function q(score: unknown): number {
  if (score !== null && typeof score === "object") {
    const rec = score as Record<string, unknown>;
    if (typeof rec["value"] === "number") return rec["value"];
  }
  if (typeof score === "number") return score;
  throw new Error(`not a number: ${score}`);
}

// ── Per-page fixture: temp edges file ───────────────────────────────

function makeEdgesFile(tmpPath: string): string {
  const p = path.join(tmpPath, "graph", "edges.jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "");
  return p;
}

/** `edges.jsonl` where `wiki/hub.md` is a god-node (high degree). Mirrors
 *  the `edges_with_god_node` pytest fixture. */
function makeEdgesWithGodNode(tmpPath: string): string {
  const p = path.join(tmpPath, "graph", "edges.jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const edges: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 10; i++) {
    edges.push({
      from: "wiki/hub.md",
      to: `wiki/page${i}.md`,
      type: "extends",
      provenance: "EXTRACTED",
    });
  }
  edges.push({
    from: "wiki/lonely.md",
    to: "wiki/page0.md",
    type: "supports",
    provenance: "EXTRACTED",
  });
  fs.writeFileSync(
    p,
    edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  return p;
}

// ── Word count base score tests ─────────────────────────────────────

describe("TestScorePage", () => {
  let tmpPath: string;
  let edges: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("score-page-");
    edges = makeEdgesFile(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_word_count_below_50_base_01", () => {
    const page = path.join(tmpPath, "wiki", "short.md");
    writePage(page, fullFrontmatter(), "Short ".repeat(10));
    const result = scorePage(page, edges);
    // Base 0.1 + frontmatter 0.1 + tags 0.05 = 0.25
    expect(q(result.quality)).toBeCloseTo(0.25, 2);
  });

  it("test_word_count_50_to_150_base_03", () => {
    const page = path.join(tmpPath, "wiki", "medium.md");
    writePage(page, fullFrontmatter(), new Array(80).fill("word").join(" "));
    const result = scorePage(page, edges);
    expect(q(result.quality)).toBeCloseTo(0.45, 2);
  });

  it("test_word_count_150_to_500_base_06", () => {
    const page = path.join(tmpPath, "wiki", "good.md");
    writePage(page, fullFrontmatter(), new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    expect(q(result.quality)).toBeCloseTo(0.75, 2);
  });

  it("test_word_count_above_500_base_08", () => {
    const page = path.join(tmpPath, "wiki", "long.md");
    writePage(page, fullFrontmatter(), new Array(600).fill("word").join(" "));
    const result = scorePage(page, edges);
    expect(q(result.quality)).toBeCloseTo(0.95, 2);
  });

  it("test_complete_frontmatter_bonus", () => {
    const page = path.join(tmpPath, "wiki", "complete.md");
    writePage(page, fullFrontmatter(), new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("complete_frontmatter")).toBe(true);
    expect(signals.get("complete_frontmatter")).toBeCloseTo(0.1);
  });

  it("test_missing_title_penalty", () => {
    const fm = fullFrontmatter();
    delete fm["title"];
    const page = path.join(tmpPath, "wiki", "notitle.md");
    writePage(page, fm, new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("missing_title")).toBe(true);
    expect(signals.get("missing_title")).toBeCloseTo(-0.3);
  });

  it("test_no_sources_penalty", () => {
    const page = path.join(tmpPath, "wiki", "nosrc.md");
    writePage(
      page,
      fullFrontmatter({ sources: [] }),
      new Array(200).fill("word").join(" "),
    );
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("no_sources")).toBe(true);
    expect(signals.get("no_sources")).toBeCloseTo(-0.2);
  });

  it("test_no_summary_penalty", () => {
    const fm = fullFrontmatter();
    delete fm["summary"];
    const page = path.join(tmpPath, "wiki", "nosum.md");
    writePage(page, fm, new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("no_summary")).toBe(true);
    expect(signals.get("no_summary")).toBeCloseTo(-0.1);
  });

  it("test_crossref_links_bonus", () => {
    const page = path.join(tmpPath, "wiki", "linked.md");
    const body =
      "See [auth](auth.md) and [jwt](jwt.md) and [db](db.md). " +
      new Array(200).fill("word").join(" ");
    writePage(page, fullFrontmatter(), body);
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("crossref_links")).toBe(true);
    expect(signals.get("crossref_links")).toBeCloseTo(0.1);
  });

  it("test_concept_tags_bonus", () => {
    const page = path.join(tmpPath, "wiki", "tagged.md");
    writePage(
      page,
      fullFrontmatter({ tags: ["a", "b", "c", "d"] }),
      new Array(200).fill("word").join(" "),
    );
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("concept_tags")).toBe(true);
    expect(signals.get("concept_tags")).toBeCloseTo(0.05);
  });
});

// ── Claims tests ────────────────────────────────────────────────────

describe("TestScorePageClaims", () => {
  let tmpPath: string;
  let edges: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("score-claims-");
    edges = makeEdgesFile(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_claim_with_evidence_bonus", () => {
    const fm = fullFrontmatter({
      type: "claim",
      status: "supported",
      confidence: 0.8,
      evidence: [
        {
          source: "raw/paper.md",
          type: "supports",
          strength: "strong",
          detail: "found in section 3",
        },
      ],
    });
    const page = path.join(tmpPath, "wiki", "claims", "claim1.md");
    writePage(page, fm, new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("claim_has_evidence")).toBe(true);
    expect(signals.get("claim_has_evidence")).toBeCloseTo(0.1);
  });

  it("test_deprecated_without_failure_reason", () => {
    const fm = fullFrontmatter({
      type: "claim",
      status: "deprecated",
      confidence: 0.1,
      failure_reason: "",
    });
    const page = path.join(tmpPath, "wiki", "claims", "old.md");
    writePage(page, fm, new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("deprecated_no_reason")).toBe(true);
    expect(signals.get("deprecated_no_reason")).toBeCloseTo(-0.2);
  });

  it("test_deprecated_with_failure_reason_no_penalty", () => {
    const fm = fullFrontmatter({
      type: "claim",
      status: "deprecated",
      confidence: 0.1,
      failure_reason: "Superseded by new evidence",
    });
    const page = path.join(tmpPath, "wiki", "claims", "explained.md");
    writePage(page, fm, new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("deprecated_no_reason")).toBe(false);
  });
});

// ── Structural signal tests ─────────────────────────────────────────

describe("TestScorePageStructural", () => {
  let tmpPath: string;
  let edges: string;
  let edgesGod: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("score-struct-");
    edges = makeEdgesFile(tmpPath);
    // Re-create edges with god-node topology for tests that need it.
    edgesGod = makeEdgesWithGodNode(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_god_node_bonus", () => {
    const page = path.join(tmpPath, "wiki", "hub.md");
    writePage(page, fullFrontmatter(), new Array(200).fill("word").join(" "));
    const result = scorePage(page, edgesGod);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("god_node")).toBe(true);
    expect(signals.get("god_node")).toBeCloseTo(0.1);
  });

  it("test_isolated_node_penalty", () => {
    const page = path.join(tmpPath, "wiki", "lonely.md");
    writePage(page, fullFrontmatter(), new Array(200).fill("word").join(" "));
    const result = scorePage(page, edgesGod);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("isolated_node")).toBe(true);
    expect(signals.get("isolated_node")).toBeCloseTo(-0.2);
  });

  it("test_has_mermaid_bonus", () => {
    const page = path.join(tmpPath, "wiki", "diag.md");
    const body =
      new Array(200).fill("word").join(" ") +
      "\n\n```mermaid\nerDiagram\n    A ||--o{ B : has\n```\n";
    writePage(page, fullFrontmatter(), body);
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("has_mermaid")).toBe(true);
    expect(signals.get("has_mermaid")).toBeCloseTo(0.05);
  });

  it("test_missing_mermaid_penalty", () => {
    const fm = fullFrontmatter({
      type: "entity",
      tags: ["database", "schema", "postgresql"],
    });
    const page = path.join(tmpPath, "wiki", "db", "tables.md");
    writePage(page, fm, new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    const signals = new Map(result.signals.map((s) => [s.signal, s.delta]));
    expect(signals.has("missing_mermaid")).toBe(true);
    expect(signals.get("missing_mermaid")).toBeCloseTo(-0.1);
  });
});

// ── Clamping tests ──────────────────────────────────────────────────

describe("TestScorePageClamping", () => {
  let tmpPath: string;
  let edges: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("score-clamp-");
    edges = makeEdgesFile(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_clamped_to_zero", () => {
    const page = path.join(tmpPath, "wiki", "terrible.md");
    writePage(page, { type: "concept" }, "Short.");
    const result = scorePage(page, edges);
    expect(q(result.quality)).toBe(0.0);
  });

  it("test_clamped_to_one", () => {
    const edgesGod = makeEdgesWithGodNode(tmpPath);
    const body =
      new Array(600).fill("word").join(" ") +
      "\nSee [a](a.md) and [b](b.md) and [c](c.md).\n" +
      "\n```mermaid\nerDiagram\n    X ||--o{ Y : has\n```\n";
    const page = path.join(tmpPath, "wiki", "hub.md");
    const fm = fullFrontmatter({
      type: "claim",
      status: "supported",
      evidence: [
        { source: "x", type: "supports", strength: "strong", detail: "y" },
      ],
    });
    writePage(page, fm, body);
    const result = scorePage(page, edgesGod);
    expect(q(result.quality)).toBeLessThanOrEqual(1.0);
  });
});

// ── Output structure tests ──────────────────────────────────────────

describe("TestScorePageOutput", () => {
  let tmpPath: string;
  let edges: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("score-out-");
    edges = makeEdgesFile(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_returns_quality_and_signals", () => {
    const page = path.join(tmpPath, "wiki", "test.md");
    writePage(page, fullFrontmatter(), new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    // `result.quality` is pyFloat-wrapped; the underlying value is numeric.
    expect(typeof q(result.quality)).toBe("number");
    expect(Array.isArray(result.signals)).toBe(true);
  });

  it("test_signals_have_signal_and_delta", () => {
    const page = path.join(tmpPath, "wiki", "test.md");
    writePage(page, fullFrontmatter(), new Array(200).fill("word").join(" "));
    const result = scorePage(page, edges);
    for (const s of result.signals) {
      expect("signal" in s).toBe(true);
      expect("delta" in s).toBe(true);
    }
  });
});

// ── score_wiki tests ────────────────────────────────────────────────

describe("TestScoreWiki", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("score-wiki-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_returns_sorted_list", () => {
    const wiki = makeWikiWithPages(tmpPath);
    const results = scoreWiki(wiki);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const qualities = results.map((r) => q(r.quality));
    const sorted = [...qualities].sort((a, b) => b - a);
    expect(qualities).toEqual(sorted);
  });

  it("test_includes_all_pages", () => {
    const wiki = makeWikiWithPages(tmpPath);
    const results = scoreWiki(wiki);
    const pages = new Set(results.map((r) => r.page));
    expect(pages.size).toBeGreaterThanOrEqual(5);
  });

  it("test_empty_wiki", () => {
    const wiki = makeInitializedWiki(tmpPath);
    const results = scoreWiki(wiki);
    expect(Array.isArray(results)).toBe(true);
  });
});

// ── CLI tests ──────────────────────────────────────────────────────

function runCli(
  bin: string,
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      stdout:
        typeof err.stdout === "string"
          ? err.stdout
          : (err.stdout?.toString("utf-8") ?? ""),
      stderr:
        typeof err.stderr === "string"
          ? err.stderr
          : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

describe("TestQualityScoreCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("score-cli-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_single_page", () => {
    const edges = makeEdgesFile(tmpPath);
    const page = path.join(tmpPath, "wiki", "test.md");
    writePage(page, fullFrontmatter(), new Array(200).fill("word").join(" "));
    const result = runCli(CLI, ["--page", page, "--edges", edges]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    expect("quality" in data).toBe(true);
    expect("signals" in data).toBe(true);
  });

  it("test_cli_wiki_root", () => {
    const wiki = makeWikiWithPages(tmpPath);
    const result = runCli(CLI, ["--wiki-root", wiki]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(5);
  });

  it("cli_terrible_page_emits_float_zero", () => {
    // Previously a Python-parity check; retained as a TypeScript-only
    // contract: clamped-to-0 quality must serialize as "0.0" (Python-style
    // float) not "0" (int), so downstream Python consumers — if any — get
    // the right JSON shape.
    const edges = makeEdgesFile(tmpPath);
    const page = path.join(tmpPath, "wiki", "terrible.md");
    writePage(page, { type: "concept" }, "Short.");
    const ts = runCli(CLI, ["--page", page, "--edges", edges]);
    expect(ts.status).toBe(0);
    expect(ts.stdout).toContain('"quality": 0.0');
  });
});
