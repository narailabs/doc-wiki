/**
 * Tests for atlas_archive.ts — sweep action + unarchive action.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import {
  sweep,
  unarchive,
  rewriteInboundLinks,
  rewriteInboundLinksForUnarchive,
  type SweepOptions,
  type UnarchiveOptions,
  type ArchiveEvent,
  type UnarchiveEvent,
  type RewriteArchiveLinksOptions,
  type RewriteUnarchiveLinksOptions,
} from "../atlas_archive.js";
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
    expect(event.op).toBe("archive");
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

// ── Unarchive tests ────────────────────────────────────────────────────────────

/** Write a page that looks as if sweep archived it. */
function writeArchivedPage(
  wikiRoot: string,
  relPath: string, // e.g. "wiki/_archive/billing/architecture.md"
  extraFm: Record<string, unknown> = {},
  body = "page body\n",
): void {
  const abs = path.join(wikiRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fm: Record<string, unknown> = {
    atlas_facet: "architecture",
    status: "deprecated",
    archived_at: "2026-01-15",
    archive_reason: "all sources removed (src/billing/)",
    archived_from: relPath.replace("wiki/_archive/", "wiki/"),
    ...extraFm,
  };
  const content = `---\n${yaml.dump(fm)}---\n${body}`;
  fs.writeFileSync(abs, content, "utf-8");
}

describe("unarchive — slug resolution", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("unarchive-slug-");
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("resolves a unique substring slug to the full archived path", async () => {
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
    const r = await unarchive({
      wikiRoot,
      pageOrSlug: "architecture",
      inboundLinks: "rewrite",
    });
    expect(r.from).toBe("wiki/_archive/billing/architecture.md");
  });

  it("resolves an exact relative path directly", async () => {
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
    const r = await unarchive({
      wikiRoot,
      pageOrSlug: "wiki/_archive/billing/architecture.md",
      inboundLinks: "rewrite",
    });
    expect(r.from).toBe("wiki/_archive/billing/architecture.md");
  });

  it("throws on ambiguous slug", async () => {
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
    writeArchivedPage(wikiRoot, "wiki/_archive/payments/architecture.md", {
      archived_from: "wiki/payments/architecture.md",
    });
    await expect(
      unarchive({ wikiRoot, pageOrSlug: "architecture", inboundLinks: "rewrite" }),
    ).rejects.toThrow(/ambiguous/i);
  });

  it("throws on no-match slug", async () => {
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
    await expect(
      unarchive({ wikiRoot, pageOrSlug: "nonexistent", inboundLinks: "rewrite" }),
    ).rejects.toThrow(/no archived page/i);
  });
});

