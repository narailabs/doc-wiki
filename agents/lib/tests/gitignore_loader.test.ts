import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  findRepoRoot,
  loadGitignore,
  combineMatchers,
  wrapIgnore,
  loadGitignoreScoped,
  isIgnoredByStack,
  buildInitialMatcherStack,
  type ScopedMatcher,
} from "../gitignore_loader.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import ignore from "ignore";

describe("findRepoRoot", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("gitignore-find-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null when no .git is found up the tree", () => {
    // tmpPath sits under /tmp or /private/tmp — neither has .git.
    expect(findRepoRoot(tmpPath)).toBe(null);
  });

  it("returns the directory containing .git/", () => {
    fs.mkdirSync(path.join(tmpPath, ".git"));
    // findRepoRoot uses path.resolve (no symlink-following); compare to a
    // path resolved the same way so macOS /var → /private/var doesn't trip us.
    expect(findRepoRoot(tmpPath)).toBe(path.resolve(tmpPath));
  });

  it("walks up to find .git/ when start is a nested subdirectory", () => {
    fs.mkdirSync(path.join(tmpPath, ".git"));
    const nested = path.join(tmpPath, "a", "b", "c");
    fs.mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(path.resolve(tmpPath));
  });

  it("treats a .git file (worktree linkfile) as an anchor", () => {
    fs.writeFileSync(path.join(tmpPath, ".git"), "gitdir: /elsewhere\n");
    expect(findRepoRoot(tmpPath)).toBe(path.resolve(tmpPath));
  });
});

describe("loadGitignore", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("gitignore-load-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns a no-op matcher when .gitignore is missing", () => {
    const m = loadGitignore(tmpPath);
    expect(m.isIgnored("anything")).toBe(false);
    expect(m.isIgnored("dist/foo.js")).toBe(false);
  });

  it("returns a no-op matcher when .gitignore is unreadable (missing root)", () => {
    const m = loadGitignore(path.join(tmpPath, "does-not-exist"));
    expect(m.isIgnored("anything")).toBe(false);
  });

  it("matches simple file patterns", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.log\n");
    const m = loadGitignore(tmpPath);
    expect(m.isIgnored("server.log")).toBe(true);
    expect(m.isIgnored("server.txt")).toBe(false);
  });

  it("matches directory patterns and their contents", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "dist/\n");
    const m = loadGitignore(tmpPath);
    // gitignore's `foo/` syntax requires the test path to carry the
    // trailing slash for a bare-directory check; the walker adds it
    // automatically. Files inside an ignored dir match without slash.
    expect(m.isIgnored("dist/")).toBe(true);
    expect(m.isIgnored("dist/bundle.js")).toBe(true);
    expect(m.isIgnored("dist/nested/x.js")).toBe(true);
    expect(m.isIgnored("src/main.ts")).toBe(false);
  });

  it("supports negation rules (!pattern)", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".gitignore"),
      "*.log\n!important.log\n",
    );
    const m = loadGitignore(tmpPath);
    expect(m.isIgnored("server.log")).toBe(true);
    expect(m.isIgnored("important.log")).toBe(false);
  });

  it("normalises Windows-style paths and leading slashes", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "dist/\n");
    const m = loadGitignore(tmpPath);
    expect(m.isIgnored("dist\\foo.js")).toBe(true);
    expect(m.isIgnored("/dist/foo.js")).toBe(true);
  });

  it("returns false on the empty string", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*\n");
    const m = loadGitignore(tmpPath);
    expect(m.isIgnored("")).toBe(false);
  });

  it("handles comment lines and blank lines", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".gitignore"),
      "# this is a comment\n\n*.log\n   \n# another\n",
    );
    const m = loadGitignore(tmpPath);
    expect(m.isIgnored("a.log")).toBe(true);
  });
});

