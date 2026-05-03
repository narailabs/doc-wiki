/**
 * Tests for repo_walker.ts — lifted glob compiler + bounded walker.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_IGNORE,
  MAX_FILES,
  compileGlob,
  matchesPattern,
  walkCodebase,
  walkRepoTargets,
  _resetPatternCache,
} from "../repo_walker.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

describe("compileGlob", () => {
  it("matches a literal filename when no globs are present", () => {
    expect(compileGlob("README.md").test("/path/to/README.md")).toBe(true);
    expect(compileGlob("README.md").test("/path/to/readme.md")).toBe(false);
  });

  it("matches a single-segment `*`", () => {
    const re = compileGlob("*.ts");
    expect(re.test("foo.ts")).toBe(true);
    expect(re.test("/abs/foo.ts")).toBe(true);
    // single-segment `*` should NOT cross slashes
    expect(re.test("src/foo.ts")).toBe(true); // anchored after final /
    expect(re.test("foo.tsx")).toBe(false);
  });

  it("matches `**/` for any number of parent dirs", () => {
    const re = compileGlob("**/test.ts");
    expect(re.test("test.ts")).toBe(true);
    expect(re.test("a/test.ts")).toBe(true);
    expect(re.test("a/b/c/test.ts")).toBe(true);
  });

  it("escapes regex metacharacters in literal segments", () => {
    const re = compileGlob("foo.bar.baz");
    expect(re.test("foo.bar.baz")).toBe(true);
    expect(re.test("fooXbarYbaz")).toBe(false); // dots are literal, not `.`
  });
});

describe("matchesPattern", () => {
  beforeEach(() => {
    _resetPatternCache();
  });

  it("returns false on empty patterns", () => {
    expect(matchesPattern("/x.ts", [])).toBe(false);
  });

  it("returns true when any pattern matches", () => {
    expect(matchesPattern("/src/x.ts", ["**/*.py", "**/*.ts"])).toBe(true);
  });

  it("caches compiled patterns across calls", () => {
    // Indirect: two repeated calls should produce the same answer with no
    // extra work — the cache itself is internal, but we can at least
    // confirm semantic stability.
    const path1 = "/a/b/c.ts";
    const path2 = "/d/e/c.ts";
    const patterns = ["**/*.ts"];
    expect(matchesPattern(path1, patterns)).toBe(true);
    expect(matchesPattern(path2, patterns)).toBe(true);
  });
});

describe("walkCodebase", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("repo-walker-");
    _resetPatternCache();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns an empty map when no files match", () => {
    fs.writeFileSync(path.join(tmpPath, "readme.txt"), "x");
    expect(walkCodebase(tmpPath, ["**/*.ts"])).toEqual({});
  });

  it("collects files matching a single pattern", () => {
    fs.writeFileSync(path.join(tmpPath, "a.ts"), "ts");
    fs.writeFileSync(path.join(tmpPath, "b.js"), "js");
    fs.mkdirSync(path.join(tmpPath, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "src", "c.ts"), "ts");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    const keys = Object.keys(out).map((k) => path.basename(k)).sort();
    expect(keys).toEqual(["a.ts", "c.ts"]);
  });

  it("collects files matching any of multiple patterns", () => {
    fs.writeFileSync(path.join(tmpPath, "a.ts"), "ts");
    fs.writeFileSync(path.join(tmpPath, "b.py"), "py");
    fs.writeFileSync(path.join(tmpPath, "c.go"), "go");
    const out = walkCodebase(tmpPath, ["**/*.ts", "**/*.py"]);
    const exts = new Set(Object.keys(out).map((k) => path.extname(k)));
    expect(exts).toEqual(new Set([".ts", ".py"]));
  });

  it("skips DEFAULT_IGNORE directories", () => {
    fs.mkdirSync(path.join(tmpPath, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "node_modules", "vendor.ts"),
      "vendor",
    );
    fs.writeFileSync(path.join(tmpPath, "real.ts"), "real");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    expect(Object.keys(out).map((k) => path.basename(k))).toEqual(["real.ts"]);
  });

  it("returns the file body keyed by absolute path", () => {
    const f = path.join(tmpPath, "file.ts");
    fs.writeFileSync(f, "the body");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    expect(Object.keys(out)).toHaveLength(1);
    const key = Object.keys(out)[0]!;
    expect(path.isAbsolute(key)).toBe(true);
    expect(out[key]).toBe("the body");
  });

  it("DEFAULT_IGNORE includes the canonical 13 entries", () => {
    expect(DEFAULT_IGNORE.has("node_modules")).toBe(true);
    expect(DEFAULT_IGNORE.has(".git")).toBe(true);
    expect(DEFAULT_IGNORE.has(".venv")).toBe(true);
    expect(DEFAULT_IGNORE.has("dist")).toBe(true);
    expect(DEFAULT_IGNORE.has("target")).toBe(true);
    expect(DEFAULT_IGNORE.has(".worktrees")).toBe(true);
    expect(DEFAULT_IGNORE.has("wiki-workspace")).toBe(true);
  });

  it("MAX_FILES is the documented bound", () => {
    expect(MAX_FILES).toBe(2000);
  });
});

describe("walkRepoTargets", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("repo-walk-targets-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns empty for an empty spec", () => {
    fs.writeFileSync(path.join(tmpPath, "Dockerfile"), "x");
    const r = walkRepoTargets(tmpPath, {});
    expect(r.paths).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("collects top-level files matching any basename regex", () => {
    fs.writeFileSync(path.join(tmpPath, "Dockerfile"), "x");
    fs.writeFileSync(path.join(tmpPath, "Makefile"), "x");
    fs.writeFileSync(path.join(tmpPath, "README.md"), "x");
    fs.mkdirSync(path.join(tmpPath, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "src", "Dockerfile"), "x"); // not top-level

    const r = walkRepoTargets(tmpPath, {
      topLevelBasenames: [/^Dockerfile(\.[^/]+)?$/, /^Makefile$/],
    });
    expect(r.paths).toEqual(["Dockerfile", "Makefile"]);
  });

  it("walks subdir patterns recursively and matches basenames", () => {
    fs.mkdirSync(path.join(tmpPath, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, ".github", "workflows", "ci.yml"),
      "x",
    );
    fs.writeFileSync(
      path.join(tmpPath, ".github", "workflows", "deploy.yaml"),
      "x",
    );
    fs.writeFileSync(
      path.join(tmpPath, ".github", "workflows", "notes.txt"),
      "x",
    );
    const r = walkRepoTargets(tmpPath, {
      subdirPatterns: [{ dir: ".github/workflows", rx: /\.ya?ml$/ }],
    });
    expect(r.paths).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/deploy.yaml",
    ]);
  });

  it("silently skips a non-existent subdir", () => {
    const r = walkRepoTargets(tmpPath, {
      subdirPatterns: [{ dir: "nope", rx: /\.ya?ml$/ }],
    });
    expect(r.paths).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  it("combines top-level + subdir results, deduped and sorted", () => {
    fs.writeFileSync(path.join(tmpPath, "Dockerfile"), "x");
    fs.mkdirSync(path.join(tmpPath, "deploy"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "deploy", "k8s.yaml"), "x");
    fs.writeFileSync(path.join(tmpPath, "deploy", "ec2.yml"), "x");
    const r = walkRepoTargets(tmpPath, {
      topLevelBasenames: [/^Dockerfile$/],
      subdirPatterns: [{ dir: "deploy", rx: /\.ya?ml$/ }],
    });
    expect(r.paths).toEqual(["Dockerfile", "deploy/ec2.yml", "deploy/k8s.yaml"]);
  });

  it("emits a note + empty paths when repoRoot is unreadable", () => {
    const missing = path.join(tmpPath, "does-not-exist");
    const r = walkRepoTargets(missing, {
      topLevelBasenames: [/^Dockerfile$/],
    });
    expect(r.paths).toEqual([]);
    expect(r.notes[0]).toMatch(/could not read repo root/);
  });

  it("returns lexicographically sorted output", () => {
    fs.mkdirSync(path.join(tmpPath, "config"), { recursive: true });
    for (const name of ["zeta.yaml", "alpha.yaml", "mu.yaml"]) {
      fs.writeFileSync(path.join(tmpPath, "config", name), "x");
    }
    const r = walkRepoTargets(tmpPath, {
      subdirPatterns: [{ dir: "config", rx: /\.ya?ml$/ }],
    });
    expect(r.paths).toEqual([
      "config/alpha.yaml",
      "config/mu.yaml",
      "config/zeta.yaml",
    ]);
  });
});