describe("unarchive — happy path", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("unarchive-happy-");
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("restores file, strips deprecation frontmatter, preserves other fields", async () => {
    const result = await unarchive({
      wikiRoot,
      pageOrSlug: "wiki/_archive/billing/architecture.md",
      inboundLinks: "rewrite",
    });

    expect(fs.existsSync(path.join(wikiRoot, result.to))).toBe(true);
    expect(fs.existsSync(path.join(wikiRoot, result.from))).toBe(false);

    const raw = fs.readFileSync(path.join(wikiRoot, result.to), "utf-8");
    const end = raw.indexOf("\n---\n", 4);
    const fm = yaml.load(raw.slice(4, end)) as Record<string, unknown>;

    expect(fm["status"]).toBeUndefined();
    expect(fm["archived_at"]).toBeUndefined();
    expect(fm["archive_reason"]).toBeUndefined();
    expect(fm["archived_from"]).toBeUndefined();
    expect(fm["atlas_facet"]).toBe("architecture"); // preserved
  });

  it("appends an unarchive event to _archive_history.jsonl", async () => {
    await unarchive({
      wikiRoot,
      pageOrSlug: "wiki/_archive/billing/architecture.md",
      inboundLinks: "rewrite",
    });

    const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
    expect(fs.existsSync(journalPath)).toBe(true);
    const lines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const last = JSON.parse(lines.at(-1)!);
    expect(last.op).toBe("unarchive");
    expect(last.from).toBe("wiki/_archive/billing/architecture.md");
  });

  it("returns linksReverted as a number", async () => {
    const result = await unarchive({
      wikiRoot,
      pageOrSlug: "wiki/_archive/billing/architecture.md",
      inboundLinks: "rewrite",
    });
    expect(typeof result.linksReverted).toBe("number");
  });

  it("stripArchiveFrontmatter: no frontmatter block when only deprecation keys remain", async () => {
    // Write an archived page whose ONLY frontmatter keys are the four
    // deprecation fields (no atlas_facet or other preserved keys).
    const archPath = path.join(wikiRoot, "wiki/_archive/billing/only-deprecated.md");
    fs.mkdirSync(path.dirname(archPath), { recursive: true });
    fs.writeFileSync(
      archPath,
      `---\nstatus: deprecated\narchived_at: "2026-01-01"\narchive_reason: test\narchived_from: wiki/billing/only-deprecated.md\n---\nbody text\n`,
      "utf-8",
    );

    await unarchive({
      wikiRoot,
      pageOrSlug: "wiki/_archive/billing/only-deprecated.md",
      inboundLinks: "leave",
    });

    const restored = fs.readFileSync(
      path.join(wikiRoot, "wiki/billing/only-deprecated.md"),
      "utf-8",
    );
    // Must NOT start with "---" (no frontmatter block at all)
    expect(restored.startsWith("---")).toBe(false);
    expect(restored).toBe("body text\n");
  });
});

describe("unarchive — collision", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("unarchive-collision-");
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
    // Occupant at the target path
    writePage(wikiRoot, "wiki/billing/architecture.md", { title: "live copy" });
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("aborts when target path is already occupied", async () => {
    await expect(
      unarchive({
        wikiRoot,
        pageOrSlug: "wiki/_archive/billing/architecture.md",
        inboundLinks: "rewrite",
      }),
    ).rejects.toThrow(/already exists/i);

    // Both files still on disk
    expect(
      fs.existsSync(path.join(wikiRoot, "wiki/_archive/billing/architecture.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(wikiRoot, "wiki/billing/architecture.md")),
    ).toBe(true);
  });
});

describe("unarchive — --target override", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("unarchive-target-");
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("honors --target override to restore to a different path", async () => {
    const r = await unarchive({
      wikiRoot,
      pageOrSlug: "wiki/_archive/billing/architecture.md",
      target: "wiki/billing-v2/architecture.md",
      inboundLinks: "rewrite",
    });
    expect(r.to).toBe("wiki/billing-v2/architecture.md");
    expect(fs.existsSync(path.join(wikiRoot, "wiki/billing-v2/architecture.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(wikiRoot, "wiki/_archive/billing/architecture.md")),
    ).toBe(false);
    // archived_from path ("wiki/billing/architecture.md") must NOT have been created
    expect(fs.existsSync(path.join(wikiRoot, "wiki/billing/architecture.md"))).toBe(false);
  });
});

// ── Helpers for link-rewrite tests ───────────────────────────────────────────

function makeBillingEvent(ts = "2026-01-15T00:00:00.000Z"): ArchiveEvent {
  return {
    ts,
    op: "archive",
    atlas_run_id: "run-001",
    from: "wiki/billing/architecture.md",
    to: "wiki/_archive/billing/architecture.md",
    reason: "all sources removed",
    missing_sources: ["src/billing/"],
  };
}

function makeUnarchiveBillingEvent(ts = "2026-02-01T00:00:00.000Z"): UnarchiveEvent {
  return {
    ts,
    op: "unarchive",
    from: "wiki/_archive/billing/architecture.md",
    to: "wiki/billing/architecture.md",
  };
}

// ── rewriteInboundLinks tests ─────────────────────────────────────────────────

describe("rewriteInboundLinks — rewrite mode", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-rewrite-");
    // Source page: wiki/auth/jwt.md contains a link to the page being archived
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      `---\ntitle: JWT\n---\nSee [Billing flow](../billing/architecture.md) for details.\n`,
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("rewrite mode: live link to archived page gets (archived) label and _archive/ path", async () => {
    const opts: RewriteArchiveLinksOptions = {
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "rewrite",
    };
    await rewriteInboundLinks(opts);
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain("[Billing flow (archived)](../_archive/billing/architecture.md)");
  });

  it("drop mode: link is stripped, label becomes plain text", async () => {
    const opts: RewriteArchiveLinksOptions = {
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "drop",
    };
    await rewriteInboundLinks(opts);
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain("Billing flow");
    expect(body).not.toMatch(/\[Billing flow\]/);
  });

  it("leave mode: no changes to inbound links", async () => {
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    const before = fs.readFileSync(jwtPath, "utf-8");
    const opts: RewriteArchiveLinksOptions = {
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "leave",
    };
    await rewriteInboundLinks(opts);
    const after = fs.readFileSync(jwtPath, "utf-8");
    expect(after).toBe(before);
  });

  it("rewrite is idempotent: re-run on already-rewritten page is a no-op", async () => {
    const opts: RewriteArchiveLinksOptions = {
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "rewrite",
    };
    await rewriteInboundLinks(opts);
    const first = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    await rewriteInboundLinks(opts);
    const second = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(second).toBe(first);
  });
});

describe("rewriteInboundLinksForUnarchive", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-unarchive-");
    // Pre-state: link is already rewritten to (archived) form
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      `---\ntitle: JWT\n---\nSee [Billing flow (archived)](../_archive/billing/architecture.md) for details.\n`,
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("unarchive reverts (archived) label and _archive/ path", async () => {
    const opts: RewriteUnarchiveLinksOptions = {
      wikiRoot,
      event: makeUnarchiveBillingEvent(),
    };
    await rewriteInboundLinksForUnarchive(opts);
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain("[Billing flow](../billing/architecture.md)");
  });
});