describe("combineMatchers", () => {
  it("returns no-op when given zero matchers", () => {
    const m = combineMatchers();
    expect(m.isIgnored("foo")).toBe(false);
    expect(m.isIgnored("dist/")).toBe(false);
  });

  it("returns true when ANY underlying matcher returns true", () => {
    const a = wrapIgnore(ignore().add("*.log"));
    const b = wrapIgnore(ignore().add("dist/"));
    const m = combineMatchers(a, b);
    expect(m.isIgnored("server.log")).toBe(true);
    expect(m.isIgnored("dist/foo.js")).toBe(true);
    expect(m.isIgnored("src/main.ts")).toBe(false);
  });

  it("short-circuits on the first match", () => {
    let bCalled = false;
    const a = { isIgnored: () => true };
    const b = {
      isIgnored: () => {
        bCalled = true;
        return false;
      },
    };
    combineMatchers(a, b).isIgnored("anything");
    expect(bCalled).toBe(false);
  });
});

describe("loadGitignoreScoped", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("gitignore-scoped-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null when no .gitignore is present", () => {
    expect(loadGitignoreScoped(tmpPath)).toBe(null);
  });

  it("returns null when the directory does not exist", () => {
    expect(
      loadGitignoreScoped(path.join(tmpPath, "missing")),
    ).toBe(null);
  });

  it("returns a ScopedMatcher anchored at the directory", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.log\n");
    const sm = loadGitignoreScoped(tmpPath);
    expect(sm).not.toBe(null);
    expect(sm!.baseDir).toBe(path.resolve(tmpPath));
    expect(sm!.matcher.isIgnored("a.log")).toBe(true);
  });
});

describe("isIgnoredByStack", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("gitignore-stack-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns false for an empty stack", () => {
    expect(isIgnoredByStack([], path.join(tmpPath, "x.ts"), false)).toBe(false);
  });

  it("returns true when any scoped matcher matches", () => {
    fs.mkdirSync(path.join(tmpPath, "foo"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.log\n");
    fs.writeFileSync(path.join(tmpPath, "foo", ".gitignore"), "secret.txt\n");
    const stack: ScopedMatcher[] = [
      loadGitignoreScoped(tmpPath)!,
      loadGitignoreScoped(path.join(tmpPath, "foo"))!,
    ];
    expect(
      isIgnoredByStack(stack, path.join(tmpPath, "foo", "secret.txt"), false),
    ).toBe(true);
    // Top-level rule still applies to the file inside foo/.
    expect(
      isIgnoredByStack(stack, path.join(tmpPath, "foo", "a.log"), false),
    ).toBe(true);
  });

  it("does not let nested rules escape their own scope", () => {
    // Pattern in foo/.gitignore should NOT match files in bar/.
    fs.mkdirSync(path.join(tmpPath, "foo"), { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "bar"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "foo", ".gitignore"), "secret.txt\n");
    const fooSm = loadGitignoreScoped(path.join(tmpPath, "foo"))!;
    expect(
      isIgnoredByStack(
        [fooSm],
        path.join(tmpPath, "foo", "secret.txt"),
        false,
      ),
    ).toBe(true);
    expect(
      isIgnoredByStack(
        [fooSm],
        path.join(tmpPath, "bar", "secret.txt"),
        false,
      ),
    ).toBe(false);
  });

  it("appends a trailing slash for directory probes", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "build/\n");
    const sm = loadGitignoreScoped(tmpPath)!;
    expect(
      isIgnoredByStack([sm], path.join(tmpPath, "build"), true),
    ).toBe(true);
    // Same path probed as a file — gitignore's `build/` should NOT match.
    expect(
      isIgnoredByStack([sm], path.join(tmpPath, "build"), false),
    ).toBe(false);
  });

  it("skips out-of-scope paths (`..` and `../...`)", () => {
    fs.mkdirSync(path.join(tmpPath, "child"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "child", ".gitignore"), "*\n");
    const childSm = loadGitignoreScoped(path.join(tmpPath, "child"))!;
    // tmpPath itself is the parent of `child` → out-of-scope for childSm.
    expect(isIgnoredByStack([childSm], tmpPath, true)).toBe(false);
    // A sibling of `child` is also out-of-scope.
    fs.mkdirSync(path.join(tmpPath, "sibling"), { recursive: true });
    expect(
      isIgnoredByStack([childSm], path.join(tmpPath, "sibling"), true),
    ).toBe(false);
  });

  it("still applies rules to in-scope basenames that start with `..`", () => {
    // Regression: `rel.startsWith("..")` previously over-matched names
    // like `..cache` and silently disabled the matcher for that subtree.
    fs.writeFileSync(
      path.join(tmpPath, ".gitignore"),
      "..cache/\n..hidden.ts\n",
    );
    const sm = loadGitignoreScoped(tmpPath)!;
    // Directory whose name starts with `..`
    expect(
      isIgnoredByStack([sm], path.join(tmpPath, "..cache"), true),
    ).toBe(true);
    // File inside that directory
    expect(
      isIgnoredByStack([sm], path.join(tmpPath, "..cache", "x.ts"), false),
    ).toBe(true);
    // Stand-alone file whose name starts with `..`
    expect(
      isIgnoredByStack([sm], path.join(tmpPath, "..hidden.ts"), false),
    ).toBe(true);
  });
});

