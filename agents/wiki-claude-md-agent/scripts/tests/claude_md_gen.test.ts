/**
 * Tests for claude_md_gen.ts — ported from test_claude_md_gen.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled claude_md_gen.js via Node.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  generateClaudeMd,
  updateClaudeMd,
  extractManagedSection,
  listSubmodules,
  listWikiPagesForRouting,
  buildRoutingTable,
  MarkerCorruptError,
  MARKER_START,
  MARKER_END,
} from "../claude_md_gen.js";

const SCRIPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const CLI = path.join(SCRIPTS_DIR, "claude_md_gen.js");

function runCli(
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
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

// ── Fixtures ────────────────────────────────────────────────────────

function makeTmpPath(prefix: string = "claude-md-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTmpPath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Create a minimal project root with a wiki directory. */
function makeProjectRoot(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, "index.md"), "# Wiki Index\n");
  return tmpPath;
}

/** Project root with two submodule directories that each have CLAUDE.md. */
function makeProjectWithSubmodules(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, "index.md"), "# Wiki Index\n");

  for (const name of ["services/auth", "services/billing"]) {
    const sub = path.join(tmpPath, name);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, "CLAUDE.md"),
      `# ${name}\n\nCustom content.\n`,
    );
  }
  return tmpPath;
}

/**
 * Create a wiki page with YAML frontmatter in `<wikiRoot>/wiki/<relPath>`.
 * `frontmatterLines` are bare YAML key: value lines (no delimiters needed).
 */
function makeWikiPage(
  wikiRoot: string,
  relPath: string,
  frontmatterLines: string[],
  body: string = "Content.\n",
): void {
  const absPath = path.join(wikiRoot, "wiki", relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const fm = `---\n${frontmatterLines.join("\n")}\n---\n`;
  fs.writeFileSync(absPath, fm + body, "utf-8");
}

/** Create a minimal project root with wiki directory and several atlas pages. */
function makeProjectWithAtlasPages(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, "index.md"), "# Wiki Index\n");
  makeWikiPage(tmpPath, "overview.md", ["title: Overview", "atlas_facet: overview"]);
  makeWikiPage(tmpPath, "auth/architecture.md", [
    "title: Auth Architecture",
    "atlas_facet: architecture",
  ]);
  makeWikiPage(tmpPath, "auth/api.md", ["title: Auth API", "atlas_facet: api"]);
  makeWikiPage(tmpPath, "configuration.md", [
    "title: Configuration",
    "atlas_facet: configuration",
  ]);
  makeWikiPage(tmpPath, "troubleshooting.md", [
    "title: Troubleshooting",
    "atlas_facet: troubleshooting",
  ]);
  return tmpPath;
}

/** Produce a CLAUDE.md file with user sections and wiki-managed markers. */
function makeClaudeMdWithMarkers(tmpPath: string): string {
  const p = path.join(tmpPath, "CLAUDE.md");
  fs.writeFileSync(
    p,
    "# My Project\n\n" +
      "Custom intro that should be preserved.\n\n" +
      "<!-- wiki-managed: start -->\n" +
      "## Overview\n\nOld generated overview.\n" +
      "<!-- wiki-managed: end -->\n\n" +
      "## My Custom Section\n\nThis is hand-written.\n",
  );
  return p;
}

/** Produce a CLAUDE.md file with no wiki-managed markers. */
function makeClaudeMdWithoutMarkers(tmpPath: string): string {
  const p = path.join(tmpPath, "CLAUDE.md");
  fs.writeFileSync(
    p,
    "# My Project\n\nAll custom content, no managed sections.\n",
  );
  return p;
}

// ── generate_claude_md tests ──────────────────────────────────────