describe("rewriteInboundLinks — code-block skip", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-codeblock-");
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    // Link inside a fenced code block — must NOT be rewritten
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\n" +
        "Normal text.\n" +
        "```\n" +
        "See [Billing flow](../billing/architecture.md) for details.\n" +
        "```\n" +
        "After code block.\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("does not rewrite links inside fenced code blocks", async () => {
    await rewriteInboundLinks({
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "rewrite",
    });
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    // Original link inside code block must be unchanged
    expect(body).toContain("[Billing flow](../billing/architecture.md)");
    // The (archived) form must NOT appear
    expect(body).not.toContain("(archived)");
  });
});

describe("rewriteInboundLinks — multiple events", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-multi-");
    // Page links to both billing and payments pages
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\n" +
        "See [Billing flow](../billing/architecture.md) and [Payments overview](../payments/overview.md).\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("rewrites all matching links when multiple events are provided", async () => {
    const billingEvent = makeBillingEvent();
    const paymentsEvent: ArchiveEvent = {
      ts: "2026-01-15T00:00:00.000Z",
      op: "archive",
      atlas_run_id: "run-001",
      from: "wiki/payments/overview.md",
      to: "wiki/_archive/payments/overview.md",
      reason: "all sources removed",
      missing_sources: ["src/payments/"],
    };
    await rewriteInboundLinks({
      wikiRoot,
      events: [billingEvent, paymentsEvent],
      mode: "rewrite",
    });
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain("[Billing flow (archived)](../_archive/billing/architecture.md)");
    expect(body).toContain("[Payments overview (archived)](../_archive/payments/overview.md)");
  });
});

describe("rewriteInboundLinks — no-op page", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-noop-");
    // Page that links to something unrelated — not the archived page
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\nSee [Other page](../other/overview.md).\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("does not modify pages with no links to any archived target", async () => {
    const before = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    await rewriteInboundLinks({
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "rewrite",
    });
    const after = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(after).toBe(before);
  });
});

