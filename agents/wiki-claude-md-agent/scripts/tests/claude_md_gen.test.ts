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
  generateManagedBlock,
  updateClaudeMd,
  updateReferenceBlock,
  extractManagedSection,
  listSubmodules,
  listWikiPagesForRouting,
  buildRoutingTable,
  resolveScaffoldRoot,
  MarkerCorruptError,
  MARKER_START,
  MARKER_END,
  REFERENCE_MARKER_START,
  REFERENCE_MARKER_END,
  type WikiPageInfo,
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

  it("submodule backlink sits under a Parent Project heading (eval contract)", () => {
    // evals/evals.json eval 1 expectation 3: the backlink to root CLAUDE.md
    // must appear "under a Parent Project heading".
    const root = makeProjectWithSubmodules(tmpPath);
    const result = generateClaudeMd(root, root, "services/auth");
    expect(result).toContain("## Parent Project");
    // The heading appears immediately before the backlink line.
    const headingIdx = result.indexOf("## Parent Project");
    const linkIdx = result.indexOf("[Root CLAUDE.md](");
    expect(headingIdx).toBeGreaterThanOrEqual(0);
    expect(linkIdx).toBeGreaterThan(headingIdx);
    // The backlink target is a relative climb to the root CLAUDE.md.
    expect(result).toContain("[Root CLAUDE.md](../../CLAUDE.md)");
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

  it("accepts the content-dir layout (wikiRoot points directly at the content dir)", () => {
    // Pages live at <tmp>/wiki/<...>; pass the content dir <tmp>/wiki itself.
    makeWikiPage(tmpPath, "overview.md", ["atlas_facet: overview"]);
    makeWikiPage(tmpPath, "auth/architecture.md", ["atlas_facet: architecture"]);
    const contentDir = path.join(tmpPath, "wiki");
    const pages = listWikiPagesForRouting(contentDir);
    // relPaths are normalized to the scaffold root, so they keep the wiki/ prefix.
    const rels = pages.map((p) => p.relPath).sort();
    expect(rels).toEqual(["wiki/auth/architecture.md", "wiki/overview.md"]);
    // No path doubles the wiki segment.
    expect(rels.every((r) => !r.includes("wiki/wiki"))).toBe(true);
  });
});

// ── resolveScaffoldRoot tests ─────────────────────────────────────

describe("resolveScaffoldRoot", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("scaffold-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns the input unchanged when it already contains a wiki/ subdir", () => {
    fs.mkdirSync(path.join(tmpPath, "wiki"), { recursive: true });
    expect(resolveScaffoldRoot(tmpPath)).toBe(tmpPath);
  });

  it("climbs to the parent when pointed at the content dir (basename === wiki)", () => {
    const contentDir = path.join(tmpPath, "wiki");
    fs.mkdirSync(contentDir, { recursive: true });
    expect(resolveScaffoldRoot(contentDir)).toBe(tmpPath);
  });

  it("prefers the scaffold check over the basename rule for a genuine wiki/wiki layout", () => {
    // <tmp>/wiki itself contains a wiki/ subdir → it IS a scaffold root.
    const outerWiki = path.join(tmpPath, "wiki");
    fs.mkdirSync(path.join(outerWiki, "wiki"), { recursive: true });
    expect(resolveScaffoldRoot(outerWiki)).toBe(outerWiki);
  });

  it("falls back to the input as-is for a fresh path with neither marker", () => {
    const fresh = path.join(tmpPath, "brand-new");
    expect(resolveScaffoldRoot(fresh)).toBe(fresh);
  });
});

// ── buildRoutingTable tests ───────────────────────────────────────

/**
 * Construct a WikiPageInfo with sensible defaults so test literals stay
 * concise while satisfying the full interface (incl. crossServicePage).
 */
function pg(
  fields: {
    relPath: string;
    facet?: string | null;
    title?: string | null;
    crossServicePage?: string | null;
  },
): WikiPageInfo {
  return {
    relPath: fields.relPath,
    facet: fields.facet ?? null,
    title: fields.title ?? null,
    crossServicePage: fields.crossServicePage ?? null,
  };
}

