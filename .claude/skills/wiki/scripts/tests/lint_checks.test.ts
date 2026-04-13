/**
 * Tests for lint_checks.ts — ported from test_lint_checks.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled lint_checks.js and confirm stdout
 * matches the Python reference byte-for-byte.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import {
  checkBrokenLinks,
  checkCodeRefDrift,
  checkFrontmatter,
  checkHighAmbiguityRate,
  checkIsolatedNodes,
  checkOrphans,
  checkProvenanceCompleteness,
  lintWiki,
} from "../lint_checks.js";
import {
  SCRIPTS_DIR,
  makeInitializedWiki,
  makeTmpPath,
  makeWikiWithPages,
  cleanupTmpPath,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "lint_checks.js");
const PY_CLI = path.join(SCRIPTS_DIR, "lint_checks.py");

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

function fullFm(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "Test Page",
    type: "concept",
    tags: ["test"],
    sources: ["raw/test.md"],
    created: "2026-04-12",
    updated: "2026-04-12",
    quality: 0.0,
    summary: "Test page summary.",
    ...overrides,
  };
}

// ── Broken links tests ─────────────────────────────────────────────

describe("TestCheckBrokenLinks", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-broken-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_detects_broken_link", () => {
    const page = path.join(wiki, "wiki", "page.md");
    writePage(page, fullFm(), "See [missing](nonexistent.md).\n");
    const issues = checkBrokenLinks(wiki);
    const broken = issues.filter((i) => i.detail.includes("nonexistent"));
    expect(broken.length).toBeGreaterThanOrEqual(1);
    expect(broken[0]?.severity).toBe("error");
  });

  it("test_valid_links_no_issues", () => {
    const page = path.join(wiki, "wiki", "page.md");
    writePage(page, fullFm(), "See [index](index.md).\n");
    const issues = checkBrokenLinks(wiki);
    const pageIssues = issues.filter((i) => i.page.includes("page.md"));
    expect(pageIssues).toEqual([]);
  });

  it("test_external_links_ignored", () => {
    const page = path.join(wiki, "wiki", "page.md");
    writePage(page, fullFm(), "See [google](https://google.com).\n");
    const issues = checkBrokenLinks(wiki);
    const pageIssues = issues.filter((i) => i.page.includes("page.md"));
    expect(pageIssues).toEqual([]);
  });

  it("test_anchor_links_ignored", () => {
    const page = path.join(wiki, "wiki", "page.md");
    writePage(page, fullFm(), "See [section](#overview).\n");
    const issues = checkBrokenLinks(wiki);
    const pageIssues = issues.filter((i) => i.page.includes("page.md"));
    expect(pageIssues).toEqual([]);
  });
});

// ── Frontmatter tests ──────────────────────────────────────────────

describe("TestCheckFrontmatter", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-fm-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_detects_missing_title", () => {
    const fm = fullFm();
    delete fm["title"];
    const page = path.join(wiki, "wiki", "notitle.md");
    writePage(page, fm, "Content.\n");
    const issues = checkFrontmatter(wiki);
    const titleIssues = issues.filter(
      (i) =>
        i.detail.toLowerCase().includes("title") &&
        i.page.includes("notitle.md"),
    );
    expect(titleIssues.length).toBeGreaterThanOrEqual(1);
  });

  it("test_detects_missing_multiple_fields", () => {
    const page = path.join(wiki, "wiki", "sparse.md");
    writePage(page, { type: "concept" }, "Content.\n");
    const issues = checkFrontmatter(wiki);
    const sparseIssues = issues.filter((i) => i.page.includes("sparse.md"));
    expect(sparseIssues.length).toBeGreaterThanOrEqual(3);
  });

  it("test_complete_frontmatter_no_issues", () => {
    const page = path.join(wiki, "wiki", "complete.md");
    writePage(page, fullFm(), "Content.\n");
    const issues = checkFrontmatter(wiki);
    const completeIssues = issues.filter((i) => i.page.includes("complete.md"));
    expect(completeIssues).toEqual([]);
  });

  it("test_no_frontmatter_at_all", () => {
    const page = path.join(wiki, "wiki", "nofm.md");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, "# Just a heading\n\nNo frontmatter.\n");
    const issues = checkFrontmatter(wiki);
    const nofmIssues = issues.filter((i) => i.page.includes("nofm.md"));
    expect(nofmIssues.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Orphans tests ──────────────────────────────────────────────────

describe("TestCheckOrphans", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-orphans-");
    wiki = makeWikiWithPages(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_detects_orphan_page", () => {
    const issues = checkOrphans(wiki);
    const orphanPages = issues.map((i) => i.page);
    expect(orphanPages.some((p) => p.includes("orphan.md"))).toBe(true);
  });

  it("test_linked_page_not_orphan", () => {
    const issues = checkOrphans(wiki);
    const orphanPages = issues.map((i) => i.page);
    expect(orphanPages.some((p) => p.includes("session.md"))).toBe(false);
  });

  it("test_index_not_orphan", () => {
    const issues = checkOrphans(wiki);
    const orphanPages = issues.map((i) => i.page);
    expect(orphanPages.some((p) => p.includes("index.md"))).toBe(false);
  });
});

// ── Isolated nodes tests ──────────────────────────────────────────

describe("TestCheckIsolatedNodes", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-isolated-");
    wiki = makeWikiWithPages(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_detects_isolated", () => {
    const issues = checkIsolatedNodes(wiki);
    const isolated = issues.map((i) => i.page);
    expect(isolated.some((p) => p.includes("orphan.md"))).toBe(true);
  });

  it("test_connected_not_flagged", () => {
    const issues = checkIsolatedNodes(wiki);
    const isolated = issues.map((i) => i.page);
    expect(isolated.some((p) => p.includes("session.md"))).toBe(false);
  });
});

// ── Code ref drift tests ──────────────────────────────────────────

describe("TestCheckCodeRefDrift", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-drift-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_hash_mismatch", () => {
    const src = path.join(wiki, "src", "auth.py");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, "def authenticate(): pass\n");

    const fm = fullFm({
      references: [
        {
          path: "src/auth.py",
          lines: [1],
          symbol: "authenticate",
          content_hash: "wrong_hash_value",
        },
      ],
    });
    const page = path.join(wiki, "wiki", "ref.md");
    writePage(page, fm, "References auth code.\n");

    const issues = checkCodeRefDrift(wiki);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.severity).toBe("warning");
  });

  it("test_matching_hash_no_issue", () => {
    const src = path.join(wiki, "src", "auth.py");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    const content = "def authenticate(): pass\n";
    fs.writeFileSync(src, content);
    const correctHash = crypto
      .createHash("sha256")
      .update(content, "utf-8")
      .digest("hex");

    const fm = fullFm({
      references: [
        {
          path: "src/auth.py",
          lines: [1],
          symbol: "authenticate",
          content_hash: correctHash,
        },
      ],
    });
    const page = path.join(wiki, "wiki", "ref.md");
    writePage(page, fm, "References auth code.\n");

    const issues = checkCodeRefDrift(wiki);
    const refIssues = issues.filter((i) => i.page.includes("ref.md"));
    expect(refIssues).toEqual([]);
  });
});

// ── Provenance tests ──────────────────────────────────────────────

describe("TestCheckProvenance", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-prov-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_edge_missing_provenance", () => {
    const wiki = makeInitializedWiki(tmpPath);
    const edgesPath = path.join(wiki, "graph", "edges.jsonl");
    fs.writeFileSync(
      edgesPath,
      JSON.stringify({ from: "A", to: "B", type: "extends" }) + "\n",
    );
    const issues = checkProvenanceCompleteness(wiki);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.severity).toBe("error");
  });

  it("test_all_edges_have_provenance", () => {
    const wiki = makeWikiWithPages(tmpPath);
    const issues = checkProvenanceCompleteness(wiki);
    expect(issues).toEqual([]);
  });
});

// ── Ambiguity rate tests ──────────────────────────────────────────

describe("TestCheckAmbiguityRate", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-amb-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_above_20_percent", () => {
    const wiki = makeInitializedWiki(tmpPath);
    const edgesPath = path.join(wiki, "graph", "edges.jsonl");
    const edges = [
      { from: "A", to: "B", type: "extends", provenance: "AMBIGUOUS" },
      { from: "B", to: "C", type: "extends", provenance: "AMBIGUOUS" },
      { from: "C", to: "D", type: "extends", provenance: "AMBIGUOUS" },
      { from: "D", to: "E", type: "extends", provenance: "EXTRACTED" },
    ];
    fs.writeFileSync(
      edgesPath,
      edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    const issues = checkHighAmbiguityRate(wiki);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.severity).toBe("warning");
  });

  it("test_below_20_percent", () => {
    // wiki_with_pages has 1 AMBIGUOUS out of 5 = 20% (not > 20%)
    const wiki = makeWikiWithPages(tmpPath);
    const issues = checkHighAmbiguityRate(wiki);
    expect(issues).toEqual([]);
  });
});

// ── lint_wiki integration tests ────────────────────────────────────

describe("TestLintWiki", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-wiki-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_runs_all_checks", () => {
    const wiki = makeWikiWithPages(tmpPath);
    const result = lintWiki(wiki);
    expect("issues" in result).toBe(true);
    expect("summary" in result).toBe(true);
    const categories = new Set(result.issues.map((i) => i.category));
    expect(categories.size).toBeGreaterThanOrEqual(1);
  });

  it("test_summary_counts", () => {
    const wiki = makeWikiWithPages(tmpPath);
    const result = lintWiki(wiki);
    expect("error" in result.summary).toBe(true);
    expect("warning" in result.summary).toBe(true);
    expect("info" in result.summary).toBe(true);
  });

  it("test_clean_wiki", () => {
    // Build a minimal clean wiki
    const wikiDir = path.join(tmpPath, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "graph"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "graph", "edges.jsonl"), "");
    writePage(
      path.join(wikiDir, "index.md"),
      fullFm({ title: "Index", type: "index" }),
      "# Index\n",
    );
    const result = lintWiki(tmpPath);
    expect(result.summary.error).toBe(0);
  });
});

// ── CLI tests ──────────────────────────────────────────────────────

function runCli(
  bin: string,
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  const interpreter = bin.endsWith(".py") ? "python3" : "node";
  try {
    const stdout = execFileSync(interpreter, [bin, ...args], {
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

describe("TestLintChecksCLI", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-cli-");
    wiki = makeWikiWithPages(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_full_lint", () => {
    const result = runCli(CLI, ["--wiki-root", wiki]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    expect("issues" in data).toBe(true);
    expect("summary" in data).toBe(true);
  });

  it("test_cli_category_filter", () => {
    const result = runCli(CLI, [
      "--wiki-root",
      wiki,
      "--category",
      "broken_links",
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    const categories = new Set<string>(
      (data.issues as Array<{ category: string }>).map((i) => i.category),
    );
    for (const c of categories) {
      expect(c).toBe("broken_links");
    }
  });

  it("cli_full_lint_matches_python", () => {
    const py = runCli(PY_CLI, ["--wiki-root", wiki]);
    const ts = runCli(CLI, ["--wiki-root", wiki]);
    expect(py.status).toBe(0);
    expect(ts.status).toBe(0);
    expect(ts.stdout).toBe(py.stdout);
  });

  it("cli_category_matches_python", () => {
    const py = runCli(PY_CLI, [
      "--wiki-root",
      wiki,
      "--category",
      "broken_links",
    ]);
    const ts = runCli(CLI, [
      "--wiki-root",
      wiki,
      "--category",
      "broken_links",
    ]);
    expect(ts.stdout).toBe(py.stdout);
  });
});
