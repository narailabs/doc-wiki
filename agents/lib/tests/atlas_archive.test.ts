/**
 * Tests for atlas_archive.ts — sweep action.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import { sweep, type SweepOptions } from "../atlas_archive.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Write a wiki page with frontmatter. */
function writePage(
  dir: string,
  relPath: string,
  fm: Record<string, unknown>,
  body = "page body\n",
): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const content = `---\n${yaml.dump(fm)}---\n${body}`;
  fs.writeFileSync(abs, content, "utf-8");
}

/** Read and parse frontmatter from a file. */
function readFrontmatter(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.startsWith("---\n")) throw new Error("no frontmatter");
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) throw new Error("no closing ---");
  const parsed = yaml.load(raw.slice(4, end));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("frontmatter is not a dict");
  }
  return parsed as Record<string, unknown>;
}

/** Build default sweep options for the given tmp dirs. */
function makeOpts(
  wikiRoot: string,
  repoRoot: string,
  overrides: Partial<SweepOptions> = {},
): SweepOptions {
  return {
    wikiRoot,
    repoRoot,
    autonomy: "autonomous",
    runId: "test-run-001",
    ...overrides,
  };
}

// ── Fixture: single orphan atlas page ─────────────────────────────────────────

function setupOrphanFixture(wikiRoot: string, repoRoot: string): void {
  // No src/billing/ in repoRoot → page is orphaned
  writePage(wikiRoot, "wiki/billing/architecture.md", {
    atlas_facet: "architecture",
    sources: ["src/billing/"],
    title: "Billing Architecture",
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("sweep — happy path", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-sweep-");
    repoRoot = makeTmpPath("archive-repo-");
    setupOrphanFixture(wikiRoot, repoRoot);
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("moves orphan atlas page and stamps frontmatter", async () => {
    const result = await sweep(makeOpts(wikiRoot, repoRoot));

    expect(result.archived).toHaveLength(1);
    expect(result.errors).toHaveLength(0);

    const livePath = path.join(wikiRoot, "wiki/billing/architecture.md");
    const archPath = path.join(wikiRoot, "wiki/_archive/billing/architecture.md");

    expect(fs.existsSync(livePath)).toBe(false);
    expect(fs.existsSync(archPath)).toBe(true);

    const fm = readFrontmatter(archPath);
    expect(fm["status"]).toBe("deprecated");
    expect(typeof fm["archived_at"]).toBe("string");
    expect((fm["archived_at"] as string)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof fm["archive_reason"]).toBe("string");
    expect((fm["archive_reason"] as string)).toContain("src/billing/");
    expect(fm["archived_from"]).toBe("wiki/billing/architecture.md");
  });
});

// ── Tests: partial removal classifier ─────────────────────────────────────────

describe("sweep — partial removal classifier", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-partial-");
    repoRoot = makeTmpPath("archive-partial-repo-");
    // 1 of 3 sources missing: src/billing/ is absent, but src/payments/ and
    // src/invoices/ exist on disk.
    writePage(wikiRoot, "wiki/billing/architecture.md", {
      atlas_facet: "architecture",
      sources: ["src/billing/", "src/payments/", "src/invoices/"],
      title: "Billing",
    });
    fs.mkdirSync(path.join(repoRoot, "src/payments"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "src/invoices"), { recursive: true });
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("does not archive candidates with threshold 1.0 (default)", async () => {
    const result = await sweep(makeOpts(wikiRoot, repoRoot, { autonomy: "autonomous" }));

    expect(result.archived).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.ratio).toBeCloseTo(0.333, 2);
  });

  it("archives at custom threshold 0.3 when ratio exceeds it", async () => {
    const result = await sweep(
      makeOpts(wikiRoot, repoRoot, { autonomy: "autonomous", partialThreshold: 0.3 }),
    );

    expect(result.archived).toHaveLength(1);
    expect(result.candidates).toHaveLength(0);
  });
});

// ── Tests: autonomy gates ──────────────────────────────────────────────────────

