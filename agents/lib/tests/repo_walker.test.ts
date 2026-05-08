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

describe("walkCodebase — .gitignore handling (default-on)", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("repo-walker-gitignore-");
    // Anchor tmpPath as a "repo root" so resolveGitignore picks it up.
    fs.mkdirSync(path.join(tmpPath, ".git"));
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("excludes files matched by .gitignore by default", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "dist/\n*.tmp\n");
    fs.writeFileSync(path.join(tmpPath, "real.ts"), "real");
    fs.writeFileSync(path.join(tmpPath, "scratch.tmp"), "scratch");
    fs.mkdirSync(path.join(tmpPath, "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "dist", "bundle.ts"), "bundle");
    const out = walkCodebase(tmpPath, ["**/*.ts", "**/*.tmp"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual(["real.ts"]);
  });

  it("excludes nested files inside a gitignored directory", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "build/\n");
    fs.writeFileSync(path.join(tmpPath, "src.ts"), "src");
    fs.mkdirSync(path.join(tmpPath, "build", "deep"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "build", "deep", "nested.ts"),
      "nested",
    );
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual(["src.ts"]);
  });

  it("can be disabled with respectGitignore: false", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.log\n");
    fs.writeFileSync(path.join(tmpPath, "kept.log"), "x");
    fs.writeFileSync(path.join(tmpPath, "real.ts"), "y");
    const out = walkCodebase(tmpPath, ["**/*"], {
      respectGitignore: false,
    });
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toContain("kept.log");
    expect(names).toContain("real.ts");
  });

  it("respects explicit gitignoreRoot when walking a subdirectory", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "src/secret.ts\n");
    fs.mkdirSync(path.join(tmpPath, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "src", "secret.ts"), "secret");
    fs.writeFileSync(path.join(tmpPath, "src", "ok.ts"), "ok");
    const out = walkCodebase(path.join(tmpPath, "src"), ["**/*.ts"], {
      gitignoreRoot: tmpPath,
    });
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual(["src/ok.ts"]);
  });

  it("supports !pattern negation", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".gitignore"),
      "*.ts\n!keep.ts\n",
    );
    fs.writeFileSync(path.join(tmpPath, "drop.ts"), "x");
    fs.writeFileSync(path.join(tmpPath, "keep.ts"), "y");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual(["keep.ts"]);
  });

  it("is a no-op when no .gitignore is present", () => {
    fs.writeFileSync(path.join(tmpPath, "a.ts"), "x");
    fs.writeFileSync(path.join(tmpPath, "b.ts"), "y");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    expect(Object.keys(out)).toHaveLength(2);
  });
});

describe("walkRepoTargets — .gitignore handling (default-on)", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("repo-walk-targets-gitignore-");
    fs.mkdirSync(path.join(tmpPath, ".git"));
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("skips top-level files matched by .gitignore", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "drafts.md\n");
    fs.writeFileSync(path.join(tmpPath, "drafts.md"), "x");
    fs.writeFileSync(path.join(tmpPath, "README.md"), "y");
    const r = walkRepoTargets(tmpPath, {
      topLevelBasenames: [/\.md$/],
    });
    expect(r.paths).toEqual(["README.md"]);
  });

  it("skips entire gitignored subtree in subdirPatterns", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "secrets/\n");
    fs.mkdirSync(path.join(tmpPath, "secrets"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "secrets", "token.yaml"), "x");
    fs.mkdirSync(path.join(tmpPath, "config"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "config", "ok.yaml"), "y");
    const r = walkRepoTargets(tmpPath, {
      subdirPatterns: [
        { dir: "secrets", rx: /\.yaml$/ },
        { dir: "config", rx: /\.yaml$/ },
      ],
    });
    expect(r.paths).toEqual(["config/ok.yaml"]);
  });

  it("skips a gitignored leaf inside a non-ignored subdir", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".gitignore"),
      "config/secret.yaml\n",
    );
    fs.mkdirSync(path.join(tmpPath, "config"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "config", "ok.yaml"), "ok");
    fs.writeFileSync(path.join(tmpPath, "config", "secret.yaml"), "no");
    const r = walkRepoTargets(tmpPath, {
      subdirPatterns: [{ dir: "config", rx: /\.yaml$/ }],
    });
    expect(r.paths).toEqual(["config/ok.yaml"]);
  });

  it("can be disabled with respectGitignore: false", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "drafts.md\n");
    fs.writeFileSync(path.join(tmpPath, "drafts.md"), "x");
    fs.writeFileSync(path.join(tmpPath, "README.md"), "y");
    const r = walkRepoTargets(
      tmpPath,
      { topLevelBasenames: [/\.md$/] },
      { respectGitignore: false },
    );
    expect(r.paths).toEqual(["README.md", "drafts.md"]);
  });
});