describe("rewriteInboundLinks — duplicate links in single page", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-dup-");
    // wiki/auth/jwt.md has TWO identical links to the same archived target
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\n" +
        "See [Billing flow](../billing/architecture.md) and again [Billing flow](../billing/architecture.md).\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("rewrite rewrites duplicate links in a single page", async () => {
    const opts: RewriteArchiveLinksOptions = {
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "rewrite",
    };
    const count = await rewriteInboundLinks(opts);
    expect(count).toBe(2);
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    // Both occurrences should be rewritten
    const matches = body.match(/\[Billing flow \(archived\)\]\(\.\.\/\_archive\/billing\/architecture\.md\)/g);
    expect(matches).toHaveLength(2);
    // Original form must not remain
    expect(body).not.toContain("[Billing flow](../billing/architecture.md)");
  });
});

describe("rewriteInboundLinksForUnarchive — _archive/ path guard", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-inverse-guard-");
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("does not revert a hand-authored (archived) label whose path is not under _archive/", async () => {
    // A page with a hand-authored link: label ends with (archived) but path
    // does NOT go through _archive/ — inverse pass must leave it alone.
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    const originalContent =
      "---\ntitle: JWT\n---\n" +
      "See [Billing flow (archived)](../billing/architecture.md) for details.\n";
    fs.writeFileSync(jwtPath, originalContent, "utf-8");

    await rewriteInboundLinksForUnarchive({
      wikiRoot,
      event: makeUnarchiveBillingEvent(),
    });

    const after = fs.readFileSync(jwtPath, "utf-8");
    expect(after).toBe(originalContent);
  });
});

describe("rewriteInboundLinks — deeply nested target", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-deep-");
    // Page at wiki/auth/jwt.md links to wiki/auth/oauth/spec.md
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\nSee [OAuth spec](oauth/spec.md) for details.\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("rewrites a link to a deeply-nested archived page", async () => {
    const deepEvent: ArchiveEvent = {
      ts: "2026-01-15T00:00:00.000Z",
      op: "archive",
      atlas_run_id: "run-001",
      from: "wiki/auth/oauth/spec.md",
      to: "wiki/_archive/auth/oauth/spec.md",
      reason: "all sources removed",
      missing_sources: ["src/oauth/"],
    };
    await rewriteInboundLinks({
      wikiRoot,
      events: [deepEvent],
      mode: "rewrite",
    });
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain("[OAuth spec (archived)](../_archive/auth/oauth/spec.md)");
  });
});

// ── Integration: sweep calls rewriteInboundLinks ──────────────────────────────

describe("sweep — calls rewriteInboundLinks when inboundLinks=rewrite", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("sweep-links-");
    repoRoot = makeTmpPath("sweep-links-repo-");
    // The orphan page
    writePage(wikiRoot, "wiki/billing/architecture.md", {
      atlas_facet: "architecture",
      sources: ["src/billing/"],
      title: "Billing Architecture",
    });
    // A page that links to the orphan
    const refPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(
      refPath,
      "---\ntitle: JWT\n---\nSee [Billing flow](../billing/architecture.md).\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("sweep rewrites inbound links after archiving", async () => {
    await sweep(makeOpts(wikiRoot, repoRoot, { inboundLinks: "rewrite" }));
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain("[Billing flow (archived)](../_archive/billing/architecture.md)");
  });
});

// ── Tests: Comment 1 — URL fragment/query preservation ───────────────────────

describe("rewriteInboundLinks — preserves URL fragment on archive rewrite", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-fragment-fwd-");
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\nSee [Billing flow](../billing/architecture.md#flow) for details.\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("preserves #fragment in link target after archive rewrite", async () => {
    await rewriteInboundLinks({
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "rewrite",
    });
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain(
      "[Billing flow (archived)](../_archive/billing/architecture.md#flow)",
    );
  });

  it("preserves ?query in link target after archive rewrite", async () => {
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\nSee [Billing flow](../billing/architecture.md?v=1) for details.\n",
      "utf-8",
    );
    await rewriteInboundLinks({
      wikiRoot,
      events: [makeBillingEvent()],
      mode: "rewrite",
    });
    const body = fs.readFileSync(jwtPath, "utf-8");
    expect(body).toContain(
      "[Billing flow (archived)](../_archive/billing/architecture.md?v=1)",
    );
  });
});

