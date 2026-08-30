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

import {
  classifyChanges,
  indexAtlasPages,
  getLastAtlasTimestamp,
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

  // The fast path narrowed from `line.includes('"atlas"')` to a match on the
  // `op` field. These pin both directions: the shapes that must still be read,
  // and the rows that must now be skipped without a parse.
  it("reads compact op rows (JSON.stringify shape)", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      '{"op":"atlas","timestamp":"2026-04-29T10:00:00+00:00"}\n',
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBe("2026-04-29T10:00:00+00:00");
  });

  it("reads spaced op rows (Python json.dumps shape)", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      '{"op": "atlas", "timestamp": "2026-04-29T10:00:00+00:00"}\n',
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBe("2026-04-29T10:00:00+00:00");
  });

  it("ignores a non-atlas row that merely mentions atlas in details", () => {
    // The old substring check fired here and paid for a parse the op check
    // below then rejected. The result was always null; only the cost changed.
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      JSON.stringify({
        op: "ingest",
        timestamp: "2026-04-29T10:00:00+00:00",
        details: { note: "ran after atlas" },
      }) + "\n",
    );
    expect(getLastAtlasTimestamp(wikiRoot)).toBeNull();
  });

  it("is not fooled by an atlas mention inside a details string", () => {
    fs.writeFileSync(
      path.join(wikiRoot, "log", "events.jsonl"),
      JSON.stringify({
        op: "lint",
        timestamp: "2026-04-30T10:00:00+00:00",
        details: { message: 'saw "op":"atlas" in a log excerpt' },
      }) + "\n" +
        JSON.stringify({ op: "atlas", timestamp: "2026-04-28T09:00:00+00:00" }) +
        "\n",
    );
    // The lint row trips the fast path, but the authoritative rec["op"]
    // check rejects it, so the real atlas row still wins.
    expect(getLastAtlasTimestamp(wikiRoot)).toBe("2026-04-28T09:00:00+00:00");
  });
});