describe("buildInitialMatcherStack", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("gitignore-build-stack-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns just the anchor's gitignore when walkRoot equals anchorRoot", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.log\n");
    const stack = buildInitialMatcherStack(tmpPath, tmpPath);
    expect(stack).toHaveLength(1);
    expect(stack[0].baseDir).toBe(path.resolve(tmpPath));
  });

  it("returns an empty stack when no .gitignore exists anywhere", () => {
    expect(buildInitialMatcherStack(tmpPath, tmpPath)).toEqual([]);
  });

  it("layers intermediate gitignores between anchorRoot and walkRoot", () => {
    fs.mkdirSync(path.join(tmpPath, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "root.txt\n");
    fs.writeFileSync(path.join(tmpPath, "a", ".gitignore"), "a.txt\n");
    fs.writeFileSync(path.join(tmpPath, "a", "b", ".gitignore"), "b.txt\n");
    const stack = buildInitialMatcherStack(
      tmpPath,
      path.join(tmpPath, "a", "b", "c"),
    );
    expect(stack).toHaveLength(3);
    expect(stack[0].baseDir).toBe(path.resolve(tmpPath));
    expect(stack[1].baseDir).toBe(path.resolve(path.join(tmpPath, "a")));
    expect(stack[2].baseDir).toBe(path.resolve(path.join(tmpPath, "a", "b")));
  });

  it("returns only anchor's matcher when walkRoot is outside anchorRoot", () => {
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "*.log\n");
    const outside = makeTmpPath("outside-");
    try {
      const stack = buildInitialMatcherStack(tmpPath, outside);
      expect(stack).toHaveLength(1);
      expect(stack[0].baseDir).toBe(path.resolve(tmpPath));
    } finally {
      cleanupTmpPath(outside);
    }
  });

  it("treats in-scope segments starting with `..` as descendants, not as parents", () => {
    // Regression: a previous `rel.startsWith("..")` check classified
    // `..cache` as out-of-scope and returned just the anchor's matcher.
    // It should descend into `..cache` and pick up its `.gitignore`.
    fs.mkdirSync(path.join(tmpPath, "..cache"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "anchor.ts\n");
    fs.writeFileSync(
      path.join(tmpPath, "..cache", ".gitignore"),
      "nested.ts\n",
    );
    const stack = buildInitialMatcherStack(
      tmpPath,
      path.join(tmpPath, "..cache"),
    );
    expect(stack).toHaveLength(2);
    expect(stack[0].baseDir).toBe(path.resolve(tmpPath));
    expect(stack[1].baseDir).toBe(path.resolve(path.join(tmpPath, "..cache")));
  });

  it("skips levels without a .gitignore", () => {
    fs.mkdirSync(path.join(tmpPath, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, ".gitignore"), "root.txt\n");
    // No `.gitignore` at `a/`.
    fs.writeFileSync(path.join(tmpPath, "a", "b", ".gitignore"), "b.txt\n");
    const stack = buildInitialMatcherStack(
      tmpPath,
      path.join(tmpPath, "a", "b"),
    );
    expect(stack).toHaveLength(2);
    expect(stack[0].baseDir).toBe(path.resolve(tmpPath));
    expect(stack[1].baseDir).toBe(path.resolve(path.join(tmpPath, "a", "b")));
  });
});