describe("walkCodebase — nested .gitignore", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("repo-walker-nested-");
    fs.mkdirSync(path.join(tmpPath, ".git"));
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("applies nested .gitignore patterns only within their scope", () => {
    // Repo root has no .gitignore. Subdir `frontend/` has its own.
    fs.mkdirSync(path.join(tmpPath, "frontend"), { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "backend"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "frontend", ".gitignore"),
      "build.ts\n",
    );
    // build.ts under frontend should be ignored, but the same-named file
    // under backend should NOT be (nested gitignore is scoped).
    fs.writeFileSync(path.join(tmpPath, "frontend", "build.ts"), "f-build");
    fs.writeFileSync(path.join(tmpPath, "frontend", "src.ts"), "f-src");
    fs.writeFileSync(path.join(tmpPath, "backend", "build.ts"), "b-build");
    fs.writeFileSync(path.join(tmpPath, "backend", "src.ts"), "b-src");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual([
      "backend/build.ts",
      "backend/src.ts",
      "frontend/src.ts",
    ]);
  });

  it("layers nested rules on top of repo-root rules", () => {
    fs.mkdirSync(path.join(tmpPath, "frontend"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.log\n");
    fs.writeFileSync(
      path.join(tmpPath, "frontend", ".gitignore"),
      "secret.ts\n",
    );
    fs.writeFileSync(path.join(tmpPath, "frontend", "secret.ts"), "shh");
    fs.writeFileSync(path.join(tmpPath, "frontend", "ok.ts"), "ok");
    fs.writeFileSync(path.join(tmpPath, "frontend", "err.log"), "x");
    fs.writeFileSync(path.join(tmpPath, "root.ts"), "root");
    const out = walkCodebase(tmpPath, ["**/*"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toContain("frontend/ok.ts");
    expect(names).toContain("root.ts");
    expect(names).not.toContain("frontend/secret.ts"); // nested rule
    expect(names).not.toContain("frontend/err.log"); // root rule
  });

  it("handles negation within a single .gitignore file (intra-file scope)", () => {
    fs.mkdirSync(path.join(tmpPath, "vendor"), { recursive: true });
    // Negation inside one gitignore: allow `keep.min.js`, skip everything else.
    fs.writeFileSync(
      path.join(tmpPath, "vendor", ".gitignore"),
      "*.min.js\n!keep.min.js\n",
    );
    fs.writeFileSync(path.join(tmpPath, "vendor", "drop.min.js"), "x");
    fs.writeFileSync(path.join(tmpPath, "vendor", "keep.min.js"), "y");
    fs.writeFileSync(path.join(tmpPath, "vendor", "src.js"), "src");
    const out = walkCodebase(tmpPath, ["**/*.js"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual(["vendor/keep.min.js", "vendor/src.js"]);
  });

  it("a nested negation does NOT override a parent's positive pattern (conservative)", () => {
    // The walker uses OR semantics across the matcher stack: if ANY scoped
    // matcher says "ignore", the entry is skipped. This is intentionally
    // stricter than git's nested-override rule — for documentation
    // generation we'd rather over-exclude than leak something the user
    // wanted hidden.
    fs.mkdirSync(path.join(tmpPath, "vendor"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.min.js\n");
    fs.writeFileSync(
      path.join(tmpPath, "vendor", ".gitignore"),
      "!*.min.js\n",
    );
    fs.writeFileSync(path.join(tmpPath, "vendor", "lib.min.js"), "v");
    fs.writeFileSync(path.join(tmpPath, "lib.min.js"), "root");
    fs.writeFileSync(path.join(tmpPath, "src.js"), "src");
    const out = walkCodebase(tmpPath, ["**/*.js"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toContain("src.js");
    // Both .min.js files are excluded — root rule wins, nested negation
    // is not an over-ride (conservative-by-design).
    expect(names).not.toContain("lib.min.js");
    expect(names).not.toContain("vendor/lib.min.js");
  });

  it("does not let sibling subtrees pollute each other's matcher stack", () => {
    fs.mkdirSync(path.join(tmpPath, "a"), { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "b"), { recursive: true });
    // Pattern in a/.gitignore must only affect files in a/, not b/.
    fs.writeFileSync(path.join(tmpPath, "a", ".gitignore"), "drop.ts\n");
    fs.writeFileSync(path.join(tmpPath, "a", "drop.ts"), "x");
    fs.writeFileSync(path.join(tmpPath, "a", "keep.ts"), "y");
    fs.writeFileSync(path.join(tmpPath, "b", "drop.ts"), "x");
    fs.writeFileSync(path.join(tmpPath, "b", "keep.ts"), "y");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual([
      "a/keep.ts",
      "b/drop.ts", // NOT excluded by a/.gitignore
      "b/keep.ts",
    ]);
  });

  it("respects deeply-nested .gitignore rules", () => {
    // .gitignore at every level adds one more pattern.
    fs.mkdirSync(path.join(tmpPath, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "lvl0.ts\n");
    fs.writeFileSync(path.join(tmpPath, "a", ".gitignore"), "lvl1.ts\n");
    fs.writeFileSync(path.join(tmpPath, "a", "b", ".gitignore"), "lvl2.ts\n");
    fs.writeFileSync(
      path.join(tmpPath, "a", "b", "c", ".gitignore"),
      "lvl3.ts\n",
    );
    // One file per level; only `keep.ts` should survive at the deepest.
    fs.writeFileSync(path.join(tmpPath, "a", "b", "c", "lvl0.ts"), "0");
    fs.writeFileSync(path.join(tmpPath, "a", "b", "c", "lvl1.ts"), "1");
    fs.writeFileSync(path.join(tmpPath, "a", "b", "c", "lvl2.ts"), "2");
    fs.writeFileSync(path.join(tmpPath, "a", "b", "c", "lvl3.ts"), "3");
    fs.writeFileSync(path.join(tmpPath, "a", "b", "c", "keep.ts"), "k");
    const out = walkCodebase(tmpPath, ["**/*.ts"]);
    const names = Object.keys(out)
      .map((p) => path.relative(tmpPath, p))
      .sort();
    expect(names).toEqual(["a/b/c/keep.ts"]);
  });
});

describe("walkRepoTargets — nested .gitignore", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("repo-walk-targets-nested-");
    fs.mkdirSync(path.join(tmpPath, ".git"));
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("applies nested .gitignore inside subdirPatterns recursion", () => {
    fs.mkdirSync(path.join(tmpPath, "config", "secrets"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "config", ".gitignore"),
      "secrets/\n",
    );
    fs.writeFileSync(path.join(tmpPath, "config", "ok.yaml"), "ok");
    fs.writeFileSync(
      path.join(tmpPath, "config", "secrets", "private.yaml"),
      "secret",
    );
    const r = walkRepoTargets(tmpPath, {
      subdirPatterns: [{ dir: "config", rx: /\.yaml$/ }],
    });
    expect(r.paths).toEqual(["config/ok.yaml"]);
  });

  it("nested gitignore does not leak across sibling subtrees", () => {
    fs.mkdirSync(path.join(tmpPath, "a"), { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "b"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "a", ".gitignore"), "drop.yaml\n");
    fs.writeFileSync(path.join(tmpPath, "a", "drop.yaml"), "x");
    fs.writeFileSync(path.join(tmpPath, "a", "keep.yaml"), "y");
    fs.writeFileSync(path.join(tmpPath, "b", "drop.yaml"), "x");
    const r = walkRepoTargets(tmpPath, {
      subdirPatterns: [
        { dir: "a", rx: /\.yaml$/ },
        { dir: "b", rx: /\.yaml$/ },
      ],
    });
    expect(r.paths).toEqual(["a/keep.yaml", "b/drop.yaml"]);
  });
});