describe("TestGenerateClaudeMd", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_generate_basic", () => {
    const root = makeProjectRoot(tmpPath);
    const result = generateClaudeMd(root, path.join(root, "wiki"));
    expect(result.includes("<!-- wiki-managed: start -->")).toBe(true);
    expect(result.includes("<!-- wiki-managed: end -->")).toBe(true);
  });

  it("test_generate_with_wiki_link", () => {
    const root = makeProjectRoot(tmpPath);
    // wikiRoot is the parent dir; the scanner + index live under <wikiRoot>/wiki/.
    const result = generateClaudeMd(root, root);
    expect(result.toLowerCase().includes("wiki")).toBe(true);
    // Should contain a markdown link to the wiki
    expect(result.includes("[") && result.includes("](")).toBe(true);
  });

  it("test_generate_with_submodule", () => {
    const root = makeProjectWithSubmodules(tmpPath);
    const result = generateClaudeMd(
      root,
      path.join(root, "wiki"),
      "services/auth",
    );
    expect(result.includes("<!-- wiki-managed: start -->")).toBe(true);
    // Should reference the root CLAUDE.md
    expect(result.includes("CLAUDE.md")).toBe(true);
  });
});

// ── update_claude_md tests ────────────────────────────────────────

describe("TestUpdateClaudeMd", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_update_preserves_user_sections", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const newManaged = "## Overview\n\nNew generated overview.\n";
    const result = updateClaudeMd(file, newManaged);
    expect(result.includes("Custom intro that should be preserved.")).toBe(true);
    expect(result.includes("## My Custom Section")).toBe(true);
    expect(result.includes("This is hand-written.")).toBe(true);
  });

  it("test_update_replaces_managed_section", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const newManaged = "## Overview\n\nBrand new overview content.\n";
    const result = updateClaudeMd(file, newManaged);
    expect(result.includes("Brand new overview content.")).toBe(true);
    expect(result.includes("Old generated overview.")).toBe(false);
  });

  it("test_idempotent_update", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const newManaged = "## Overview\n\nStable content.\n";
    const first = updateClaudeMd(file, newManaged);
    fs.writeFileSync(file, first);
    const second = updateClaudeMd(file, newManaged);
    expect(first).toBe(second);
  });

  it("test_handles_missing_file", () => {
    const missing = path.join(tmpPath, "nonexistent", "CLAUDE.md");
    const newManaged = "## Overview\n\nFresh content.\n";
    const result = updateClaudeMd(missing, newManaged);
    expect(result.includes("<!-- wiki-managed: start -->")).toBe(true);
    expect(result.includes("<!-- wiki-managed: end -->")).toBe(true);
    expect(result.includes("Fresh content.")).toBe(true);
  });
});

// ── extract_managed_section tests ────────────────────────────────

describe("TestExtractManagedSection", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_extract_managed_section", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const content = fs.readFileSync(file, { encoding: "utf-8" });
    const section = extractManagedSection(content);
    expect(section).not.toBeNull();
    expect(section?.includes("Old generated overview.")).toBe(true);
  });

  it("test_extract_no_markers", () => {
    const file = makeClaudeMdWithoutMarkers(tmpPath);
    const content = fs.readFileSync(file, { encoding: "utf-8" });
    expect(extractManagedSection(content)).toBeNull();
  });
});

// ── list_submodules tests ─────────────────────────────────────────

describe("TestListSubmodules", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_list_submodules", () => {
    const root = makeProjectWithSubmodules(tmpPath);
    const result = listSubmodules(root);
    expect(result).toHaveLength(2);
    const names = [...result].sort();
    expect(names.includes("services/auth")).toBe(true);
    expect(names.includes("services/billing")).toBe(true);
  });

  it("test_list_submodules_empty", () => {
    const root = makeProjectRoot(tmpPath);
    const result = listSubmodules(root);
    expect(result).toEqual([]);
  });
});

// ── listWikiPagesForRouting tests ─────────────────────────────────