describe("buildRoutingTable", () => {
  it("returns empty array when no pages have a recognized facet", () => {
    const pages = [
      pg({ relPath: "wiki/notes.md", facet: null }),
      pg({ relPath: "wiki/custom.md", facet: "unknown-facet" }),
    ];
    expect(buildRoutingTable(pages, "docs/wiki")).toEqual([]);
  });

  it("emits a row for each recognized atlas_facet", () => {
    const pages = [
      pg({ relPath: "wiki/overview.md", facet: "overview", title: "Overview" }),
      pg({ relPath: "wiki/api.md", facet: "api", title: "API" }),
      pg({ relPath: "wiki/config.md", facet: "configuration", title: "Config" }),
    ];
    const rows = buildRoutingTable(pages, "docs/wiki");
    expect(rows).toHaveLength(3);
    const intents = rows.map((r) => r.intent);
    expect(intents.some((i) => i.includes("fits together"))).toBe(true);
    expect(intents.some((i) => i.includes("API"))).toBe(true);
    expect(intents.some((i) => i.includes("configuration"))).toBe(true);
  });

  it("prefixes pagePath with wikiRelDir", () => {
    const pages = [pg({ relPath: "wiki/overview.md", facet: "overview" })];
    const rows = buildRoutingTable(pages, "docs/my-wiki");
    expect(rows[0].pagePath).toBe("docs/my-wiki/wiki/overview.md");
  });

  it("handles empty wikiRelDir (wikiRoot === projectRoot)", () => {
    const pages = [pg({ relPath: "wiki/overview.md", facet: "overview" })];
    const rows = buildRoutingTable(pages, "");
    expect(rows[0].pagePath).toBe("wiki/overview.md");
  });

  it("per-topic facet: emits one row per topic for a recurring facet", () => {
    const pages = [
      pg({ relPath: "wiki/auth/architecture.md", facet: "architecture", title: "Auth Arch" }),
      pg({ relPath: "wiki/billing/architecture.md", facet: "architecture", title: "Billing Arch" }),
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
      pg({ relPath: "wiki/billing/architecture.md", facet: "architecture" }),
      pg({ relPath: "wiki/auth/architecture.md", facet: "architecture" }),
    ];
    const rows = buildRoutingTable(pages, "");
    expect(rows[0].pagePath).toBe("wiki/auth/architecture.md");
    expect(rows[1].pagePath).toBe("wiki/billing/architecture.md");
  });

  it("global facet: collapses duplicate pages to one row (lexicographically-smallest wins, order-independent)", () => {
    // Even with unsorted input, the smallest relPath wins deterministically.
    const pages = [
      pg({ relPath: "wiki/b/overview.md", facet: "overview" }),
      pg({ relPath: "wiki/a/overview.md", facet: "overview" }),
    ];
    const rows = buildRoutingTable(pages, "docs/wiki");
    expect(rows).toHaveLength(1);
    expect(rows[0].pagePath).toBe("docs/wiki/wiki/a/overview.md");
  });

  it("per-topic facet with no topic dir: drops the {topic} placeholder cleanly", () => {
    const pages = [pg({ relPath: "wiki/architecture.md", facet: "architecture" })];
    const rows = buildRoutingTable(pages, "");
    expect(rows[0].intent).not.toContain("{topic}");
    expect(rows[0].intent).toContain("architecture");
  });

  it("rows appear in a stable, logical order (per-topic facets before global facets)", () => {
    const pages = [
      pg({ relPath: "wiki/troubleshooting.md", facet: "troubleshooting" }),
      pg({ relPath: "wiki/auth/architecture.md", facet: "architecture" }),
      pg({ relPath: "wiki/overview.md", facet: "overview" }),
    ];
    const rows = buildRoutingTable(pages, "");
    // architecture (per-topic) comes first, then global facets in their order.
    expect(rows[0].intent).toContain("architecture");
    expect(rows[1].intent).toContain("fits together");
    expect(rows[2].intent).toContain("diagnose");
  });

  // ── cross-service page routing (#68) ──────────────────────────────

  it("cross-service pages route to slug-specific intents, not generic architecture", () => {
    // All six carry atlas_facet: architecture + a cross_service_page slug, and
    // sit at the wiki/ top level (no topic dir). They must NOT collapse into
    // duplicate generic "subsystem architecture" rows.
    const slugs = [
      "service-map",
      "service-dependencies",
      "client-registry",
      "queue-registry",
      "database-traces",
      "shared-libraries",
    ];
    // Intentionally shuffled input order to prove ordering is deterministic.
    const pages = [...slugs]
      .reverse()
      .map((slug) =>
        pg({ relPath: `wiki/${slug}.md`, facet: "architecture", crossServicePage: slug }),
      );
    const rows = buildRoutingTable(pages, "docs/wiki");

    // Exactly six rows, in the canonical writer order.
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.pagePath)).toEqual([
      "docs/wiki/wiki/service-map.md",
      "docs/wiki/wiki/service-dependencies.md",
      "docs/wiki/wiki/client-registry.md",
      "docs/wiki/wiki/queue-registry.md",
      "docs/wiki/wiki/database-traces.md",
      "docs/wiki/wiki/shared-libraries.md",
    ]);
    // Each gets its exact slug-specific intent.
    const byPath = new Map(rows.map((r) => [r.pagePath, r.intent]));
    expect(byPath.get("docs/wiki/wiki/service-map.md")).toBe(
      "Understand the overall service topology — how services connect",
    );
    expect(byPath.get("docs/wiki/wiki/service-dependencies.md")).toBe(
      "See which services depend on which",
    );
    expect(byPath.get("docs/wiki/wiki/client-registry.md")).toBe(
      "Find where one service calls another (HTTP/RPC client callsites)",
    );
    expect(byPath.get("docs/wiki/wiki/queue-registry.md")).toBe(
      "Trace async/queue producers and consumers",
    );
    expect(byPath.get("docs/wiki/wiki/database-traces.md")).toBe(
      "See which services read/write which database tables",
    );
    expect(byPath.get("docs/wiki/wiki/shared-libraries.md")).toBe(
      "Find shared libraries used across services",
    );
    // No generic architecture row leaked in.
    expect(rows.some((r) => r.intent.includes("subsystem architecture"))).toBe(false);
  });

  it("cross-service rows coexist with a normal per-topic architecture page", () => {
    const pages = [
      pg({ relPath: "wiki/auth/architecture.md", facet: "architecture" }),
      pg({ relPath: "wiki/service-map.md", facet: "architecture", crossServicePage: "service-map" }),
    ];
    const rows = buildRoutingTable(pages, "");
    // Normal per-topic page routes as before (group 0, rendered first).
    expect(rows[0].intent).toBe("understand the auth subsystem architecture");
    expect(rows[0].pagePath).toBe("wiki/auth/architecture.md");
    // Cross-service page gets its slug intent (group 1, after facets).
    expect(rows[1].intent).toBe(
      "Understand the overall service topology — how services connect",
    );
    expect(rows[1].pagePath).toBe("wiki/service-map.md");
  });

  it("unknown cross_service_page slug falls back to a generic cross-service intent (no crash)", () => {
    const pages = [
      pg({ relPath: "wiki/mesh-traces.md", facet: "architecture", crossServicePage: "mesh-traces" }),
    ];
    const rows = buildRoutingTable(pages, "");
    expect(rows).toHaveLength(1);
    expect(rows[0].intent).toBe("See the cross-service mesh traces view");
    expect(rows[0].pagePath).toBe("wiki/mesh-traces.md");
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

  it("documented content-dir invocation produces correct routing + index links (no wiki/wiki)", () => {
    // Regression for #68: the script's --help / CLI tests pass --wiki-root
    // <project>/wiki (the dir that directly holds index.md + pages). That MUST
    // produce real routing rows, a correct index link, and never wiki/wiki.
    const root = makeProjectWithAtlasPages(tmpPath);
    const contentDir = path.join(root, "wiki");

    const result = generateClaudeMd(root, contentDir);

    // (a) Routing rows reference the real pages at their correct relative paths.
    expect(result).toContain("| If you need to");
    expect(result).toContain("[overview.md](wiki/overview.md)");
    expect(result).toContain("[architecture.md](wiki/auth/architecture.md)");
    expect(result).toContain("[configuration.md](wiki/configuration.md)");
    // (b) Index link points at the real index.
    expect(result).toContain("[Full wiki index](wiki/index.md)");
    // (c) No path doubles the wiki segment anywhere in the block.
    expect(result).not.toContain("wiki/wiki");

    // Every linked .md page resolves on disk (phantom-link invariant).
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(result)) !== null) {
      if (m[1].endsWith(".md")) {
        expect(fs.existsSync(path.join(root, m[1])), `Expected ${m[1]} on disk`).toBe(true);
      }
    }
  });

  it("scaffold-root and content-dir invocations produce identical bodies", () => {
    // Both documented layouts must normalize to the same output.
    const root = makeProjectWithAtlasPages(tmpPath);
    const scaffoldResult = generateClaudeMd(root, root);
    const contentDirResult = generateClaudeMd(root, path.join(root, "wiki"));
    expect(contentDirResult).toBe(scaffoldResult);
  });

  it("end-to-end: cross-service pages get slug-specific rows; per-topic page unaffected (#68)", () => {
    // Fixture: six top-level cross-service pages (atlas_facet: architecture +
    // cross_service_page slug) plus a normal per-topic architecture page.
    const root = tmpPath;
    const wikiDir = path.join(root, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "index.md"), "# Index\n");
    const slugs = [
      "service-map",
      "service-dependencies",
      "client-registry",
      "queue-registry",
      "database-traces",
      "shared-libraries",
    ];
    for (const slug of slugs) {
      makeWikiPage(root, `${slug}.md`, [
        `title: ${slug}`,
        "atlas_facet: architecture",
        "atlas_run_id: 2026-06-11T00-00-00",
        `cross_service_page: ${slug}`,
        "audience: contributor",
        "generated_by: cross_service_pages",
      ]);
    }
    makeWikiPage(root, "auth/architecture.md", [
      "title: Auth Architecture",
      "atlas_facet: architecture",
    ]);

    const result = generateClaudeMd(root, root);

    const expectedIntents: Record<string, string> = {
      "service-map": "Understand the overall service topology — how services connect",
      "service-dependencies": "See which services depend on which",
      "client-registry":
        "Find where one service calls another (HTTP/RPC client callsites)",
      "queue-registry": "Trace async/queue producers and consumers",
      "database-traces": "See which services read/write which database tables",
      "shared-libraries": "Find shared libraries used across services",
    };
    // Each slug-specific intent appears exactly once, linking the real page.
    for (const slug of slugs) {
      const line = `| ${expectedIntents[slug]} | [${slug}.md](wiki/${slug}.md) |`;
      expect(result.split(line).length - 1, `row for ${slug}`).toBe(1);
    }
    // No duplicate generic "subsystem architecture" rows for the six.
    const genericArch = result.split("understand the subsystem architecture").length - 1;
    expect(genericArch).toBe(0);
    // The normal per-topic page still routes as before — exactly once.
    expect(
      result.split(
        "| understand the auth subsystem architecture | [architecture.md](wiki/auth/architecture.md) |",
      ).length - 1,
    ).toBe(1);

    // Every linked .md page resolves on disk (phantom-link invariant).
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(result)) !== null) {
      if (m[1].endsWith(".md")) {
        expect(fs.existsSync(path.join(root, m[1])), `Expected ${m[1]} on disk`).toBe(true);
      }
    }
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

