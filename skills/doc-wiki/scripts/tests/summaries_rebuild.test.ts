/**
 * Tests for summaries_rebuild.ts — the deterministic summaries.md regenerator.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import {
  rebuildSummaries,
  START_MARKER,
  END_MARKER,
} from "../summaries_rebuild.js";
import {
  SCRIPTS_DIR,
  cleanupTmpPath,
  makeInitializedWiki,
  makeTmpPath,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "summaries_rebuild.js");

function writePage(
  wiki: string,
  relFromWikiDir: string,
  fm: Record<string, unknown>,
  body: string = "Body text.\n",
): string {
  const full = path.join(wiki, "wiki", relFromWikiDir);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "---\n" + yaml.dump(fm) + "---\n\n" + body);
  return full;
}

function writeClaim(
  wiki: string,
  relFromClaims: string,
  fm: Record<string, unknown>,
): string {
  return writePage(wiki, path.join("claims", relFromClaims), fm, "Claim body.\n");
}

function readSummaries(wiki: string): string {
  return fs.readFileSync(path.join(wiki, "wiki", "summaries.md"), {
    encoding: "utf-8",
  });
}

describe("rebuildSummaries", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summaries-rebuild-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("creates an empty-pages managed block when no pages exist", () => {
    rebuildSummaries(wiki);
    const content = readSummaries(wiki);
    expect(content).toContain(START_MARKER);
    expect(content).toContain(END_MARKER);
    expect(content).toContain("_No pages yet._");
  });

  it("emits one bullet per page in alphabetical order", () => {
    writePage(wiki, "alpha.md", {
      title: "Alpha",
      summary: "First page about alpha things.",
      tags: ["alpha-tag"],
    });
    writePage(wiki, "beta/gamma.md", {
      title: "Gamma",
      summary: "Page about gamma topics under beta.",
      tags: ["gamma-tag", "nested"],
    });
    rebuildSummaries(wiki);
    const content = readSummaries(wiki);
    expect(content).toContain("[Alpha](alpha.md)");
    expect(content).toContain("[Gamma](beta/gamma.md)");
    expect(content).toContain("First page about alpha things.");
    expect(content).toContain("tags: gamma-tag, nested");
    // Alphabetical by path: alpha.md comes before beta/gamma.md.
    const idxAlpha = content.indexOf("[Alpha]");
    const idxGamma = content.indexOf("[Gamma]");
    expect(idxAlpha).toBeGreaterThan(0);
    expect(idxAlpha).toBeLessThan(idxGamma);
  });

  it("skips wiki/index.md and wiki/summaries.md themselves", () => {
    writePage(wiki, "real-page.md", {
      title: "Real",
      summary: "A real page.",
    });
    rebuildSummaries(wiki);
    const content = readSummaries(wiki);
    expect(content).toContain("[Real]");
    expect(content).not.toContain("](index.md)");
    expect(content).not.toContain("](summaries.md)");
  });

  it("falls back to filename when title is missing", () => {
    writePage(wiki, "no-title.md", {
      summary: "Title is absent from frontmatter.",
    });
    rebuildSummaries(wiki);
    expect(readSummaries(wiki)).toContain("[no-title](no-title.md)");
  });

  it("truncates summaries longer than max-summary-chars with ellipsis", () => {
    const long = "word ".repeat(200).trim();
    writePage(wiki, "long.md", { title: "Long", summary: long });
    rebuildSummaries(wiki, { maxSummaryChars: 50 });
    const content = readSummaries(wiki);
    expect(content).toContain("\u2026");
    const line = content.split("\n").find((l) => l.includes("[Long]"));
    expect(line).toBeDefined();
    // Line length is "- [Long](long.md) — " + <=50 chars.
    expect((line ?? "").length).toBeLessThanOrEqual(80);
  });

  it("splices the anti-repetition banlist when deprecated claims exist", () => {
    writePage(wiki, "live.md", { title: "Live", summary: "Active page." });
    writeClaim(wiki, "dead-end.md", {
      title: "Abandoned direction",
      status: "deprecated",
      failure_reason: "Benchmarks showed regression",
      updated: "2026-04-10",
    });
    rebuildSummaries(wiki);
    const content = readSummaries(wiki);
    expect(content).toContain("## Anti-repetition Memory");
    expect(content).toContain("Abandoned direction");
    expect(content).toContain("Benchmarks showed regression");
  });

  it("omits the banlist heading when there are no deprecated claims", () => {
    writePage(wiki, "p.md", { title: "P", summary: "s" });
    rebuildSummaries(wiki);
    expect(readSummaries(wiki)).not.toContain("## Anti-repetition Memory");
  });

  it("preserves human-written content above and below the markers", () => {
    const preamble = "# My Hand-Written Heading\n\nIntro paragraph kept by the user.\n";
    const footer = "\n## Footer\n\nMore user content.\n";
    fs.writeFileSync(
      path.join(wiki, "wiki", "summaries.md"),
      preamble +
        "\n" +
        START_MARKER +
        "\n\nstale old content to be replaced\n\n" +
        END_MARKER +
        footer,
    );
    writePage(wiki, "p.md", { title: "P", summary: "Page p." });
    rebuildSummaries(wiki);
    const content = readSummaries(wiki);
    expect(content).toContain("# My Hand-Written Heading");
    expect(content).toContain("Intro paragraph kept by the user.");
    expect(content).toContain("## Footer");
    expect(content).toContain("More user content.");
    expect(content).toContain("[P](p.md)");
    expect(content).not.toContain("stale old content");
  });

  it("appends managed block when markers are missing", () => {
    fs.writeFileSync(
      path.join(wiki, "wiki", "summaries.md"),
      "# Existing Summary File\n\nUser-written body.\n",
    );
    writePage(wiki, "p.md", { title: "P", summary: "Page p." });
    rebuildSummaries(wiki);
    const content = readSummaries(wiki);
    expect(content.startsWith("# Existing Summary File")).toBe(true);
    expect(content).toContain("User-written body.");
    expect(content).toContain(START_MARKER);
    expect(content).toContain(END_MARKER);
    expect(content).toContain("[P](p.md)");
  });

  it("is idempotent — running twice produces the same file", () => {
    writePage(wiki, "a.md", { title: "A", summary: "Apple." });
    writePage(wiki, "b.md", { title: "B", summary: "Banana." });
    rebuildSummaries(wiki);
    const first = readSummaries(wiki);
    rebuildSummaries(wiki);
    const second = readSummaries(wiki);
    expect(second).toBe(first);
  });

  it("creates summaries.md when it is missing", () => {
    fs.rmSync(path.join(wiki, "wiki", "summaries.md"));
    writePage(wiki, "p.md", { title: "P", summary: "Page p." });
    rebuildSummaries(wiki);
    expect(fs.existsSync(path.join(wiki, "wiki", "summaries.md"))).toBe(true);
  });
});

describe("summaries_rebuild CLI", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summaries-rebuild-cli-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("node", [CLI, ...args], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return {
        status: e.status ?? 1,
        stdout: e.stdout?.toString("utf-8") ?? "",
        stderr: e.stderr?.toString("utf-8") ?? "",
      };
    }
  }

  it("writes summaries.md and prints the path", () => {
    writePage(wiki, "p.md", { title: "P", summary: "Page p." });
    const result = runCli(["--wiki-root", wiki]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("summaries.md");
    expect(readSummaries(wiki)).toContain("[P](p.md)");
  });

  it("exits 2 on missing --wiki-root", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--wiki-root");
  });

  it("exits 2 on non-numeric --max-summary-chars", () => {
    const result = runCli(["--wiki-root", wiki, "--max-summary-chars", "not-a-number"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--max-summary-chars");
  });

  it("shows help on --help", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usage:");
  });
});

// ── Archive exclusion ──────────────────────────────────────────────

describe("summaries_rebuild archive exclusion", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summaries-archive-");
    wiki = makeInitializedWiki(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("archived pages do not appear in summaries.md", () => {
    writePage(wiki, "live/page.md", {
      title: "Live Page",
      summary: "A live page summary.",
      tags: ["live"],
    });
    writePage(wiki, "_archive/old/page.md", {
      title: "Archived Page",
      summary: "An archived page summary.",
      tags: ["archived"],
    });
    rebuildSummaries(wiki);
    const content = readSummaries(wiki);
    expect(content).toContain("[Live Page](live/page.md)");
    expect(content).not.toContain("Archived Page");
    expect(content).not.toContain("_archive");
  });
});
