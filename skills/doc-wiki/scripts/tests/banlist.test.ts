/**
 * Tests for banlist.ts — the anti-repetition memory harvester for G13.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import { buildBanlistSection } from "../banlist.js";
import {
  SCRIPTS_DIR,
  cleanupTmpPath,
  makeInitializedWiki,
  makeTmpPath,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "banlist.js");

function writeClaim(
  wiki: string,
  relFromClaims: string,
  fm: Record<string, unknown>,
  body: string = "Body text.\n",
): string {
  const full = path.join(wiki, "wiki", "claims", relFromClaims);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "---\n" + yaml.dump(fm) + "---\n\n" + body);
  return full;
}

describe("buildBanlistSection", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("banlist-");
    wiki = makeInitializedWiki(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns empty string when claims dir is missing", () => {
    expect(buildBanlistSection(wiki)).toBe("");
  });

  it("returns empty string when no claims are deprecated", () => {
    writeClaim(wiki, "live-claim.md", {
      title: "Active Claim",
      status: "supported",
      confidence: 0.9,
      updated: "2026-04-10",
    });
    expect(buildBanlistSection(wiki)).toBe("");
  });

  it("includes deprecated claims with non-empty failure_reason", () => {
    writeClaim(wiki, "dead-end.md", {
      title: "Attempted X approach",
      status: "deprecated",
      confidence: 0.1,
      failure_reason: "Contradicts §3 of RFC-42",
      updated: "2026-03-01",
    });
    writeClaim(wiki, "another.md", {
      title: "Tried Y",
      status: "deprecated",
      confidence: 0.0,
      failure_reason: "Benchmarks show 4x regression",
      updated: "2026-04-05",
    });
    const section = buildBanlistSection(wiki);
    expect(section).toContain("## Anti-repetition Memory");
    expect(section).toContain("Attempted X approach");
    expect(section).toContain("Contradicts §3 of RFC-42");
    expect(section).toContain("Tried Y");
    expect(section).toContain("Benchmarks show 4x regression");
    // Freshest first (2026-04-05 before 2026-03-01).
    const idxFresh = section.indexOf("Tried Y");
    const idxOlder = section.indexOf("Attempted X approach");
    expect(idxFresh).toBeGreaterThan(0);
    expect(idxFresh).toBeLessThan(idxOlder);
  });

  it("skips deprecated claims whose failure_reason is missing or blank", () => {
    writeClaim(wiki, "blank-reason.md", {
      title: "No reason",
      status: "deprecated",
      confidence: 0.0,
      failure_reason: "   ",
      updated: "2026-04-01",
    });
    writeClaim(wiki, "no-field.md", {
      title: "Missing field",
      status: "deprecated",
      confidence: 0.0,
      updated: "2026-04-01",
    });
    expect(buildBanlistSection(wiki)).toBe("");
  });

  it("caps entries at maxEntries", () => {
    for (let i = 0; i < 5; i++) {
      writeClaim(wiki, `c${i}.md`, {
        title: `Claim ${i}`,
        status: "deprecated",
        confidence: 0.0,
        failure_reason: `reason ${i}`,
        updated: `2026-01-0${i + 1}`,
      });
    }
    const section = buildBanlistSection(wiki, 2);
    const bulletCount = section.match(/^- \[/gm)?.length ?? 0;
    expect(bulletCount).toBe(2);
  });

  it("escapes pipe characters in failure_reason", () => {
    writeClaim(wiki, "pipes.md", {
      title: "Pipe claim",
      status: "deprecated",
      failure_reason: "bad | reason | text",
      updated: "2026-04-01",
    });
    const section = buildBanlistSection(wiki);
    expect(section).toContain("bad \\| reason \\| text");
  });

  it("uses filename when title is missing", () => {
    writeClaim(wiki, "no-title-fallback.md", {
      status: "deprecated",
      failure_reason: "no title available",
      updated: "2026-04-01",
    });
    const section = buildBanlistSection(wiki);
    expect(section).toContain("[no-title-fallback]");
  });
});

describe("banlist CLI", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("banlist-cli-");
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

  it("build emits the section to stdout", () => {
    writeClaim(wiki, "one.md", {
      title: "One",
      status: "deprecated",
      failure_reason: "bad idea",
      updated: "2026-04-01",
    });
    const result = runCli(["build", "--wiki-root", wiki]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("## Anti-repetition Memory");
    expect(result.stdout).toContain("One");
  });

  it("exits 2 on missing --wiki-root", () => {
    const result = runCli(["build"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--wiki-root");
  });

  it("exits 2 on unknown subcommand", () => {
    const result = runCli(["nope", "--wiki-root", wiki]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/unknown subcommand|build/);
  });

  it("shows help when invoked with no args", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("usage:");
  });
});