describe("rewriteInboundLinksForUnarchive — preserves URL fragment on unarchive revert", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("link-fragment-inv-");
    const jwtPath = path.join(wikiRoot, "wiki/auth/jwt.md");
    fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
    fs.writeFileSync(
      jwtPath,
      "---\ntitle: JWT\n---\nSee [Billing flow (archived)](../_archive/billing/architecture.md#flow) for details.\n",
      "utf-8",
    );
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("preserves #fragment in link target after unarchive revert", async () => {
    await rewriteInboundLinksForUnarchive({
      wikiRoot,
      event: makeUnarchiveBillingEvent(),
    });
    const body = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
    expect(body).toContain("[Billing flow](../billing/architecture.md#flow)");
  });
});

// ── Tests: Comment 2 — path containment on unarchive ─────────────────────────

describe("unarchive — path containment guard", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("unarchive-containment-");
    writeArchivedPage(wikiRoot, "wiki/_archive/billing/architecture.md");
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
  });

  it("throws path containment error when --target escapes wiki root", async () => {
    await expect(
      unarchive({
        wikiRoot,
        pageOrSlug: "wiki/_archive/billing/architecture.md",
        target: "../escape.md",
        inboundLinks: "leave",
      }),
    ).rejects.toThrow(/path containment/i);
  });

  it("throws path containment error when archived_from escapes wiki root", async () => {
    // Write an archived page whose archived_from frontmatter points outside root
    const archPath = path.join(wikiRoot, "wiki/_archive/billing/architecture.md");
    const fm = {
      atlas_facet: "architecture",
      status: "deprecated",
      archived_at: "2026-01-15",
      archive_reason: "all sources removed (src/billing/)",
      archived_from: "../../etc/foo.md",
    };
    fs.writeFileSync(
      archPath,
      `---\n${yaml.dump(fm)}---\npage body\n`,
      "utf-8",
    );

    await expect(
      unarchive({
        wikiRoot,
        pageOrSlug: "wiki/_archive/billing/architecture.md",
        inboundLinks: "leave",
      }),
    ).rejects.toThrow(/path containment/i);
  });
});

describe("unarchive — rebuildArchiveIndex skips unarchived events", () => {
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    wikiRoot = makeTmpPath("unarchive-idx-");
    repoRoot = makeTmpPath("unarchive-idx-repo-");
    setupOrphanFixture(wikiRoot, repoRoot);
  });

  afterEach(() => {
    cleanupTmpPath(wikiRoot);
    cleanupTmpPath(repoRoot);
  });

  it("index does not list a page after it has been unarchived", async () => {
    // Sweep to archive the page
    await sweep(makeOpts(wikiRoot, repoRoot));

    // Verify archived
    const archPath = path.join(wikiRoot, "wiki/_archive/billing/architecture.md");
    expect(fs.existsSync(archPath)).toBe(true);

    // Unarchive it (collision: live path is gone so no conflict)
    await unarchive({
      wikiRoot,
      pageOrSlug: "wiki/_archive/billing/architecture.md",
      inboundLinks: "leave",
    });

    const idxPath = path.join(wikiRoot, "wiki/_archive/index.md");
    const idx = fs.readFileSync(idxPath, "utf-8");

    // The page should no longer appear as an active archive entry
    // (lines with "billing/architecture.md" are for the archive listing;
    //  after unarchive it should either be absent or not linked as archived)
    const archiveListLines = idx
      .split("\n")
      .filter((l) => l.startsWith("- [") && l.includes("billing/architecture.md"));
    expect(archiveListLines).toHaveLength(0);
  });
});
