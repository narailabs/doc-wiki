/**
 * Tests for _wiki_fs.ts — specifically the `loadIgnore` / `.wiki-ignore`
 * matcher. The `wikiPages` walker is exercised indirectly by tests for
 * `lint_checks`, `quality_score`, and other consumers.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { loadIgnore } from "../_wiki_fs.js";
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