describe("listWikiPagesForRouting", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("wiki-pages-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns empty array when wiki dir does not exist", () => {
    const result = listWikiPagesForRouting(path.join(tmpPath, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("returns empty array when wiki dir exists but is empty", () => {
    fs.mkdirSync(path.join(tmpPath, "wiki"), { recursive: true });
    const result = listWikiPagesForRouting(tmpPath);
    expect(result).toEqual([]);
  });

  it("reads atlas_facet from frontmatter", () => {
    makeWikiPage(tmpPath, "overview.md", ["title: Overview", "atlas_facet: overview"]);
    const pages = listWikiPagesForRouting(tmpPath);
    expect(pages).toHaveLength(1);
    expect(pages[0].facet).toBe("overview");
    expect(pages[0].title).toBe("Overview");
  });

  it("returns null facet and title for pages without frontmatter", () => {
    fs.mkdirSync(path.join(tmpPath, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "wiki", "plain.md"), "No frontmatter.\n");
    const pages = listWikiPagesForRouting(tmpPath);
    expect(pages).toHaveLength(1);
    expect(pages[0].facet).toBeNull();
    expect(pages[0].title).toBeNull();
  });

  it("excludes pages under _archive and other _ dirs", () => {
    makeWikiPage(tmpPath, "overview.md", ["atlas_facet: overview"]);
    // Create an archived page — should be excluded
    const archiveDir = path.join(tmpPath, "wiki", "_archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, "old.md"), "---\natlas_facet: architecture\n---\nOld.\n");
    const pages = listWikiPagesForRouting(tmpPath);
    // Only overview.md; old.md under _archive is excluded
    expect(pages.every((p) => !p.relPath.includes("_archive"))).toBe(true);
    expect(pages.some((p) => p.facet === "overview")).toBe(true);
    expect(pages.some((p) => p.facet === "architecture")).toBe(false);
  });

  it("returns relative paths from wikiRoot (POSIX separators)", () => {
    makeWikiPage(tmpPath, "auth/architecture.md", ["atlas_facet: architecture"]);
    const pages = listWikiPagesForRouting(tmpPath);
    expect(pages[0].relPath).toBe("wiki/auth/architecture.md");
    expect(pages[0].relPath).not.toContain("\\");
  });

  it("returns pages sorted lexicographically by relPath", () => {
    makeWikiPage(tmpPath, "z_page.md", ["atlas_facet: operations"]);
    makeWikiPage(tmpPath, "a_page.md", ["atlas_facet: overview"]);
    const pages = listWikiPagesForRouting(tmpPath);
    expect(pages[0].relPath.endsWith("a_page.md")).toBe(true);
    expect(pages[1].relPath.endsWith("z_page.md")).toBe(true);
  });
});

// ── buildRoutingTable tests ───────────────────────────────────────

describe("buildRoutingTable", () => {
  it("returns empty array when no pages have a recognized facet", () => {
    const pages = [
      { relPath: "wiki/notes.md", facet: null, title: null },
      { relPath: "wiki/custom.md", facet: "unknown-facet", title: null },
    ];
    expect(buildRoutingTable(pages, "docs/wiki")).toEqual([]);
  });

  it("emits a row for each recognized atlas_facet", () => {
    const pages = [
      { relPath: "wiki/overview.md", facet: "overview", title: "Overview" },
      { relPath: "wiki/api.md", facet: "api", title: "API" },
      { relPath: "wiki/config.md", facet: "configuration", title: "Config" },
    ];
    const rows = buildRoutingTable(pages, "docs/wiki");
    expect(rows).toHaveLength(3);
    const intents = rows.map((r) => r.intent);
    expect(intents.some((i) => i.includes("fits together"))).toBe(true);
    expect(intents.some((i) => i.includes("API"))).toBe(true);
    expect(intents.some((i) => i.includes("configuration"))).toBe(true);
  });

  it("prefixes pagePath with wikiRelDir", () => {
    const pages = [{ relPath: "wiki/overview.md", facet: "overview", title: null }];
    const rows = buildRoutingTable(pages, "docs/my-wiki");
    expect(rows[0].pagePath).toBe("docs/my-wiki/wiki/overview.md");
  });

  it("handles empty wikiRelDir (wikiRoot === projectRoot)", () => {
    const pages = [{ relPath: "wiki/overview.md", facet: "overview", title: null }];
    const rows = buildRoutingTable(pages, "");
    expect(rows[0].pagePath).toBe("wiki/overview.md");
  });

  it("per-topic facet: emits one row per topic for a recurring facet", () => {
    const pages = [
      { relPath: "wiki/auth/architecture.md", facet: "architecture", title: "Auth Arch" },
      { relPath: "wiki/billing/architecture.md", facet: "architecture", title: "Billing Arch" },
    ];
    const rows = buildRoutingTable(pages, "docs/wiki");
    // Both topics get their own architecture row — neither is dropped.
    const archRows = rows.filter((r) => r.intent.includes("architecture"));
    expect(archRows).toHaveLength(2);
    // Topic woven into the intent so the agent can route to the right page.
    expect(archRows.some((r) => r.intent.includes("auth"))).toBe(true);
    expect(archRows.some((r) => r.intent.includes("billing"))).toBe(true);
    // Both pages are referenced.
    expect(rows.map((r) => r.pagePath)).toEqual([
      "docs/wiki/wiki/auth/architecture.md",
      "docs/wiki/wiki/billing/architecture.md",
    ]);
  });

  it("per-topic rows for the same facet are sorted deterministically by page path", () => {
    const pages = [
      { relPath: "wiki/billing/architecture.md", facet: "architecture", title: null },
      { relPath: "wiki/auth/architecture.md", facet: "architecture", title: null },
    ];
    const rows = buildRoutingTable(pages, "");
    expect(rows[0].pagePath).toBe("wiki/auth/architecture.md");
    expect(rows[1].pagePath).toBe("wiki/billing/architecture.md");
  });

  it("global facet: collapses duplicate pages to one row (lexicographically-smallest wins, order-independent)", () => {
    // Even with unsorted input, the smallest relPath wins deterministically.
    const pages = [
      { relPath: "wiki/b/overview.md", facet: "overview", title: null },
      { relPath: "wiki/a/overview.md", facet: "overview", title: null },
    ];
    const rows = buildRoutingTable(pages, "docs/wiki");
    expect(rows).toHaveLength(1);
    expect(rows[0].pagePath).toBe("docs/wiki/wiki/a/overview.md");
  });

  it("per-topic facet with no topic dir: drops the {topic} placeholder cleanly", () => {
    const pages = [{ relPath: "wiki/architecture.md", facet: "architecture", title: null }];
    const rows = buildRoutingTable(pages, "");
    expect(rows[0].intent).not.toContain("{topic}");
    expect(rows[0].intent).toContain("architecture");
  });

  it("rows appear in a stable, logical order (per-topic facets before global facets)", () => {
    const pages = [
      { relPath: "wiki/troubleshooting.md", facet: "troubleshooting", title: null },
      { relPath: "wiki/auth/architecture.md", facet: "architecture", title: null },
      { relPath: "wiki/overview.md", facet: "overview", title: null },
    ];
    const rows = buildRoutingTable(pages, "");
    // architecture (per-topic) comes first, then global facets in their order.
    expect(rows[0].intent).toContain("architecture");
    expect(rows[1].intent).toContain("fits together");
    expect(rows[2].intent).toContain("diagnose");
  });
});

// ── Behavioral directive tests ────────────────────────────────────

describe("generateClaudeMd — behavioral directive", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("behavioral-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("generated block contains a strong behavioral directive", () => {
    const root = makeProjectRoot(tmpPath);
    const result = generateClaudeMd(root, path.join(root, "wiki"));
    // Must contain imperative language telling the agent to consult the wiki
    expect(result).toContain("consult the wiki");
    expect(result).toContain("source of truth");
  });

  it("routing table is absent when no atlas pages exist", () => {
    const root = makeProjectRoot(tmpPath);
    const result = generateClaudeMd(root, path.join(root, "wiki"));
    // No routing table rows when no atlas_facet pages
    expect(result).not.toContain("| If you need to");
  });

  it("no-routing-rows body still carries the directive + a navigation pointer (not near-empty)", () => {
    // Wiki with an index but NO faceted pages — the contract requires the
    // body never collapse to a bare directive (codex P2: preserve body guidance).
    // makeProjectRoot writes the index at <root>/wiki/index.md, so wikiRoot = root.
    const root = makeProjectRoot(tmpPath);
    const result = generateClaudeMd(root, root);

    // 1. Behavioral directive always present.
    expect(result).toContain("consult the wiki");
    expect(result).toContain("source of truth");
    // 2. No routing table (no faceted pages).
    expect(result).not.toContain("| If you need to");
    // 3. Fallback navigation guidance is present: a pointer to the wiki dir
    //    and a nudge to run atlas, plus the index link.
    expect(result).toContain("No topic routing table yet");
    expect(result).toContain("/doc-wiki:atlas");
    expect(result).toContain("[Full wiki index]");

    // The managed body has substantive content beyond the directive line:
    // count non-empty content lines inside the markers.
    const inner = result
      .replace(MARKER_START + "\n", "")
      .replace("\n" + MARKER_END + "\n", "");
    const contentLines = inner
      .split("\n")
      .filter((l) => l.trim() !== "" && l.trim() !== "## Wiki");
    // directive + pointer + index link → at least 3 substantive lines.
    expect(contentLines.length).toBeGreaterThanOrEqual(3);
  });

  it("no-routing-rows AND no index file still emits directive + pointer (worst case)", () => {
    // Fresh wiki dir, no index.md, no faceted pages.
    const root = tmpPath;
    fs.mkdirSync(path.join(root, "wiki"), { recursive: true });
    const result = generateClaudeMd(root, root);
    expect(result).toContain("consult the wiki");
    expect(result).toContain("No topic routing table yet");
    expect(result).toContain("/doc-wiki:atlas");
    // No index link (file doesn't exist) — but the body is NOT just the directive.
    expect(result).not.toContain("[Full wiki index]");
  });

  it("routing table appears when atlas pages exist", () => {
    const root = makeProjectWithAtlasPages(tmpPath);
    const result = generateClaudeMd(root, root);
    expect(result).toContain("| If you need to");
    expect(result).toContain("overview.md");
    expect(result).toContain("configuration.md");
    expect(result).toContain("troubleshooting.md");
  });

  it("routing table only references pages that actually exist on disk", () => {
    const root = makeProjectWithAtlasPages(tmpPath);
    const result = generateClaudeMd(root, root);
    // Extract all markdown links from the managed block
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const linkedPaths: string[] = [];
    while ((match = linkRe.exec(result)) !== null) {
      const href = match[2];
      if (href.endsWith(".md")) {
        linkedPaths.push(href);
      }
    }
    // Every linked page — INCLUDING the index — must exist on disk (no phantom links)
    for (const relPath of linkedPaths) {
      const absPath = path.join(root, relPath);
      expect(fs.existsSync(absPath), `Expected ${absPath} to exist`).toBe(true);
    }
    expect(linkedPaths.length).toBeGreaterThan(0);
  });

  it("routing table does NOT include pages that are not on disk", () => {
    // Create a project with only one atlas page
    const root = makeProjectRoot(tmpPath);
    makeWikiPage(root, "overview.md", ["atlas_facet: overview"]);
    const result = generateClaudeMd(root, root);
    // architecture page was never created — must not appear
    expect(result).not.toContain("architecture.md");
    // overview was created — must appear
    expect(result).toContain("overview.md");
  });

  it("generated block includes a link to the full wiki index", () => {
    const root = makeProjectRoot(tmpPath);
    // wikiRoot is the parent dir; the index lives at <wikiRoot>/wiki/index.md.
    const result = generateClaudeMd(root, root);
    expect(result).toContain("index.md");
  });

  it("idempotent re-splice: applying the same managed content twice yields identical output", () => {
    const root = makeProjectWithAtlasPages(tmpPath);
    const claudeMd = path.join(root, "CLAUDE.md");
    fs.writeFileSync(claudeMd, "# My Project\n\nHand-written intro.\n");

    const fullGenerated = generateClaudeMd(root, root);
    const inner = fullGenerated
      .replace(MARKER_START + "\n", "")
      .replace("\n" + MARKER_END + "\n", "");

    const first = updateClaudeMd(claudeMd, inner);
    fs.writeFileSync(claudeMd, first);
    const second = updateClaudeMd(claudeMd, inner);
    expect(first).toBe(second);
  });

  it("user content outside markers is preserved on update", () => {
    const root = makeProjectWithAtlasPages(tmpPath);
    const claudeMd = path.join(root, "CLAUDE.md");
    const userContent = "# My Project\n\nHand-written intro that must survive.\n";
    fs.writeFileSync(
      claudeMd,
      userContent +
        "\n" + MARKER_START + "\nold managed\n" + MARKER_END + "\n" +
        "\n## Custom Section\n\nKeep this too.\n",
    );

    const fullGenerated = generateClaudeMd(root, root);
    const inner = fullGenerated
      .replace(MARKER_START + "\n", "")
      .replace("\n" + MARKER_END + "\n", "");

    const result = updateClaudeMd(claudeMd, inner);
    expect(result).toContain("Hand-written intro that must survive.");
    expect(result).toContain("Keep this too.");
    expect(result).toContain("consult the wiki");
    expect(result).not.toContain("old managed");
  });

  it("two topics sharing the architecture facet produce two routing rows, both on disk", () => {
    const root = makeProjectRoot(tmpPath);
    makeWikiPage(root, "auth/architecture.md", [
      "title: Auth Architecture",
      "atlas_facet: architecture",
    ]);
    makeWikiPage(root, "billing/architecture.md", [
      "title: Billing Architecture",
      "atlas_facet: architecture",
    ]);
    const result = generateClaudeMd(root, root);

    // Two distinct architecture rows, disambiguated by topic.
    expect(result).toContain("auth subsystem architecture");
    expect(result).toContain("billing subsystem architecture");

    // Every linked .md page resolves on disk (phantom-link invariant).
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const linked: string[] = [];
    while ((match = linkRe.exec(result)) !== null) {
      if (match[1].endsWith(".md")) linked.push(match[1]);
    }
    expect(linked).toContain("wiki/auth/architecture.md");
    expect(linked).toContain("wiki/billing/architecture.md");
    for (const rel of linked) {
      expect(fs.existsSync(path.join(root, rel)), `Expected ${rel} on disk`).toBe(true);
    }
  });

  it("submodule CLAUDE.md: routing-table and index links resolve from the submodule dir", () => {
    // Project layout: wiki under docs/app-wiki, submodule at services/auth.
    const root = tmpPath;
    const wikiRoot = path.join(root, "docs", "app-wiki");
    fs.mkdirSync(path.join(wikiRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, "wiki", "index.md"), "# Index\n");
    makeWikiPage(wikiRoot, "auth/architecture.md", [
      "title: Auth Architecture",
      "atlas_facet: architecture",
    ]);
    makeWikiPage(wikiRoot, "overview.md", ["atlas_facet: overview"]);
    const submoduleDir = path.join(root, "services", "auth");
    fs.mkdirSync(submoduleDir, { recursive: true });

    const result = generateClaudeMd(root, wikiRoot, "services/auth");

    // Links must climb out of services/auth/ before descending into docs/.
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const linked: string[] = [];
    while ((match = linkRe.exec(result)) !== null) {
      const href = match[1];
      if (href.endsWith(".md") && !href.endsWith("CLAUDE.md")) linked.push(href);
    }
    expect(linked.length).toBeGreaterThan(0);
    // Resolve each link relative to the submodule directory — it must exist.
    for (const rel of linked) {
      expect(rel.startsWith("../../"), `Expected ${rel} to be submodule-relative`).toBe(true);
      const resolved = path.resolve(submoduleDir, rel);
      expect(fs.existsSync(resolved), `Expected ${resolved} to exist`).toBe(true);
    }
    // The same links would NOT resolve from the project root (proves the fix).
    const archLink = linked.find((l) => l.includes("architecture.md"))!;
    expect(fs.existsSync(path.resolve(root, archLink))).toBe(false);
  });
});

// ── CLI tests ─────────────────────────────────────────────────────

describe("TestClaudeMdGenCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_project_root", () => {
    const root = makeProjectRoot(tmpPath);
    const { stdout, status } = runCli([
      "--project-root",
      root,
      "--wiki-root",
      path.join(root, "wiki"),
    ]);
    expect(status).toBe(0);
    expect(stdout.includes("<!-- wiki-managed: start -->")).toBe(true);
  });

  it("test_cli_update", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const projectRoot = path.dirname(file);
    const wikiDir = path.join(projectRoot, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "index.md"), "# Wiki Index\n");

    const { status } = runCli([
      "--project-root",
      projectRoot,
      "--wiki-root",
      wikiDir,
      "--update",
      file,
    ]);
    expect(status).toBe(0);
    const updated = fs.readFileSync(file, { encoding: "utf-8" });
    expect(updated.includes("Custom intro that should be preserved.")).toBe(true);
    expect(updated.includes("<!-- wiki-managed: start -->")).toBe(true);
  });
});

