/**
 * Tests for atlas_validate.ts — the (page-hash, source-hash) cache backing
 * `/doc-wiki:atlas` Phase 5's semantic validation. Structural-check
 * invocation of `lint_checks.js` is exercised end-to-end when the
 * orchestrator runs; here we focus on the deterministic cache layer.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import * as yaml from "js-yaml";

import {
  computeValidationKey,
  checkValidationCache,
  storeValidationCache,
  clearValidationCache,
  findDuplicateDiagrams,
  sourceExistence,
  VALIDATE_CACHE_SUBDIR,
  VALIDATE_CACHE_VERSION,
} from "../atlas_validate.js";
import { makeTmpPath, cleanupTmpPath, makeInitializedWiki } from "./fixtures.js";

describe("computeValidationKey", () => {
  it("is deterministic for identical inputs", () => {
    const a = computeValidationKey("p1", "s1");
    const b = computeValidationKey("p1", "s1");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when either half changes", () => {
    const base = computeValidationKey("p1", "s1");
    expect(computeValidationKey("p2", "s1")).not.toBe(base);
    expect(computeValidationKey("p1", "s2")).not.toBe(base);
  });

  it("does not collide on key reordering (uses delimiter)", () => {
    // Without a delimiter, ("ab","cd") and ("a","bcd") would both hash "abcd".
    const a = computeValidationKey("ab", "cd");
    const b = computeValidationKey("a", "bcd");
    expect(a).not.toBe(b);
  });
});

describe("validation cache CRUD", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-validate-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null on miss", () => {
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("round-trips a structured result", () => {
    const result = { ok: true, divergences: ["foo", "bar"] };
    storeValidationCache(tmpPath, "p1", "s1", result);
    const got = checkValidationCache(tmpPath, "p1", "s1");
    expect(got).not.toBeNull();
    expect(got?.result).toEqual(result);
    expect(got?.pageHash).toBe("p1");
    expect(got?.sourceHash).toBe("s1");
    expect(got?.cache_version).toBe(VALIDATE_CACHE_VERSION);
    expect(got?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns null on cache_version mismatch", () => {
    storeValidationCache(tmpPath, "p1", "s1", "ok");
    const key = computeValidationKey("p1", "s1");
    const file = path.join(tmpPath, VALIDATE_CACHE_SUBDIR, `${key}.json`);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    raw["cache_version"] = "0";
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("returns null on hash-half mismatch in the on-disk record", () => {
    storeValidationCache(tmpPath, "p1", "s1", "ok");
    const key = computeValidationKey("p1", "s1");
    const file = path.join(tmpPath, VALIDATE_CACHE_SUBDIR, `${key}.json`);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    raw["pageHash"] = "evil";
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("clearValidationCache removes every .json entry and counts them", () => {
    storeValidationCache(tmpPath, "p1", "s1", "a");
    storeValidationCache(tmpPath, "p2", "s2", "b");
    storeValidationCache(tmpPath, "p3", "s3", "c");
    expect(clearValidationCache(tmpPath)).toBe(3);
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("clearValidationCache returns 0 when the cache dir does not exist", () => {
    expect(clearValidationCache(tmpPath)).toBe(0);
  });

  it("cache writes go to the dedicated subdir, not the parent .wiki-cache", () => {
    storeValidationCache(tmpPath, "p1", "s1", "ok");
    const dir = path.join(tmpPath, VALIDATE_CACHE_SUBDIR);
    expect(fs.existsSync(dir)).toBe(true);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
  });

  it("overwrites an existing entry on re-store", () => {
    storeValidationCache(tmpPath, "p1", "s1", "first");
    storeValidationCache(tmpPath, "p1", "s1", "second");
    expect(checkValidationCache(tmpPath, "p1", "s1")?.result).toBe("second");
  });
});

// ── findDuplicateDiagrams (cross-doc ownership) ─────────────────────

function writeArchPage(
  wikiRoot: string,
  relPath: string,
  sources: string[],
  diagramTitles: string[],
): void {
  const full = path.join(wikiRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fm = yaml.dump({
    title: "page",
    type: "concept",
    atlas_facet: "architecture",
    atlas_run_id: "r1",
    sources,
  });
  const diagrams = diagramTitles
    .map(
      (t) =>
        `<!-- wiki-mermaid: ${t} start -->\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\`\n<!-- wiki-mermaid: ${t} end -->`,
    )
    .join("\n\n");
  fs.writeFileSync(full, "---\n" + fm + "---\n\nbody\n\n" + diagrams + "\n");
}

describe("findDuplicateDiagrams", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-validate-cross-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns empty when no architecture pages exist", () => {
    expect(findDuplicateDiagrams(wikiRoot)).toEqual([]);
  });

  it("does NOT flag pages that share only sources OR only diagram titles", () => {
    // Same source, different diagram titles → no finding.
    writeArchPage(wikiRoot, "wiki/auth/architecture.md", ["src/auth/"], ["Auth Topology"]);
    writeArchPage(wikiRoot, "wiki/billing/architecture.md", ["src/auth/"], ["Billing Topology"]);
    expect(findDuplicateDiagrams(wikiRoot)).toEqual([]);
    // Same title, different sources → no finding.
    writeArchPage(wikiRoot, "wiki/users/architecture.md", ["src/users/"], ["Service Topology"]);
    writeArchPage(wikiRoot, "wiki/orders/architecture.md", ["src/orders/"], ["Service Topology"]);
    expect(findDuplicateDiagrams(wikiRoot)).toEqual([]);
  });

  it("flags pages that share both ≥1 source AND ≥1 diagram title", () => {
    writeArchPage(
      wikiRoot,
      "wiki/auth/architecture.md",
      ["src/shared/", "src/auth/"],
      ["Service Topology", "Login Flow"],
    );
    writeArchPage(
      wikiRoot,
      "wiki/users/architecture.md",
      ["src/shared/", "src/users/"],
      ["Service Topology", "User Profile"],
    );
    const findings = findDuplicateDiagrams(wikiRoot);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.pages).toEqual([
      "wiki/auth/architecture.md",
      "wiki/users/architecture.md",
    ]);
    expect(findings[0]!.sharedSources).toEqual(["src/shared/"]);
    expect(findings[0]!.sharedDiagramTitles).toEqual(["service topology"]);
  });

  it("matches diagram titles case-insensitively", () => {
    writeArchPage(wikiRoot, "wiki/a/architecture.md", ["src/x/"], ["Service Topology"]);
    writeArchPage(wikiRoot, "wiki/b/architecture.md", ["src/x/"], ["service topology"]);
    const findings = findDuplicateDiagrams(wikiRoot);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.sharedDiagramTitles).toEqual(["service topology"]);
  });

  it("only considers architecture-facet pages — ignores data-model, api, etc.", () => {
    // Two pages with shared source + title but one is api facet → not flagged.
    writeArchPage(wikiRoot, "wiki/auth/architecture.md", ["src/auth/"], ["Login Flow"]);
    const apiPage = path.join(wikiRoot, "wiki", "auth", "api.md");
    fs.writeFileSync(
      apiPage,
      "---\n" +
        yaml.dump({
          atlas_facet: "api",
          atlas_run_id: "r1",
          sources: ["src/auth/"],
        }) +
        "---\n\n<!-- wiki-mermaid: Login Flow start -->\n\nbody\n\n<!-- wiki-mermaid: Login Flow end -->\n",
    );
    expect(findDuplicateDiagrams(wikiRoot)).toEqual([]);
  });

  it("flags a triangle as three separate pairs", () => {
    writeArchPage(wikiRoot, "wiki/a/architecture.md", ["src/shared/"], ["Topology"]);
    writeArchPage(wikiRoot, "wiki/b/architecture.md", ["src/shared/"], ["Topology"]);
    writeArchPage(wikiRoot, "wiki/c/architecture.md", ["src/shared/"], ["Topology"]);
    const findings = findDuplicateDiagrams(wikiRoot);
    expect(findings).toHaveLength(3); // pairs: (a,b), (a,c), (b,c)
  });
});

// ── sourceExistence ───────────────────────────────────────────────────

function writeWikiPage(
  wikiRoot: string,
  relPath: string,
  sources: string[],
): string {
  const full = path.join(wikiRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const fm = yaml.dump({ title: "test", type: "concept", sources });
  fs.writeFileSync(full, "---\n" + fm + "---\n\nbody\n");
  return full;
}

describe("sourceExistence", () => {
  let tmpPath: string;
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("source-existence-");
    wikiRoot = makeInitializedWiki(tmpPath);
    // Use wikiRoot as repoRoot so we can create source files inside it.
    repoRoot = wikiRoot;
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns live for URL-only pages (no local paths)", () => {
    const page = writeWikiPage(wikiRoot, "wiki/remote.md", [
      "https://example.com",
      "jira://PROJ-123",
    ]);
    const r = sourceExistence({ wikiRoot, repoRoot, page });
    expect(r.status).toBe("live");
    expect(r.total).toBe(0);
    expect(r.missing).toEqual([]);
    expect(r.ratio).toBe(0);
  });

  it("returns orphan when all local paths are missing", () => {
    const page = writeWikiPage(wikiRoot, "wiki/gone.md", [
      "src/deleted/foo.ts",
      "src/deleted/bar.ts",
    ]);
    const r = sourceExistence({ wikiRoot, repoRoot, page });
    expect(r.status).toBe("orphan");
    expect(r.missing).toEqual(["src/deleted/foo.ts", "src/deleted/bar.ts"]);
    expect(r.ratio).toBe(1.0);
    expect(r.total).toBe(2);
  });

  it("returns candidate when ratio meets threshold", () => {
    // Create 2 of the 3 source files; 1 is missing → ratio = 1/3 ≈ 0.333
    fs.mkdirSync(path.join(repoRoot, "src", "present"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src", "present", "a.ts"), "");
    fs.writeFileSync(path.join(repoRoot, "src", "present", "b.ts"), "");
    const page = writeWikiPage(wikiRoot, "wiki/partial.md", [
      "src/present/a.ts",
      "src/present/b.ts",
      "src/missing/c.ts",
    ]);
    const r = sourceExistence({ wikiRoot, repoRoot, page, threshold: 0.3 });
    expect(r.status).toBe("candidate");
    expect(r.missing).toEqual(["src/missing/c.ts"]);
    expect(r.ratio).toBeCloseTo(0.333, 2);
  });

  it("returns live when ratio is below threshold (default threshold=1.0)", () => {
    // 1 of 5 sources missing → ratio = 0.2; default threshold is 1.0 → live
    fs.mkdirSync(path.join(repoRoot, "src", "live"), { recursive: true });
    for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      fs.writeFileSync(path.join(repoRoot, "src", "live", name), "");
    }
    const page = writeWikiPage(wikiRoot, "wiki/mostly-live.md", [
      "src/live/a.ts",
      "src/live/b.ts",
      "src/live/c.ts",
      "src/live/d.ts",
      "src/live/missing.ts",
    ]);
    const r = sourceExistence({ wikiRoot, repoRoot, page });
    expect(r.status).toBe("live");
    expect(r.ratio).toBeCloseTo(0.2, 5);
  });

  it("ignores remote schemes and counts only local paths", () => {
    // 2 URLs + 1 missing local path → total=1, missing=1, ratio=1.0 → orphan
    const page = writeWikiPage(wikiRoot, "wiki/mixed.md", [
      "https://docs.example.com/api",
      "github://org/repo",
      "src/vanished/module.ts",
    ]);
    const r = sourceExistence({ wikiRoot, repoRoot, page });
    expect(r.status).toBe("orphan");
    expect(r.total).toBe(1);
    expect(r.missing).toEqual(["src/vanished/module.ts"]);
    expect(r.ratio).toBe(1.0);
  });

  it("returns live when page has no sources frontmatter field", () => {
    const full = path.join(wikiRoot, "wiki", "no-sources.md");
    fs.writeFileSync(full, "---\ntitle: No Sources\n---\n\nbody\n");
    const r = sourceExistence({ wikiRoot, repoRoot, page: full });
    expect(r.status).toBe("live");
    expect(r.total).toBe(0);
    expect(r.ratio).toBe(0);
  });

  it("handles absolute source paths correctly", () => {
    // An absolute path that exists should not count as missing.
    const absFile = path.join(repoRoot, "src", "abs.ts");
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
    fs.writeFileSync(absFile, "");
    const page = writeWikiPage(wikiRoot, "wiki/abspage.md", [absFile]);
    const r = sourceExistence({ wikiRoot, repoRoot, page });
    expect(r.status).toBe("live");
    expect(r.total).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it("all remote schemes are ignored: confluence, notion, aws, gcp", () => {
    const page = writeWikiPage(wikiRoot, "wiki/all-remote.md", [
      "confluence://space/page",
      "notion://workspace/db",
      "aws://s3/bucket/key",
      "gcp://storage/bucket/object",
    ]);
    const r = sourceExistence({ wikiRoot, repoRoot, page });
    expect(r.status).toBe("live");
    expect(r.total).toBe(0);
  });

  it("throws when the page file does not exist", () => {
    expect(() =>
      sourceExistence({ wikiRoot, repoRoot, page: "/tmp/does-not-exist-atlas-validate.md" }),
    ).toThrow();
  });
});
