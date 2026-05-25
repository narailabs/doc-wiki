/**
 * Tests for _wiki_fs.ts — specifically the `loadIgnore` / `.wiki-ignore`
 * matcher and the new `walkLivePages` / `walkArchivedPages` helpers.
 * The `wikiPages` walker is exercised indirectly by tests for
 * `lint_checks`, `quality_score`, and other consumers.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { loadIgnore, walkLivePages, walkArchivedPages, wikiPages } from "../_wiki_fs.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

describe("loadIgnore", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("wiki-ignore-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns a matcher that ignores nothing when .wiki-ignore is absent", () => {
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("node_modules/foo.js")).toBe(false);
    expect(matcher.isIgnored("anything.md")).toBe(false);
  });

  it("honors simple directory patterns", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".wiki-ignore"),
      "node_modules/\n.git/\n",
    );
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("node_modules/foo.js")).toBe(true);
    expect(matcher.isIgnored(".git/HEAD")).toBe(true);
    expect(matcher.isIgnored("src/lib.ts")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".wiki-ignore"),
      "# this is a comment\n\n*.log\n",
    );
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("error.log")).toBe(true);
    expect(matcher.isIgnored("error.txt")).toBe(false);
  });

  it("supports negation with `!`", () => {
    // Gitignore semantics: negation works on siblings, NOT on files under
    // an already-ignored directory. Pattern matches all .log files except
    // important.log in the same directory.
    fs.writeFileSync(
      path.join(tmpPath, ".wiki-ignore"),
      "*.log\n!important.log\n",
    );
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("error.log")).toBe(true);
    expect(matcher.isIgnored("important.log")).toBe(false);
  });

  it("supports `**` globs", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".wiki-ignore"),
      "**/*.tmp\n",
    );
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("draft.tmp")).toBe(true);
    expect(matcher.isIgnored("nested/deep/draft.tmp")).toBe(true);
    expect(matcher.isIgnored("draft.md")).toBe(false);
  });

  it("normalizes leading slashes and back-slashes", () => {
    fs.writeFileSync(
      path.join(tmpPath, ".wiki-ignore"),
      "node_modules/\n",
    );
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("/node_modules/foo.js")).toBe(true);
    expect(matcher.isIgnored("node_modules\\foo.js")).toBe(true);
  });

  it("returns false for the empty string", () => {
    fs.writeFileSync(path.join(tmpPath, ".wiki-ignore"), "node_modules/\n");
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("")).toBe(false);
  });

  it("gracefully handles unreadable .wiki-ignore", () => {
    // Put a directory at the expected path so readFileSync throws EISDIR.
    fs.mkdirSync(path.join(tmpPath, ".wiki-ignore"));
    const matcher = loadIgnore(tmpPath);
    expect(matcher.isIgnored("node_modules/foo.js")).toBe(false);
  });
});