// ── generateManagedBlock tests (Phase 8 root-file block) ──────────

describe("generateManagedBlock", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("managed-block-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  /** Nested-wiki fixture: wiki scaffold at <root>/docs/proj-wiki/. */
  function makeNestedWikiProject(root: string): string {
    const wikiRoot = path.join(root, "docs", "proj-wiki");
    fs.mkdirSync(path.join(wikiRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, "wiki", "index.md"), "# Index\n");
    makeWikiPage(wikiRoot, "auth/architecture.md", [
      "title: Auth Architecture",
      "atlas_facet: architecture",
    ]);
    makeWikiPage(wikiRoot, "overview.md", [
      "title: Overview",
      "atlas_facet: overview",
    ]);
    return wikiRoot;
  }

  it("returns directive + routing rows for a faceted wiki, links relative to projectRoot (sibling wiki/)", () => {
    const root = makeProjectWithAtlasPages(tmpPath);
    const block = generateManagedBlock(root, root);

    // Behavioral directive leads the block.
    expect(block).toContain("consult the wiki");
    expect(block).toContain("source of truth");
    // Routing table with rows for the faceted pages, relative to projectRoot.
    expect(block).toContain("| If you need to");
    expect(block).toContain("[overview.md](wiki/overview.md)");
    expect(block).toContain("[architecture.md](wiki/auth/architecture.md)");
    expect(block).toContain("[configuration.md](wiki/configuration.md)");
    // Documentation-index link.
    expect(block).toContain("[Full wiki index](wiki/index.md)");

    // Every linked .md page resolves on disk FROM THE PROJECT ROOT —
    // root files (CLAUDE.md, AGENTS.md, …) live there.
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    let linked = 0;
    while ((m = linkRe.exec(block)) !== null) {
      if (m[1].endsWith(".md")) {
        linked++;
        expect(fs.existsSync(path.join(root, m[1])), `Expected ${m[1]} on disk`).toBe(true);
      }
    }
    expect(linked).toBeGreaterThan(0);
  });

  it("emits the block BODY only — no wiki-managed markers, no file header", () => {
    const root = makeProjectWithAtlasPages(tmpPath);
    const block = generateManagedBlock(root, root);
    expect(block).not.toContain("wiki-managed");
    expect(block).not.toContain(MARKER_START);
    expect(block).not.toContain(MARKER_END);
    // No file-level (h1) header — the block splices into existing root files.
    expect(block.startsWith("# ")).toBe(false);
  });

  it("nested wiki root (<p>/docs/proj-wiki): links prefixed docs/proj-wiki/, index link correct", () => {
    const root = tmpPath;
    const wikiRoot = makeNestedWikiProject(root);
    const block = generateManagedBlock(root, wikiRoot);

    expect(block).toContain(
      "[architecture.md](docs/proj-wiki/wiki/auth/architecture.md)",
    );
    expect(block).toContain("[overview.md](docs/proj-wiki/wiki/overview.md)");
    expect(block).toContain("[Full wiki index](docs/proj-wiki/wiki/index.md)");
    // No doubled wiki path segment (the scaffold folder itself ends in
    // "-wiki", so match the full doubled segment, not the bare substring).
    expect(block).not.toContain("/wiki/wiki/");

    // Every linked .md page resolves from the project root.
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(block)) !== null) {
      if (m[1].endsWith(".md")) {
        expect(fs.existsSync(path.join(root, m[1])), `Expected ${m[1]} on disk`).toBe(true);
      }
    }
  });

  it("nested wiki root: content-dir layout (<p>/docs/proj-wiki/wiki) produces an identical block (resolveScaffoldRoot reuse)", () => {
    const root = tmpPath;
    const wikiRoot = makeNestedWikiProject(root);
    const scaffoldBlock = generateManagedBlock(root, wikiRoot);
    const contentDirBlock = generateManagedBlock(root, path.join(wikiRoot, "wiki"));
    expect(contentDirBlock).toBe(scaffoldBlock);
  });

  it("no-pages fallback: directive + browse pointer still emitted", () => {
    const root = tmpPath;
    fs.mkdirSync(path.join(root, "wiki"), { recursive: true });
    const block = generateManagedBlock(root, root);
    expect(block).toContain("consult the wiki");
    expect(block).not.toContain("| If you need to");
    expect(block).toContain("No topic routing table yet");
    expect(block).toContain("/doc-wiki:atlas");
  });

  it("shares one implementation with generateClaudeMd — the imperative core is identical", () => {
    // The full-file body for a root CLAUDE.md (no submodule) must contain the
    // managed block verbatim: same directive, same rows, same links.
    const root = makeProjectWithAtlasPages(tmpPath);
    const block = generateManagedBlock(root, root);
    const full = generateClaudeMd(root, root);
    expect(full).toContain(block);
  });

  // ── AI-tool configuration registry line ──────────────────────────

  it("emits the AI-tool configuration registry line when <scaffoldRoot>/ai-dev exists (nested layout)", () => {
    const root = tmpPath;
    const wikiRoot = makeNestedWikiProject(root);
    fs.mkdirSync(path.join(wikiRoot, "ai-dev"), { recursive: true });
    const block = generateManagedBlock(root, wikiRoot);
    expect(block).toContain(
      "AI-tool configuration registry: [docs/proj-wiki/ai-dev/](docs/proj-wiki/ai-dev/)",
    );
    // After the index link — the registry line trails the block.
    expect(block.indexOf("AI-tool configuration registry")).toBeGreaterThan(
      block.indexOf("[Full wiki index]"),
    );
  });

  it("emits the registry line with a bare ai-dev/ path when scaffoldRoot === projectRoot", () => {
    const root = makeProjectWithAtlasPages(tmpPath);
    fs.mkdirSync(path.join(root, "ai-dev"), { recursive: true });
    const block = generateManagedBlock(root, root);
    expect(block).toContain("AI-tool configuration registry: [ai-dev/](ai-dev/)");
  });

  it("omits the registry line when <scaffoldRoot>/ai-dev does not exist", () => {
    const root = tmpPath;
    const wikiRoot = makeNestedWikiProject(root);
    const block = generateManagedBlock(root, wikiRoot);
    expect(block).not.toContain("AI-tool configuration registry");
    expect(block).not.toContain("ai-dev");
  });
});