// ======================================================================
// G-CLAUDE-MD-MARKER: balanced-marker validation
// ======================================================================

describe("marker validation (G-CLAUDE-MD-MARKER)", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("marker-corrupt-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("start marker without end marker throws MarkerCorruptError", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `# Project\n\n${MARKER_START}\ndangling\n`,
      "utf-8",
    );
    expect(() => updateClaudeMd(file, "new content")).toThrow(
      MarkerCorruptError,
    );
    // File is not mutated.
    const after = fs.readFileSync(file, "utf-8");
    expect(after).toContain("dangling");
    expect(after).not.toContain("new content");
  });

  it("end marker without start marker throws MarkerCorruptError", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `# Project\n\n${MARKER_END}\ntrailing\n`,
      "utf-8",
    );
    expect(() => updateClaudeMd(file, "new content")).toThrow(
      MarkerCorruptError,
    );
  });

  it("duplicate start markers throws MarkerCorruptError", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `${MARKER_START}\nfirst\n${MARKER_END}\n\n${MARKER_START}\nsecond\n${MARKER_END}\n`,
      "utf-8",
    );
    let err: unknown;
    try {
      updateClaudeMd(file, "new");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MarkerCorruptError);
    const mce = err as MarkerCorruptError;
    expect(mce.error_code).toBe("MARKER_CORRUPT");
    expect(mce.starts).toBe(2);
    expect(mce.ends).toBe(2);
  });

  it("clean file (no markers) appends without error", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(file, "# Project\n\nUser prose.\n", "utf-8");
    const result = updateClaudeMd(file, "managed body");
    expect(result).toContain("User prose.");
    expect(result).toContain(MARKER_START);
    expect(result).toContain("managed body");
    expect(result).toContain(MARKER_END);
  });

  it("balanced markers (1 + 1) replaces managed section", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `${MARKER_START}\nold body\n${MARKER_END}\n\n## User\nkeep me\n`,
      "utf-8",
    );
    const result = updateClaudeMd(file, "new body");
    expect(result).toContain("new body");
    expect(result).not.toContain("old body");
    expect(result).toContain("keep me");
  });

  it("CLI emits MARKER_CORRUPT JSON and exits 1 on corrupted markers", () => {
    const projectRoot = makeProjectRoot(tmpPath);
    const file = path.join(projectRoot, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `# Project\n\n${MARKER_START}\nunclosed\n`,
      "utf-8",
    );
    const { stdout, status } = runCli([
      "--project-root",
      projectRoot,
      "--wiki-root",
      path.join(projectRoot, "wiki"),
      "--update",
      file,
    ]);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      status: string;
      error_code: string;
      details: { starts: number; ends: number };
    };
    expect(parsed.status).toBe("error");
    expect(parsed.error_code).toBe("MARKER_CORRUPT");
    expect(parsed.details.starts).toBe(1);
    expect(parsed.details.ends).toBe(0);
    // File remains unchanged
    const after = fs.readFileSync(file, "utf-8");
    expect(after).toContain("unclosed");
  });
});

describe("CLI: --check flag", () => {
  it("computes the would-be content and emits JSON without writing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-md-"));
    const project = path.join(tmp, "project");
    const wiki = path.join(project, "docs", "test-wiki");
    fs.mkdirSync(wiki, { recursive: true });
    fs.writeFileSync(path.join(project, "package.json"), '{"name": "t"}');
    const target = path.join(project, "CLAUDE.md");
    const original = `# Hello\n\n${MARKER_START}\nold\n${MARKER_END}\n`;
    fs.writeFileSync(target, original);

    const { stdout, status } = runCli([
      "--project-root",
      project,
      "--wiki-root",
      wiki,
      "--update",
      target,
      "--check",
    ]);

    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.status).toBe("would-update");
    expect(out.target).toBe(target);
    expect(typeof out.would_write).toBe("string");
    // File on disk is unchanged
    expect(fs.readFileSync(target, "utf-8")).toBe(original);
  });
});