describe("sweep — autonomy gates", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-autonomy-");
    repoRoot = makeTmpPath("archive-autonomy-repo-");
    setupOrphanFixture(wikiRoot, repoRoot);
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("conservative autonomy reports orphans without archiving", async () => {
    const result = await sweep(makeOpts(wikiRoot, repoRoot, { autonomy: "conservative" }));

    expect(result.archived).toHaveLength(0);
    expect(result.pendingConfirmation).toHaveLength(0);
    // Live page must still exist
    expect(fs.existsSync(path.join(wikiRoot, "wiki/billing/architecture.md"))).toBe(true);
  });

  it("balanced autonomy populates pendingConfirmation without archiving", async () => {
    const result = await sweep(makeOpts(wikiRoot, repoRoot, { autonomy: "balanced" }));

    expect(result.archived).toHaveLength(0);
    expect(result.pendingConfirmation).toHaveLength(1);
    expect(result.pendingConfirmation[0]!.page).toBe("wiki/billing/architecture.md");
    expect(fs.existsSync(path.join(wikiRoot, "wiki/billing/architecture.md"))).toBe(true);
  });

  it("dry-run produces preview without filesystem changes", async () => {
    const result = await sweep(makeOpts(wikiRoot, repoRoot, { dryRun: true }));

    // Reports as would-archive
    expect(result.archived).toHaveLength(1);
    // But the file was NOT moved
    expect(fs.existsSync(path.join(wikiRoot, "wiki/billing/architecture.md"))).toBe(true);
    expect(fs.existsSync(path.join(wikiRoot, "wiki/_archive/billing/architecture.md"))).toBe(false);
  });

  it("'auto' autonomy is treated the same as 'autonomous'", async () => {
    const result = await sweep(makeOpts(wikiRoot, repoRoot, { autonomy: "auto" }));
    expect(result.archived).toHaveLength(1);
  });
});

// ── Tests: idempotence ─────────────────────────────────────────────────────────

describe("sweep — idempotence", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-idem-");
    repoRoot = makeTmpPath("archive-idem-repo-");
    setupOrphanFixture(wikiRoot, repoRoot);
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("second sweep on already-archived page is a no-op", async () => {
    await sweep(makeOpts(wikiRoot, repoRoot));
    const result2 = await sweep(makeOpts(wikiRoot, repoRoot));

    expect(result2.archived).toHaveLength(0);
    expect(result2.errors).toHaveLength(0);
  });
});

// ── Tests: history journal ─────────────────────────────────────────────────────

describe("sweep — history journal", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-hist-");
    repoRoot = makeTmpPath("archive-hist-repo-");
    setupOrphanFixture(wikiRoot, repoRoot);
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("appends one event per archive to _archive_history.jsonl", async () => {
    await sweep(makeOpts(wikiRoot, repoRoot));

    const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
    expect(fs.existsSync(journalPath)).toBe(true);
    const lines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]!);
    expect(event.from).toBe("wiki/billing/architecture.md");
    expect(event.to).toBe("wiki/_archive/billing/architecture.md");
    expect(event.atlas_run_id).toBe("test-run-001");
    expect(typeof event.ts).toBe("string");
  });

  it("journal accumulates events across multiple sweeps on different pages", async () => {
    // Add a second orphan page
    writePage(wikiRoot, "wiki/payments/overview.md", {
      atlas_facet: "overview",
      sources: ["src/payments/"],
      title: "Payments",
    });

    await sweep(makeOpts(wikiRoot, repoRoot));

    const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
    const lines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

// ── Tests: rebuildArchiveIndex ─────────────────────────────────────────────────

describe("sweep — archive index rebuild", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-idx-");
    repoRoot = makeTmpPath("archive-idx-repo-");
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("produces grouped, sorted index after sweep", async () => {
    setupOrphanFixture(wikiRoot, repoRoot);
    await sweep(makeOpts(wikiRoot, repoRoot));

    const idxPath = path.join(wikiRoot, "wiki/_archive/index.md");
    expect(fs.existsSync(idxPath)).toBe(true);
    const idx = fs.readFileSync(idxPath, "utf-8");

    expect(idx).toMatch(/# Archived Pages/);
    expect(idx).toMatch(/\/doc-wiki:unarchive/);
    expect(idx).toMatch(/billing\/architecture\.md/);
    // Date group header (year-month)
    expect(idx).toMatch(/## \d{4}-\d{2}/);
  });
});

// ── Tests: applyArchive failure is caught (Issue 2) ───────────────────────────

describe("sweep — applyArchive failure is caught", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-err-");
    repoRoot = makeTmpPath("archive-err-repo-");
  });

  afterEach(() => {
    // Restore permissions so cleanup can delete everything
    const archiveParent = path.join(wikiRoot, "wiki", "_archive");
    if (fs.existsSync(archiveParent)) {
      try { fs.chmodSync(archiveParent, 0o755); } catch { /* ignore */ }
    }
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("catches applyArchive failure, adds to errors[], leaves other pages in archived[]", async () => {
    // Page A: will fail (archive dir made read-only)
    writePage(wikiRoot, "wiki/billing/architecture.md", {
      atlas_facet: "architecture",
      sources: ["src/billing/"],
      title: "Billing Architecture",
    });
    // Page B: should succeed
    writePage(wikiRoot, "wiki/payments/overview.md", {
      atlas_facet: "overview",
      sources: ["src/payments/"],
      title: "Payments",
    });

    // Pre-create the _archive dir with a billing/ subdir that is read-only so
    // renameSync into it will fail for billing/architecture.md only.
    const billingArchiveDir = path.join(wikiRoot, "wiki", "_archive", "billing");
    fs.mkdirSync(billingArchiveDir, { recursive: true });
    fs.chmodSync(billingArchiveDir, 0o444);

    const result = await sweep(makeOpts(wikiRoot, repoRoot));

    // The failing page ends up in errors[], not archived[]
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.page).toBe("wiki/billing/architecture.md");

    // The passing page is still archived
    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]!.from).toBe("wiki/payments/overview.md");

    // History file written for the successfully archived page
    const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
    expect(fs.existsSync(journalPath)).toBe(true);
    const lines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).from).toBe("wiki/payments/overview.md");
  });
});

