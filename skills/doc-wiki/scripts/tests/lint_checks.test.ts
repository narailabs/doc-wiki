/**
 * Tests for lint_checks.ts — originally ported from test_lint_checks.py.
 * The Python parity comparisons were removed in Phase 9; what remains is
 * the TypeScript-only unit + CLI suite.
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
  checkDeprecatedClaims,
  checkFrontmatter,
  checkHighAmbiguityRate,
  checkIndexCoverage,
  checkIsolatedNodes,
  checkMermaidSyntax,
  checkOrmMappingFreshness,
  checkOrphans,
  checkProvenanceCompleteness,
  checkStaleContent,
  checkSummariesSync,
  checkThinClusters,
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

  // G-LINT-REGEX: the link regex used to live at module scope with /g,
  // so its shared lastIndex could make a second call return fewer
  // matches. Call checkBrokenLinks twice in succession and require the
  // issue list to be identical.
  it("test_reentrant_calls_stable", () => {
    const page = path.join(wiki, "wiki", "page.md");
    writePage(
      page,
      fullFm(),
      "[a](nope1.md) [b](nope2.md) [c](nope3.md)\n",
    );
    const first = checkBrokenLinks(wiki);
    const second = checkBrokenLinks(wiki);
    expect(second).toEqual(first);
    expect(first.filter((i) => i.detail.includes("nope")).length).toBe(3);
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

// ── Mermaid syntax tests ──────────────────────────────────────────

describe("TestCheckMermaidSyntax", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-mermaid-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_flags_invalid_diagram_type", () => {
    const page = path.join(wiki, "wiki", "bad.md");
    writePage(
      page,
      fullFm(),
      "See below.\n\n```mermaid\nnotADiagramType\n    A --> B\n```\n",
    );
    const issues = checkMermaidSyntax(wiki);
    const mi = issues.filter((i) => i.page.includes("bad.md"));
    expect(mi.length).toBeGreaterThanOrEqual(1);
    expect(mi[0]?.category).toBe("mermaid_syntax");
    expect(mi[0]?.severity).toBe("warning");
  });

  it("test_valid_mermaid_no_issue", () => {
    const page = path.join(wiki, "wiki", "ok.md");
    writePage(
      page,
      fullFm(),
      "```mermaid\nsequenceDiagram\n    A->>B: hi\n```\n",
    );
    const issues = checkMermaidSyntax(wiki);
    const mi = issues.filter((i) => i.page.includes("ok.md"));
    expect(mi).toEqual([]);
  });

  it("test_registered_in_lintWiki", () => {
    const page = path.join(wiki, "wiki", "bad.md");
    writePage(
      page,
      fullFm(),
      "```mermaid\nbogus\n    A --> B\n```\n",
    );
    const result = lintWiki(wiki, "mermaid_syntax");
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    for (const issue of result.issues) {
      expect(issue.category).toBe("mermaid_syntax");
    }
  });
});

// ── Index coverage tests ──────────────────────────────────────────

describe("TestCheckIndexCoverage", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-index-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_missing_entry_flagged", () => {
    writePage(path.join(wiki, "wiki", "alpha.md"), fullFm(), "body\n");
    writePage(path.join(wiki, "wiki", "beta.md"), fullFm(), "body\n");
    // index.md only mentions alpha.md
    fs.writeFileSync(
      path.join(wiki, "wiki", "index.md"),
      "# Index\n\n- [Alpha](alpha.md)\n",
    );
    const issues = checkIndexCoverage(wiki);
    const flaggedBases = issues.map((i) => path.basename(i.page));
    expect(flaggedBases).toContain("beta.md");
    expect(flaggedBases).not.toContain("alpha.md");
    const missing = issues.find((i) => path.basename(i.page) === "beta.md");
    expect(missing?.severity).toBe("error");
    expect(missing?.category).toBe("index_coverage");
  });

  it("test_scaffold_pages_never_flagged", () => {
    // summaries.md / overview.md already exist from makeInitializedWiki.
    fs.writeFileSync(
      path.join(wiki, "wiki", "index.md"),
      "# Index\n",
    );
    const issues = checkIndexCoverage(wiki);
    const rel = issues.map((i) => i.page);
    expect(rel.some((p) => p.includes("summaries.md"))).toBe(false);
    expect(rel.some((p) => p.includes("overview.md"))).toBe(false);
  });
});

// ── Summaries sync tests ──────────────────────────────────────────

describe("TestCheckSummariesSync", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-sum-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_stale_hash_flagged", () => {
    writePage(
      path.join(wiki, "wiki", "auth.md"),
      fullFm({ summary_hash: "newhash" }),
      "body\n",
    );
    fs.writeFileSync(
      path.join(wiki, "wiki", "summaries.md"),
      "# Summaries\n\n- [Auth](auth.md) `oldhash`: outdated entry\n",
    );
    const issues = checkSummariesSync(wiki);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.category).toBe("summaries_sync");
    expect(issues[0]?.detail.includes("oldhash")).toBe(true);
  });

  it("test_missing_entry_flagged", () => {
    writePage(
      path.join(wiki, "wiki", "auth.md"),
      fullFm({ summary_hash: "hash1" }),
      "body\n",
    );
    fs.writeFileSync(
      path.join(wiki, "wiki", "summaries.md"),
      "# Summaries\n",
    );
    const issues = checkSummariesSync(wiki);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.detail.toLowerCase().includes("missing")).toBe(true);
  });

  it("test_matching_hash_no_issue", () => {
    writePage(
      path.join(wiki, "wiki", "auth.md"),
      fullFm({ summary_hash: "abc123" }),
      "body\n",
    );
    fs.writeFileSync(
      path.join(wiki, "wiki", "summaries.md"),
      "# Summaries\n\n- [Auth](auth.md) `abc123`: fine\n",
    );
    const issues = checkSummariesSync(wiki);
    expect(issues).toEqual([]);
  });
});

// ── ORM mapping freshness tests ───────────────────────────────────

describe("TestCheckOrmMappingFreshness", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-orm-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_stale_mapping_flagged", () => {
    // Write a SQLAlchemy source so the profile activates via substring detection.
    const src = path.join(wiki, "models.py");
    fs.writeFileSync(
      src,
      "from sqlalchemy import Column, Integer\n" +
        "from sqlalchemy.ext.declarative import declarative_base\n" +
        "Base = declarative_base()\n" +
        "class User(Base):\n" +
        "    __tablename__ = 'users'\n" +
        "    id = Column(Integer, primary_key=True)\n",
    );

    // Mapping page generated BEFORE the source was last modified.
    const mappingFm = fullFm({
      title: "Database Mapping",
      generated_at: "2020-01-01T00:00:00Z",
    });
    const mapping = path.join(wiki, "wiki", "database-mapping.md");
    writePage(mapping, mappingFm, "# Mapping\n");

    // Force mtime forward.
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(src, future, future);

    const issues = checkOrmMappingFreshness(wiki);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.category).toBe("orm_mapping_freshness");
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.detail.includes("generated_at")).toBe(true);
  });

  it("test_fresh_mapping_no_issue", () => {
    const src = path.join(wiki, "models.py");
    fs.writeFileSync(
      src,
      "from sqlalchemy import Column\nclass User: pass\n",
    );
    // Backdate source.
    const past = new Date(Date.now() - 5 * 86_400_000);
    fs.utimesSync(src, past, past);

    const mappingFm = fullFm({
      title: "Database Mapping",
      generated_at: new Date().toISOString(),
    });
    const mapping = path.join(wiki, "wiki", "database-mapping.md");
    writePage(mapping, mappingFm, "# Mapping\n");

    const issues = checkOrmMappingFreshness(wiki);
    expect(issues).toEqual([]);
  });

  it("test_missing_mapping_file_noop", () => {
    // No database-mapping.md → no issues.
    const issues = checkOrmMappingFreshness(wiki);
    expect(issues).toEqual([]);
  });

  it("test_sibling_sources_shadowed_by_wiki_root_stub", () => {
    // Regression for the ORM source-root precedence foot-gun: a stub
    // `models.py` inside the wiki root must NOT mask a freshly-edited
    // `models.py` sitting at the parent (project) level. Both roots are
    // scanned and the max mtime across the union wins.
    const stubInWiki = path.join(wiki, "models.py");
    fs.writeFileSync(
      stubInWiki,
      "from sqlalchemy import Column\nclass Stub: pass\n",
    );
    // Backdate the stub well into the past.
    const past = new Date(Date.now() - 30 * 86_400_000);
    fs.utimesSync(stubInWiki, past, past);

    // The real project source sits at the PARENT of wikiRoot.
    const projectSrc = path.join(path.dirname(wiki), "real_models.py");
    fs.writeFileSync(
      projectSrc,
      "from sqlalchemy import Column, Integer\n" +
        "from sqlalchemy.ext.declarative import declarative_base\n" +
        "Base = declarative_base()\n" +
        "class User(Base):\n" +
        "    __tablename__ = 'users'\n" +
        "    id = Column(Integer, primary_key=True)\n",
    );
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(projectSrc, future, future);

    const mappingFm = fullFm({
      title: "Database Mapping",
      generated_at: "2020-01-01T00:00:00Z",
    });
    const mapping = path.join(wiki, "wiki", "database-mapping.md");
    writePage(mapping, mappingFm, "# Mapping\n");

    try {
      const issues = checkOrmMappingFreshness(wiki);
      expect(issues.length).toBeGreaterThanOrEqual(1);
      // The flagged file must be the real project source, not the wiki stub.
      expect(issues[0]?.detail).toContain("real_models.py");
    } finally {
      // Clean up the file created at the parent so it doesn't leak.
      fs.rmSync(projectSrc, { force: true });
    }
  });
});

// ── Thin clusters tests ───────────────────────────────────────────

describe("TestCheckThinClusters", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-clusters-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_two_page_cluster_flagged", () => {
    // One isolated cluster: A <-> B (2 pages), one big cluster: C,D,E (3 pages).
    const edges = [
      { from: "A.md", to: "B.md", type: "extends", provenance: "EXTRACTED" },
      { from: "C.md", to: "D.md", type: "extends", provenance: "EXTRACTED" },
      { from: "D.md", to: "E.md", type: "extends", provenance: "EXTRACTED" },
    ];
    fs.writeFileSync(
      path.join(wiki, "graph", "edges.jsonl"),
      edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    const issues = checkThinClusters(wiki);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]?.category).toBe("thin_clusters");
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.detail.includes("A.md")).toBe(true);
    expect(issues[0]?.detail.includes("B.md")).toBe(true);
    // The 3-page cluster should not be flagged.
    const threePageFlagged = issues.some((i) =>
      i.detail.includes("C.md") && i.detail.includes("D.md"),
    );
    expect(threePageFlagged).toBe(false);
  });

  it("test_all_clusters_large_enough", () => {
    const edges = [
      { from: "A.md", to: "B.md", type: "extends", provenance: "EXTRACTED" },
      { from: "B.md", to: "C.md", type: "extends", provenance: "EXTRACTED" },
      { from: "C.md", to: "D.md", type: "extends", provenance: "EXTRACTED" },
    ];
    fs.writeFileSync(
      path.join(wiki, "graph", "edges.jsonl"),
      edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    const issues = checkThinClusters(wiki);
    expect(issues).toEqual([]);
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

  // A4: --page scopes the report. Default behaviour (whole wiki) unchanged.
  it("test_cli_page_filter_returns_only_target_page_issues", () => {
    const result = runCli(CLI, [
      "--wiki-root",
      wiki,
      "--page",
      "wiki/broken.md",
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    const pages = new Set<string>(
      (data.issues as Array<{ page: string }>).map((i) => i.page),
    );
    // Every issue's page must end with the requested wiki-relative path.
    for (const p of pages) {
      expect(p.endsWith("wiki/broken.md")).toBe(true);
    }
    // The unfiltered run includes lots of non-broken.md issues — verify
    // the filtered run is strictly smaller.
    const fullResult = runCli(CLI, ["--wiki-root", wiki]);
    const fullData = JSON.parse(fullResult.stdout);
    expect(data.issues.length).toBeLessThan(fullData.issues.length);
  });

  it("test_cli_page_filter_glob", () => {
    const result = runCli(CLI, [
      "--wiki-root",
      wiki,
      "--page",
      "wiki/auth/*.md",
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout);
    for (const issue of data.issues as Array<{ page: string }>) {
      // Glob constrains to wiki/auth/*.md basenames.
      expect(issue.page).toMatch(/wiki\/auth\/[^/]+\.md$/);
    }
  });

  it("test_cli_help_mentions_page_flag", () => {
    const result = runCli(CLI, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--page PAGE");
  });

});

// ── Page-scoped lint (A4) — library-level ─────────────────────────
describe("lintWiki --page filter (A4)", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-page-");
    wiki = makeWikiWithPages(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("limits issues to one page when given an absolute path", () => {
    const target = path.join(wiki, "wiki", "broken.md");
    const filtered = lintWiki(wiki, null, target);
    for (const iss of filtered.issues) {
      expect(iss.page).toBe(target);
    }
    // Summary reflects the post-filter list.
    const sumTotal =
      filtered.summary.error + filtered.summary.warning + filtered.summary.info;
    expect(sumTotal).toBe(filtered.issues.length);
  });

  it("limits issues to one page when given a wiki-relative path", () => {
    const filtered = lintWiki(wiki, null, "wiki/broken.md");
    expect(filtered.issues.length).toBeGreaterThan(0);
    for (const iss of filtered.issues) {
      expect(iss.page.endsWith("wiki/broken.md")).toBe(true);
    }
  });

  it("default behaviour (no --page) returns the same result as before", () => {
    const before = lintWiki(wiki);
    const explicitNull = lintWiki(wiki, null, null);
    expect(explicitNull.issues.length).toBe(before.issues.length);
  });

  it("can combine --page with --category", () => {
    // Run only broken_links category against broken.md.
    const filtered = lintWiki(wiki, "broken_links", "wiki/broken.md");
    expect(filtered.issues.every((i) => i.category === "broken_links")).toBe(
      true,
    );
    expect(
      filtered.issues.every((i) => i.page.endsWith("wiki/broken.md")),
    ).toBe(true);
  });
});

// ── Page type enum validation (G5) ─────────────────────────────────

describe("checkFrontmatter page-type enum", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-type-enum-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("flags a typo'd type value as an error", () => {
    const page = path.join(wiki, "wiki", "typo.md");
    writePage(page, fullFm({ type: "concepts" }), "Body\n");
    const issues = checkFrontmatter(wiki);
    const pageIssues = issues.filter((i) => i.page === page);
    expect(pageIssues.length).toBe(1);
    expect(pageIssues[0]?.severity).toBe("error");
    expect(pageIssues[0]?.detail).toContain("concepts");
    expect(pageIssues[0]?.detail).toContain("concept|entity|summary");
  });

  it.each([
    "concept",
    "entity",
    "summary",
    "index",
    "lecture",
    "claim",
    "synthesis",
  ])("accepts the '%s' type with no issue", (t) => {
    const page = path.join(wiki, "wiki", `${t}.md`);
    writePage(page, fullFm({ type: t }), "Body\n");
    const issues = checkFrontmatter(wiki);
    const pageIssues = issues.filter((i) => i.page === page);
    expect(pageIssues).toEqual([]);
  });

  it("emits both the missing-field and invalid-type errors independently", () => {
    const page = path.join(wiki, "wiki", "doubly-wrong.md");
    // Missing `title` AND bad `type` — both errors expected.
    const fm = { ...fullFm({ type: "Concept" }) };
    delete (fm as Record<string, unknown>)["title"];
    writePage(page, fm, "Body\n");
    const issues = checkFrontmatter(wiki);
    const pageIssues = issues.filter((i) => i.page === page);
    const details = pageIssues.map((i) => i.detail).sort();
    expect(details).toEqual(expect.arrayContaining([
      expect.stringContaining("title"),
      expect.stringContaining("Concept"),
    ]));
  });
});

// ── Stale content (G10) ────────────────────────────────────────────

describe("checkStaleContent", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-stale-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("flags a page updated more than 90 days ago as info", () => {
    const page = path.join(wiki, "wiki", "old.md");
    writePage(page, fullFm({ updated: "2024-01-01" }), "Body\n");
    const now = new Date("2026-04-13T00:00:00Z");
    const issues = checkStaleContent(wiki, 90, now);
    const pageIssues = issues.filter((i) => i.page === page);
    expect(pageIssues.length).toBe(1);
    expect(pageIssues[0]?.severity).toBe("info");
    expect(pageIssues[0]?.category).toBe("stale_content");
    expect(pageIssues[0]?.detail).toMatch(/days old/);
  });

  it("does not flag fresh pages", () => {
    const page = path.join(wiki, "wiki", "fresh.md");
    writePage(page, fullFm({ updated: "2026-04-10" }), "Body\n");
    const now = new Date("2026-04-13T00:00:00Z");
    const issues = checkStaleContent(wiki, 90, now);
    const pageIssues = issues.filter((i) => i.page === page);
    expect(pageIssues).toEqual([]);
  });

  it("skips pages whose updated field is unparseable", () => {
    const page = path.join(wiki, "wiki", "garbage-date.md");
    writePage(page, fullFm({ updated: "not-a-date" }), "Body\n");
    const now = new Date("2026-04-13T00:00:00Z");
    const issues = checkStaleContent(wiki, 90, now);
    const pageIssues = issues.filter((i) => i.page === page);
    expect(pageIssues).toEqual([]);
  });

  it("honors a custom threshold", () => {
    const page = path.join(wiki, "wiki", "week-old.md");
    writePage(page, fullFm({ updated: "2026-04-01" }), "Body\n");
    const now = new Date("2026-04-13T00:00:00Z");
    // 12 days old — flagged when threshold is 7, skipped when 30.
    expect(
      checkStaleContent(wiki, 7, now).filter((i) => i.page === page).length,
    ).toBe(1);
    expect(
      checkStaleContent(wiki, 30, now).filter((i) => i.page === page).length,
    ).toBe(0);
  });

  it("skips pages with missing frontmatter (no throw)", () => {
    const page = path.join(wiki, "wiki", "bare.md");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, "no frontmatter here\n");
    const issues = checkStaleContent(wiki);
    expect(issues.filter((i) => i.page === page)).toEqual([]);
  });
});

describe("checkDeprecatedClaims", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("lint-deprecated-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  function claim(rel: string, fm: Record<string, unknown>): string {
    const p = path.join(wiki, "wiki", "claims", rel);
    writePage(
      p,
      fullFm({ type: "claim", ...fm }),
      "Claim body.\n",
    );
    return p;
  }

  it("flags deprecated claim with missing failure_reason as error", () => {
    const p = claim("dead.md", { status: "deprecated", confidence: 0.1 });
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.category).toBe("deprecated_claims");
    expect(issues[0]?.detail).toContain("failure_reason");
  });

  it("flags deprecated claim with empty/whitespace failure_reason as error", () => {
    const p = claim("blank.md", {
      status: "deprecated",
      confidence: 0.1,
      failure_reason: "   ",
    });
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
  });

  it("accepts deprecated claim with non-empty failure_reason", () => {
    const p = claim("ok.md", {
      status: "deprecated",
      confidence: 0.1,
      failure_reason: "Superseded by the new approach in RFC-42.",
    });
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toEqual([]);
  });

  it("warns on deprecated claim with high confidence (>0.3)", () => {
    const p = claim("suspicious.md", {
      status: "deprecated",
      confidence: 0.85,
      failure_reason: "still being deprecated",
    });
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.detail).toContain("0.85");
  });

  it("emits both error AND confidence warning when deprecated claim is fully broken", () => {
    const p = claim("double.md", {
      status: "deprecated",
      confidence: 0.9,
      // missing failure_reason on purpose
    });
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toHaveLength(2);
    const severities = issues.map((i) => i.severity).sort();
    expect(severities).toEqual(["error", "warning"]);
  });

  it("warns when a non-claim page carries failure_reason", () => {
    const p = path.join(wiki, "wiki", "random.md");
    writePage(
      p,
      fullFm({
        type: "concept",
        failure_reason: "this does nothing here",
      }),
      "Body\n",
    );
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.detail).toContain("non-claim");
  });

  it("warns when a live (non-deprecated) claim carries failure_reason", () => {
    const p = claim("live.md", {
      status: "supported",
      confidence: 0.8,
      failure_reason: "leftover from earlier state",
    });
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.detail).toContain("ignored by banlist");
  });

  it("skips pages without any claim-related fields", () => {
    const p = path.join(wiki, "wiki", "plain.md");
    writePage(p, fullFm({ type: "concept" }), "Body\n");
    const issues = checkDeprecatedClaims(wiki).filter((i) => i.page === p);
    expect(issues).toEqual([]);
  });

  it("is selectable via lintWiki(--category deprecated_claims)", () => {
    claim("broken.md", { status: "deprecated" });
    const result = lintWiki(wiki, "deprecated_claims");
    const cats = new Set(result.issues.map((i) => i.category));
    expect(cats.has("deprecated_claims")).toBe(true);
    // No other categories should appear under a category filter.
    expect(cats.size).toBe(1);
  });
});
