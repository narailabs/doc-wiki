/**
 * Tests for atlas_gitlog.ts — gitlog drift classification used by
 * `/doc-wiki:atlas` Phase 5. The actual `git log` invocation is shelled out
 * via `child_process.execFileSync`, so these tests focus on the pure
 * classification + indexing logic and synthesize their own changed-files
 * arrays. The CLI / `git log` integration is covered indirectly when the
 * orchestrator runs end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import { execFileSync } from "node:child_process";

import {
  classifyChanges,
  indexAtlasPages,
  getLastAtlasTimestamp,
  getChangedFilesSince,
} from "../atlas_gitlog.js";
import {
  makeTmpPath,
  cleanupTmpPath,
  makeInitializedWiki,
} from "./fixtures.js";

describe("indexAtlasPages", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-gitlog-index-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns an empty array when no atlas-tagged pages exist", () => {
    expect(indexAtlasPages(wikiRoot)).toEqual([]);
  });

  it("indexes pages with atlas_run_id frontmatter only", () => {
    const wiki = path.join(wikiRoot, "wiki");
    fs.mkdirSync(path.join(wiki, "auth"), { recursive: true });
    // atlas-tagged page
    fs.writeFileSync(
      path.join(wiki, "auth", "architecture.md"),
      "---\n" +
        yaml.dump({
          title: "Auth architecture",
          atlas_facet: "architecture",
          atlas_run_id: "2026-04-30T12-00-00",
          sources: ["src/auth/index.ts", "src/auth/middleware.ts"],
        }) +
        "---\n\nbody\n",
    );
    // manual ingest (no atlas_run_id) — should be skipped
    fs.writeFileSync(
      path.join(wiki, "auth", "manual.md"),
      "---\n" +
        yaml.dump({
          title: "Manual page",
          sources: ["src/auth/notes.md"],
        }) +
        "---\n\nbody\n",
    );

    const got = indexAtlasPages(wikiRoot);
    expect(got).toHaveLength(1);
    expect(got[0]?.page).toBe("wiki/auth/architecture.md");
    expect(got[0]?.sources).toEqual(["src/auth/index.ts", "src/auth/middleware.ts"]);
    expect(got[0]?.atlas_run_id).toBe("2026-04-30T12-00-00");
  });

  it("skips pages with malformed frontmatter", () => {
    const wiki = path.join(wikiRoot, "wiki");
    fs.writeFileSync(path.join(wiki, "broken.md"), "---\nnot: yaml: ::\n---\nbody\n");
    expect(indexAtlasPages(wikiRoot)).toEqual([]);
  });
});

describe("classifyChanges", () => {
  it("classifies an exact-match path as stale", () => {
    const out = classifyChanges(
      ["src/auth/index.ts"],
      [
        {
          page: "wiki/auth/architecture.md",
          sources: ["src/auth/index.ts"],
          atlas_run_id: "r1",
        },
      ],
      ["auth"],
    );
    expect(out.stale_pages).toEqual([
      { page: "wiki/auth/architecture.md", sources: ["src/auth/index.ts"] },
    ]);
    expect(out.uncovered_files).toEqual([]);
    expect(out.unrelated_files).toEqual([]);
  });

  it("classifies a directory-prefix match as stale", () => {
    const out = classifyChanges(
      ["src/auth/middleware.ts"],
      [
        {
          page: "wiki/auth/architecture.md",
          sources: ["src/auth/"],
          atlas_run_id: "r1",
        },
      ],
      ["auth"],
    );
    expect(out.stale_pages).toEqual([
      { page: "wiki/auth/architecture.md", sources: ["src/auth/middleware.ts"] },
    ]);
  });

  it("classifies a file under a current-run topic but not in any page as uncovered", () => {
    const out = classifyChanges(
      ["src/billing/invoice.ts"],
      [
        {
          page: "wiki/auth/architecture.md",
          sources: ["src/auth/"],
          atlas_run_id: "r1",
        },
      ],
      ["auth", "billing"],
    );
    expect(out.uncovered_files).toEqual([
      { path: "src/billing/invoice.ts", topic: "billing" },
    ]);
    expect(out.stale_pages).toEqual([]);
  });

  it("classifies a file matching neither pages nor topics as unrelated", () => {
    const out = classifyChanges(
      ["docs/random.md"],
      [
        {
          page: "wiki/auth/architecture.md",
          sources: ["src/auth/"],
          atlas_run_id: "r1",
        },
      ],
      ["auth"],
    );
    expect(out.unrelated_files).toEqual(["docs/random.md"]);
  });

  it("groups multiple stale matches under one page entry, sorted", () => {
    const out = classifyChanges(
      ["src/auth/b.ts", "src/auth/a.ts"],
      [
        {
          page: "wiki/auth/architecture.md",
          sources: ["src/auth/"],
          atlas_run_id: "r1",
        },
      ],
      ["auth"],
    );
    expect(out.stale_pages).toEqual([
      {
        page: "wiki/auth/architecture.md",
        sources: ["src/auth/a.ts", "src/auth/b.ts"],
      },
    ]);
  });

  it("prefers stale over uncovered when both rules match", () => {
    const out = classifyChanges(
      ["src/auth/index.ts"],
      [
        {
          page: "wiki/auth/architecture.md",
          sources: ["src/auth/index.ts"],
          atlas_run_id: "r1",
        },
      ],
      ["auth"],
    );
    expect(out.stale_pages).toHaveLength(1);
    expect(out.uncovered_files).toEqual([]);
  });
});

describe("getLastAtlasTimestamp", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-gitlog-ts-");
    wikiRoot = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null when events.jsonl does not exist", () => {
    fs.unlinkSync(path.join(wikiRoot, "log", "events.jsonl"));
    expect(getLastAtlasTimestamp(wikiRoot)).toBeNull();
  });

  it("returns null when no op:atlas events are present", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      JSON.stringify({ op: "ingest", timestamp: "2026-04-29T10:00:00+00:00" }) + "\n",
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBeNull();
  });

  it("returns the most recent op:atlas timestamp", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      [
        JSON.stringify({ op: "ingest", timestamp: "2026-04-28T09:00:00+00:00" }),
        JSON.stringify({ op: "atlas", timestamp: "2026-04-29T10:00:00+00:00" }),
        JSON.stringify({ op: "lint", timestamp: "2026-04-29T11:00:00+00:00" }),
        JSON.stringify({ op: "atlas", timestamp: "2026-04-30T08:00:00+00:00" }),
      ].join("\n") + "\n",
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBe("2026-04-30T08:00:00+00:00");
  });

  // The backward buffer scan replaced `.split("\n")`, so the cases that
  // `split` handled implicitly — blank rows, a missing final terminator, and
  // a single row with no terminator at all — now need explicit coverage.
  it("skips blank rows between events", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      "\n" +
        JSON.stringify({ op: "atlas", timestamp: "2026-04-29T10:00:00+00:00" }) +
        "\n\n\n" +
        JSON.stringify({ op: "lint", timestamp: "2026-04-29T11:00:00+00:00" }) +
        "\n\n",
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBe("2026-04-29T10:00:00+00:00");
  });

  it("reads the final event when the file has no trailing newline", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      [
        JSON.stringify({ op: "atlas", timestamp: "2026-04-29T10:00:00+00:00" }),
        JSON.stringify({ op: "atlas", timestamp: "2026-04-30T08:00:00+00:00" }),
      ].join("\n"),
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBe("2026-04-30T08:00:00+00:00");
  });

  it("reads a lone event that has no terminator", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      JSON.stringify({ op: "atlas", timestamp: "2026-05-01T12:00:00+00:00" }),
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBe("2026-05-01T12:00:00+00:00");
  });

  it("returns null for a log that is only blank lines", () => {
    fs.writeFileSync(path.join(wikiRoot, "log", "events.jsonl"), "\n\n\n");
    expect(getLastAtlasTimestamp(wikiRoot)).toBeNull();
  });
});

// ── getChangedFilesSince ───────────────────────────────────────────
//
// `getChangedFilesSince` now walks the `git log --name-only` buffer with
// indexOf instead of `.split("\n")`. `git log --pretty=format:` emits a blank
// separator row per commit and always terminates the last path with a newline,
// so these run against a real repo to pin the shape the scan actually sees.
// The `nextPos === -1` tail guard is defensive only — git never produces an
// unterminated final path — so no test can reach it through this function.

describe("getChangedFilesSince", () => {
  let tmpPath: string;
  let repoRoot: string;

  function git(...args: string[]): void {
    execFileSync("git", ["-C", repoRoot, ...args], { stdio: "ignore" });
  }

  beforeEach(() => {
    tmpPath = makeTmpPath("gitlog-changed-");
    repoRoot = path.join(tmpPath, "repo");
    fs.mkdirSync(repoRoot, { recursive: true });
    execFileSync("git", ["-C", repoRoot, "init", "-q"], { stdio: "ignore" });
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  function commit(files: Record<string, string>, message: string): void {
    for (const [rel, body] of Object.entries(files)) {
      const target = path.join(repoRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    git("add", "-A");
    git("commit", "-q", "-m", message);
  }

  it("returns every touched path, deduplicated and sorted", () => {
    commit({ "src/b.ts": "b\n", "src/a.ts": "a\n" }, "first");
    commit({ "src/a.ts": "a2\n", "docs/c.md": "c\n" }, "second");

    expect(getChangedFilesSince(repoRoot, null)).toEqual([
      "docs/c.md",
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("reads a single-commit, single-file log", () => {
    commit({ "only.ts": "x\n" }, "only");
    expect(getChangedFilesSince(repoRoot, null)).toEqual(["only.ts"]);
  });

  it("skips the blank separator row git emits between commits", () => {
    // `--pretty=format:` prints an empty subject line ahead of each commit's
    // paths from the second commit on. Those rows must not become entries.
    commit({ "a.ts": "a\n" }, "first");
    commit({ "b.ts": "b\n" }, "second");
    commit({ "c.ts": "c\n" }, "third");
    expect(getChangedFilesSince(repoRoot, null)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
  });

  it("returns an empty list when the --since window excludes every commit", () => {
    commit({ "src/a.ts": "a\n" }, "first");
    expect(getChangedFilesSince(repoRoot, "2099-01-01")).toEqual([]);
  });
});