// ── Tests: partial-threshold reason string (Issue 3) ──────────────────────────

describe("sweep — partial-threshold archive_reason accuracy", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-reason-");
    repoRoot = makeTmpPath("archive-reason-repo-");
    // 1 of 3 sources missing
    writePage(wikiRoot, "wiki/billing/architecture.md", {
      atlas_facet: "architecture",
      sources: ["src/billing/", "src/payments/", "src/invoices/"],
      title: "Billing",
    });
    fs.mkdirSync(path.join(repoRoot, "src/payments"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "src/invoices"), { recursive: true });
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("archive_reason contains missing/total counts for partial-threshold archive", async () => {
    const result = await sweep(
      makeOpts(wikiRoot, repoRoot, { autonomy: "autonomous", partialThreshold: 0.3 }),
    );

    expect(result.archived).toHaveLength(1);

    const archPath = path.join(wikiRoot, "wiki/_archive/billing/architecture.md");
    const fm = readFrontmatter(archPath);
    const reason = fm["archive_reason"] as string;

    // Must say "1 of 3" not "all sources removed"
    expect(reason).toMatch(/1 of 3/);
    expect(reason).not.toMatch(/^all sources removed/);
    expect(reason).toContain("src/billing/");

    // ArchiveEvent reason should also reflect the counts
    expect(result.archived[0]!.reason).toMatch(/1 of 3/);
  });

  it("full-orphan archive_reason still says 'all sources removed'", async () => {
    // Replace fixture: all 3 sources missing
    writePage(wikiRoot, "wiki/billing/architecture.md", {
      atlas_facet: "architecture",
      sources: ["src/billing/", "src/payments/", "src/invoices/"],
      title: "Billing",
    });
    // Remove the dirs so all sources are missing
    fs.rmdirSync(path.join(repoRoot, "src/payments"));
    fs.rmdirSync(path.join(repoRoot, "src/invoices"));

    const result = await sweep(makeOpts(wikiRoot, repoRoot));

    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]!.reason).toMatch(/^all sources removed/);

    const archPath = path.join(wikiRoot, "wiki/_archive/billing/architecture.md");
    const fm = readFrontmatter(archPath);
    expect((fm["archive_reason"] as string)).toMatch(/^all sources removed/);
  });
});

// ── Tests: non-atlas pages are skipped ────────────────────────────────────────

describe("sweep — non-atlas pages skipped", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("archive-skip-");
    repoRoot = makeTmpPath("archive-skip-repo-");
    // Page WITHOUT atlas_facet frontmatter
    writePage(wikiRoot, "wiki/misc/notes.md", {
      title: "Random notes",
      sources: ["src/old/"],
    });
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("does not archive pages without atlas_facet", async () => {
    const result = await sweep(makeOpts(wikiRoot, repoRoot));
    expect(result.archived).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
    expect(fs.existsSync(path.join(wikiRoot, "wiki/misc/notes.md"))).toBe(true);
  });
});