describe("walkLivePages", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("wiki-walk-live-");
    // Base fixture:
    //   wiki/index.md
    //   wiki/topic-a/page.md
    //   wiki/_archive/topic-a/old-page.md
    //   wiki/_archive/index.md
    fs.mkdirSync(path.join(tmpPath, "wiki", "topic-a"), { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "wiki", "_archive", "topic-a"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "wiki", "index.md"), "# Index\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "topic-a", "page.md"), "# Page\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "_archive", "index.md"), "# Archived Index\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "_archive", "topic-a", "old-page.md"), "# Old\n");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("excludes any directory starting with _", async () => {
    const pages = await walkLivePages(tmpPath);
    expect(pages.map((p) => p.relPath)).toEqual([
      "wiki/index.md",
      "wiki/topic-a/page.md",
    ]);
  });

  it("excludes _archive even when nested deeply", async () => {
    // wiki/topic-b/_archive/legacy.md  — shouldn't happen in practice but guard
    // wiki/_internal/draft.md          — any underscore-prefixed dir is skipped
    fs.mkdirSync(path.join(tmpPath, "wiki", "topic-b", "_archive"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "wiki", "topic-b", "_archive", "legacy.md"), "# Legacy\n");
    fs.mkdirSync(path.join(tmpPath, "wiki", "_internal"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "wiki", "_internal", "draft.md"), "# Draft\n");

    const pages = await walkLivePages(tmpPath);
    const relPaths = pages.map((p) => p.relPath);
    expect(relPaths).not.toContain("wiki/topic-b/_archive/legacy.md");
    expect(relPaths).not.toContain("wiki/_internal/draft.md");
    // Live pages are still found
    expect(relPaths).toContain("wiki/index.md");
    expect(relPaths).toContain("wiki/topic-a/page.md");
  });

  it("handles empty wiki (only wiki/index.md)", async () => {
    const emptyRoot = makeTmpPath("wiki-walk-empty-");
    try {
      fs.mkdirSync(path.join(emptyRoot, "wiki"), { recursive: true });
      fs.writeFileSync(path.join(emptyRoot, "wiki", "index.md"), "# Index\n");
      const pages = await walkLivePages(emptyRoot);
      expect(pages.map((p) => p.relPath)).toEqual(["wiki/index.md"]);
    } finally {
      cleanupTmpPath(emptyRoot);
    }
  });

  it("returns empty array when wiki/ directory does not exist", async () => {
    const freshRoot = makeTmpPath("wiki-walk-fresh-");
    try {
      const pages = await walkLivePages(freshRoot);
      expect(pages).toEqual([]);
    } finally {
      cleanupTmpPath(freshRoot);
    }
  });

  it("exposes both absPath and relPath on each WikiPage", async () => {
    const pages = await walkLivePages(tmpPath);
    for (const p of pages) {
      expect(path.isAbsolute(p.absPath)).toBe(true);
      expect(p.relPath).not.toMatch(/^\//);
      expect(p.absPath).toContain(p.relPath.replace(/\//g, path.sep));
    }
  });
});

describe("walkArchivedPages", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("wiki-walk-arch-");
    fs.mkdirSync(path.join(tmpPath, "wiki", "topic-a"), { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "wiki", "_archive", "topic-a"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "wiki", "index.md"), "# Index\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "topic-a", "page.md"), "# Page\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "_archive", "index.md"), "# Archived Index\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "_archive", "topic-a", "old-page.md"), "# Old\n");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns only _archive/ pages", async () => {
    const pages = await walkArchivedPages(tmpPath);
    expect(pages.map((p) => p.relPath)).toEqual([
      "wiki/_archive/index.md",
      "wiki/_archive/topic-a/old-page.md",
    ]);
  });

  it("returns empty array when _archive/ does not exist", async () => {
    const noArchRoot = makeTmpPath("wiki-walk-noarch-");
    try {
      fs.mkdirSync(path.join(noArchRoot, "wiki"), { recursive: true });
      fs.writeFileSync(path.join(noArchRoot, "wiki", "index.md"), "# Index\n");
      const pages = await walkArchivedPages(noArchRoot);
      expect(pages).toEqual([]);
    } finally {
      cleanupTmpPath(noArchRoot);
    }
  });

  it("relPath is relative to wikiRoot (not to _archive/)", async () => {
    const pages = await walkArchivedPages(tmpPath);
    for (const p of pages) {
      expect(p.relPath.startsWith("wiki/_archive/")).toBe(true);
    }
  });

  it("absPath is absolute and consistent with relPath", async () => {
    const pages = await walkArchivedPages(tmpPath);
    for (const p of pages) {
      expect(path.isAbsolute(p.absPath)).toBe(true);
      expect(p.absPath).toContain(p.relPath.replace(/\//g, path.sep));
    }
  });
});

describe("wikiPages (deprecated alias)", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("wiki-pages-alias-");
    fs.mkdirSync(path.join(tmpPath, "wiki", "topic-a"), { recursive: true });
    fs.mkdirSync(path.join(tmpPath, "wiki", "_archive", "topic-a"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "wiki", "index.md"), "# Index\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "topic-a", "page.md"), "# Page\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "_archive", "index.md"), "# Archived\n");
    fs.writeFileSync(path.join(tmpPath, "wiki", "_archive", "topic-a", "old.md"), "# Old\n");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns the same paths as walkLivePages mapped to absPath", async () => {
    const expected = (await walkLivePages(tmpPath)).map((p) => p.absPath);
    expect(wikiPages(tmpPath)).toEqual(expected);
  });

  it("excludes _archive and other _ directories", () => {
    const paths = wikiPages(tmpPath);
    expect(paths.every((p) => !p.includes("_archive"))).toBe(true);
  });
});