// ── updateReferenceBlock tests (body-pair skip guard) ─────────────

describe("updateReferenceBlock", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("ref-block-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  const BLOCK_BODY = "## Wiki\n\nDirective.\n\n[Full wiki index](wiki/index.md)\n";

  it("a file carrying the body pair is returned unchanged (skip guard — no duplicate imperative block)", () => {
    // A doc-wiki-generated root CLAUDE.md: body pair already contains the
    // imperative core, so the reference splice must be a no-op.
    const file = path.join(tmpPath, "CLAUDE.md");
    const original =
      "# Project\n\n" +
      `${MARKER_START}\n## Wiki\n\nDirective.\n${MARKER_END}\n`;
    fs.writeFileSync(file, original, "utf-8");

    const result = updateReferenceBlock(file, BLOCK_BODY);
    expect(result.skipped).toBe(true);
    expect(result.content).toBe(original);
    // Crucially: no reference markers were added.
    expect(result.content).not.toContain(REFERENCE_MARKER_START);
  });

  it("a file with reference markers (and no body pair) gets the block spliced; outside content preserved", () => {
    const file = path.join(tmpPath, "AGENTS.md");
    fs.writeFileSync(
      file,
      "# AGENTS\n\nUser intro.\n\n" +
        `${REFERENCE_MARKER_START}\n## Reference\n\nOld passive listing.\n${REFERENCE_MARKER_END}\n`,
      "utf-8",
    );

    const result = updateReferenceBlock(file, BLOCK_BODY);
    expect(result.skipped).toBe(false);
    expect(result.content).toContain("User intro.");
    expect(result.content).toContain("Directive.");
    expect(result.content).not.toContain("Old passive listing.");
    // Marker vocabulary unchanged — same reference pair, updated in place.
    expect(result.content).toContain(REFERENCE_MARKER_START);
    expect(result.content).toContain(REFERENCE_MARKER_END);
  });

  it("a file without any markers gets the block appended wrapped in reference markers", () => {
    const file = path.join(tmpPath, "GEMINI.md");
    fs.writeFileSync(file, "# GEMINI\n\nUser prose.\n", "utf-8");
    const result = updateReferenceBlock(file, BLOCK_BODY);
    expect(result.skipped).toBe(false);
    expect(result.content).toContain("User prose.");
    expect(result.content).toContain(
      `${REFERENCE_MARKER_START}\n${BLOCK_BODY}${REFERENCE_MARKER_END}`,
    );
  });

  it("idempotent: re-applying the same body yields identical content", () => {
    const file = path.join(tmpPath, "AGENTS.md");
    fs.writeFileSync(
      file,
      `# AGENTS\n\n${REFERENCE_MARKER_START}\nold\n${REFERENCE_MARKER_END}\n`,
      "utf-8",
    );
    const first = updateReferenceBlock(file, BLOCK_BODY);
    fs.writeFileSync(file, first.content, "utf-8");
    const second = updateReferenceBlock(file, BLOCK_BODY);
    expect(second.content).toBe(first.content);
  });

  it("unbalanced reference markers throw MarkerCorruptError", () => {
    const file = path.join(tmpPath, "AGENTS.md");
    fs.writeFileSync(
      file,
      `# AGENTS\n\n${REFERENCE_MARKER_START}\ndangling\n`,
      "utf-8",
    );
    expect(() => updateReferenceBlock(file, BLOCK_BODY)).toThrow(
      MarkerCorruptError,
    );
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

describe("CLI: --block flag", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("cli-block-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  /** Recursively list every file under `dir` (sorted) for no-writes assertions. */
  function listAllFiles(dir: string): string[] {
    const out: string[] = [];
    const stack = [dir];
    while (stack.length > 0) {
      const d = stack.pop()!;
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else out.push(full);
      }
    }
    return out.sort();
  }

  it("prints the managed-block body to stdout and writes no files", () => {
    // Nested-wiki layout — the case Phase 8 hits on real repos.
    const root = tmpPath;
    const wikiRoot = path.join(root, "docs", "proj-wiki");
    fs.mkdirSync(path.join(wikiRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, "wiki", "index.md"), "# Index\n");
    makeWikiPage(wikiRoot, "auth/architecture.md", [
      "title: Auth Architecture",
      "atlas_facet: architecture",
    ]);

    const filesBefore = listAllFiles(root);
    const { stdout, status } = runCli([
      "--project-root",
      root,
      "--wiki-root",
      wikiRoot,
      "--block",
    ]);

    expect(status).toBe(0);
    // Block body on stdout: directive + routing row + index link, no markers.
    expect(stdout).toContain("consult the wiki");
    expect(stdout).toContain("| If you need to");
    expect(stdout).toContain(
      "[architecture.md](docs/proj-wiki/wiki/auth/architecture.md)",
    );
    expect(stdout).toContain("[Full wiki index](docs/proj-wiki/wiki/index.md)");
    expect(stdout).not.toContain("wiki-managed");
    // No files written anywhere under the project root.
    expect(listAllFiles(root)).toEqual(filesBefore);
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(false);
  });

  it("--block is documented in --help", () => {
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--block");
  });

  it("--block --update splices the body between the reference markers on disk", () => {
    const root = tmpPath;
    const wikiRoot = path.join(root, "docs", "proj-wiki");
    fs.mkdirSync(path.join(wikiRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, "wiki", "index.md"), "# Index\n");
    makeWikiPage(wikiRoot, "overview.md", ["atlas_facet: overview"]);
    const target = path.join(root, "AGENTS.md");
    fs.writeFileSync(
      target,
      "# AGENTS\n\nUser intro.\n\n" +
        `${REFERENCE_MARKER_START}\n## Reference\n\nOld passive listing.\n${REFERENCE_MARKER_END}\n`,
      "utf-8",
    );

    const { stdout, status } = runCli([
      "--project-root",
      root,
      "--wiki-root",
      wikiRoot,
      "--block",
      "--update",
      target,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("Updated:");
    const after = fs.readFileSync(target, "utf-8");
    expect(after).toContain("User intro.");
    expect(after).toContain("consult the wiki");
    expect(after).toContain("[overview.md](docs/proj-wiki/wiki/overview.md)");
    expect(after).not.toContain("Old passive listing.");
  });

  it("--block --update skips a body-managed file and leaves it untouched", () => {
    const root = tmpPath;
    const wikiRoot = path.join(root, "docs", "proj-wiki");
    fs.mkdirSync(path.join(wikiRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(wikiRoot, "wiki", "index.md"), "# Index\n");
    const target = path.join(root, "CLAUDE.md");
    const original =
      "# Project\n\n" + `${MARKER_START}\n## Wiki\n\nDirective.\n${MARKER_END}\n`;
    fs.writeFileSync(target, original, "utf-8");

    const { stdout, status } = runCli([
      "--project-root",
      root,
      "--wiki-root",
      wikiRoot,
      "--block",
      "--update",
      target,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("Skipped (body-managed)");
    expect(fs.readFileSync(target, "utf-8")).toBe(original);
  });
});
