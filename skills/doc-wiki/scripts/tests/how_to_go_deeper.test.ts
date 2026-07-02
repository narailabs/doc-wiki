/**
 * Tests for how_to_go_deeper.ts — the "How to Go Deeper" section builder.
 *
 * Hint format is uniform: `/doc-wiki:ingest "<source>"` for any matched
 * source. The wiki ingest pipeline routes to the right connector via
 * `gather()`. Service-specific CLI hints (e.g. `wiki agent jira`) are
 * gone — they were a vestige of the per-service wrappers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildHowToGoDeeper,
  classifySource,
  _resetRegistry,
  type AgentId,
} from "../how_to_go_deeper.js";
import { SCRIPTS_DIR, makeTmpPath, cleanupTmpPath } from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "how_to_go_deeper.js");

describe("buildHowToGoDeeper", () => {
  it("returns empty string when sources is empty", () => {
    expect(buildHowToGoDeeper([])).toBe("");
  });

  it("returns empty string when all sources are local raw/ ingests", () => {
    const sources = ["raw/auth/overview.md", "raw/auth/jwt.md"];
    expect(buildHowToGoDeeper(sources)).toBe("");
  });

  it("renders a jira:// scheme as a /doc-wiki:ingest hint", () => {
    const out = buildHowToGoDeeper(["jira://AUTH-123"]);
    expect(out).toContain("## How to Go Deeper");
    expect(out).toContain("**Jira:**");
    expect(out).toContain("/doc-wiki:ingest");
    expect(out).toContain("jira://AUTH-123");
  });

  it("renders a Jira atlassian URL", () => {
    const out = buildHowToGoDeeper([
      "https://company.atlassian.net/browse/AUTH-456",
    ]);
    expect(out).toContain("**Jira:**");
    expect(out).toContain("/doc-wiki:ingest");
    expect(out).toContain("https://company.atlassian.net/browse/AUTH-456");
  });

  it("renders a Confluence URL", () => {
    const out = buildHowToGoDeeper([
      "https://company.atlassian.net/wiki/spaces/ARCH/pages/123",
    ]);
    expect(out).toContain("**Confluence:**");
    expect(out).toContain("/doc-wiki:ingest");
  });

  it("renders a GitHub URL", () => {
    const out = buildHowToGoDeeper(["https://github.com/org/repo/pull/42"]);
    expect(out).toContain("**GitHub:**");
    expect(out).toContain("/doc-wiki:ingest");
    expect(out).toContain("https://github.com/org/repo/pull/42");
  });

  it("renders a Notion URL", () => {
    const out = buildHowToGoDeeper(["https://notion.so/page-abc123"]);
    expect(out).toContain("**Notion:**");
    expect(out).toContain("/doc-wiki:ingest");
  });

  it("renders a GCP URL", () => {
    const out = buildHowToGoDeeper(["https://console.cloud.google.com/run"]);
    expect(out).toContain("**GCP:**");
    expect(out).toContain("/doc-wiki:ingest");
  });

  it("renders an AWS URL", () => {
    const out = buildHowToGoDeeper(["https://console.aws.amazon.com/lambda"]);
    expect(out).toContain("**AWS:**");
    expect(out).toContain("/doc-wiki:ingest");
  });

  it("renders a db:// scheme as a /doc-wiki:ingest hint", () => {
    const out = buildHowToGoDeeper(["db://dev/users"]);
    expect(out).toContain("**Database:**");
    expect(out).toContain("/doc-wiki:ingest");
    expect(out).toContain("db://dev/users");
  });

  it("renders a code-file reference with line range", () => {
    const out = buildHowToGoDeeper(["src/auth/session.py:42-58"]);
    expect(out).toContain("**Live code:**");
    expect(out).toContain("src/auth/session.py:42-58");
  });

  it("emits a fallback bullet for unknown URLs", () => {
    const out = buildHowToGoDeeper(["https://example.org/some-article"]);
    expect(out).toContain("**External link:**");
    expect(out).toContain("example.org");
  });

  it("deduplicates repeated sources", () => {
    const out = buildHowToGoDeeper([
      "jira://AUTH-1",
      "jira://AUTH-1",
      "jira://AUTH-2",
    ]);
    const firstBullets = out.match(/^- /gm)?.length ?? 0;
    expect(firstBullets).toBe(2);
  });

  it("falls back to a disabled-connector hint when enabledAgents excludes the provider", () => {
    const enabled = new Set<AgentId>(["github"]);
    const out = buildHowToGoDeeper(["jira://AUTH-123"], {
      enabledAgents: enabled,
    });
    expect(out).toContain("enable the `jira` connector");
    expect(out).toContain(".connectors/config.yaml");
    // No /doc-wiki:ingest hint when the connector is disabled
    expect(out).not.toContain("`/doc-wiki:ingest \"jira://AUTH-123\"`");
  });

  it("keeps enabled-connector bullets even when others are disabled", () => {
    const enabled = new Set<AgentId>(["github"]);
    const out = buildHowToGoDeeper(
      ["jira://AUTH-1", "gh://org/repo/issues/42"],
      { enabledAgents: enabled },
    );
    expect(out).toContain("enable the `jira` connector");
    expect(out).toContain("/doc-wiki:ingest");
    expect(out).toContain("gh://org/repo/issues/42");
  });

  it("mixes Jira + local-code + raw/ correctly — raw/ is elided", () => {
    const out = buildHowToGoDeeper([
      "raw/auth/notes.md",
      "jira://AUTH-1",
      "src/auth/session.py:10-30",
    ]);
    expect(out).toContain("**Jira:**");
    expect(out).toContain("**Live code:**");
    expect(out).not.toContain("raw/auth/notes.md");
  });
});

describe("classifySource (unit)", () => {
  it("returns null for empty and raw/ sources", () => {
    expect(classifySource("")).toBeNull();
    expect(classifySource("  ")).toBeNull();
    expect(classifySource("raw/topic/source.md")).toBeNull();
  });

  it("classifies gh:// and github:// interchangeably", () => {
    const a = classifySource("gh://org/repo/issues/1");
    const b = classifySource("github://org/repo/issues/1");
    expect(a?.agent).toBe("github");
    expect(b?.agent).toBe("github");
  });

  it("returns a generic file-read hint for non-code relative paths", () => {
    const entry = classifySource("docs/reference/api.md");
    expect(entry).not.toBeNull();
    expect(entry?.label).toBe("Source file");
  });
});

describe("how_to_go_deeper CLI", () => {
  beforeEach(() => {
    // no-op; CLI is stateless
  });
  afterEach(() => {
    // no-op
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

  it("writes the rendered section to stdout", () => {
    const result = runCli([
      "--sources",
      JSON.stringify(["jira://AUTH-1", "src/a.py:1-10"]),
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("## How to Go Deeper");
    expect(result.stdout).toContain("**Jira:**");
    expect(result.stdout).toContain("**Live code:**");
  });

  it("respects --enabled filter", () => {
    const result = runCli([
      "--sources",
      JSON.stringify(["jira://AUTH-1"]),
      "--enabled",
      "github",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("enable the `jira` connector");
  });

  it("exits 2 when --sources is missing", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--sources");
  });

  it("exits 2 when --sources is not valid JSON", () => {
    const result = runCli(["--sources", "not-json"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("valid JSON");
  });

  it("exits 2 when --sources is not an array of strings", () => {
    const result = runCli(["--sources", JSON.stringify([1, 2, 3])]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("array of strings");
  });
});

// ── Custom agents from wiki.config.yaml ──────────────────────────────

describe("custom agents from wiki.config.yaml", () => {
  let tmpDir: string;
  let prevCwd: string;

  const CUSTOM_CONFIG = [
    "wiki:",
    "  name: test-wiki",
    "ecosystem:",
    "  agents:",
    "    custom:",
    "      - name: kb",
    '        source_schemes: ["kb://"]',
    "        invocation_template:",
    "          label: Knowledge Base",
    "",
  ].join("\n");

  beforeEach(() => {
    tmpDir = makeTmpPath();
    prevCwd = process.cwd();
    _resetRegistry();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    _resetRegistry();
    cleanupTmpPath(tmpDir);
  });

  it("classifies a custom scheme registered in <cwd>/wiki.config.yaml", () => {
    fs.writeFileSync(path.join(tmpDir, "wiki.config.yaml"), CUSTOM_CONFIG);
    process.chdir(tmpDir);
    const out = buildHowToGoDeeper(["kb://article-42"]);
    expect(out).toContain("**Knowledge Base:**");
    expect(out).toContain('/doc-wiki:ingest "kb://article-42"');
  });

  it("skips malformed custom entries without failing the run", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      fs.writeFileSync(
        path.join(tmpDir, "wiki.config.yaml"),
        [
          "wiki:",
          "  name: test-wiki",
          "ecosystem:",
          "  agents:",
          "    custom:",
          '      - source_schemes: ["broken://"]', // missing name
          "      - name: kb",
          '        source_schemes: ["kb://"]',
          "        invocation_template:",
          "          label: Knowledge Base",
          "",
        ].join("\n"),
      );
      process.chdir(tmpDir);
      const out = buildHowToGoDeeper(["kb://article-42", "jira://AUTH-1"]);
      expect(out).toContain("**Knowledge Base:**");
      expect(out).toContain("**Jira:**");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("stays builtins-only when no wiki.config.yaml is present", () => {
    process.chdir(tmpDir);
    // Unmatched scheme falls through to the local-path classifier
    expect(classifySource("kb://article-42")?.agent).toBeUndefined();
    expect(classifySource("jira://AUTH-1")?.agent).toBe("jira");
  });

  it("buildHowToGoDeeper honors the wikiRoot option when config is not in cwd", () => {
    fs.writeFileSync(path.join(tmpDir, "wiki.config.yaml"), CUSTOM_CONFIG);
    // No chdir — the wiki root differs from the process cwd
    const out = buildHowToGoDeeper(["kb://article-42"], { wikiRoot: tmpDir });
    expect(out).toContain("**Knowledge Base:**");
    expect(out).toContain('/doc-wiki:ingest "kb://article-42"');
  });

  it("CLI picks up custom agents from the working directory", () => {
    fs.writeFileSync(path.join(tmpDir, "wiki.config.yaml"), CUSTOM_CONFIG);
    const stdout = execFileSync(
      "node",
      [CLI, "--sources", JSON.stringify(["kb://article-42"])],
      { encoding: "utf-8", cwd: tmpDir },
    );
    expect(stdout).toContain("**Knowledge Base:**");
    expect(stdout).toContain('/doc-wiki:ingest "kb://article-42"');
  });

  it("CLI honors --wiki-root when invoked from a different cwd", () => {
    fs.writeFileSync(path.join(tmpDir, "wiki.config.yaml"), CUSTOM_CONFIG);
    // cwd stays at the repo root — the ingest/atlas invocation pattern
    const stdout = execFileSync(
      "node",
      [CLI, "--sources", JSON.stringify(["kb://article-42"]), "--wiki-root", tmpDir],
      { encoding: "utf-8" },
    );
    expect(stdout).toContain("**Knowledge Base:**");
    expect(stdout).toContain('/doc-wiki:ingest "kb://article-42"');
  });
});
