/**
 * Tests for claude_md_gen.ts — ported from test_claude_md_gen.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled claude_md_gen.js via Node.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  generateClaudeMd,
  updateClaudeMd,
  extractManagedSection,
  listSubmodules,
  MarkerCorruptError,
  MARKER_START,
  MARKER_END,
} from "../claude_md_gen.js";

const SCRIPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const CLI = path.join(SCRIPTS_DIR, "claude_md_gen.js");

function runCli(
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      stdout:
        typeof err.stdout === "string"
          ? err.stdout
          : (err.stdout?.toString("utf-8") ?? ""),
      stderr:
        typeof err.stderr === "string"
          ? err.stderr
          : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

// ── Fixtures ────────────────────────────────────────────────────────

function makeTmpPath(prefix: string = "claude-md-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTmpPath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Create a minimal project root with a wiki directory. */
function makeProjectRoot(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, "index.md"), "# Wiki Index\n");
  return tmpPath;
}

/** Project root with two submodule directories that each have CLAUDE.md. */
function makeProjectWithSubmodules(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, "index.md"), "# Wiki Index\n");

  for (const name of ["services/auth", "services/billing"]) {
    const sub = path.join(tmpPath, name);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, "CLAUDE.md"),
      `# ${name}\n\nCustom content.\n`,
    );
  }
  return tmpPath;
}

/** Produce a CLAUDE.md file with user sections and wiki-managed markers. */
function makeClaudeMdWithMarkers(tmpPath: string): string {
  const p = path.join(tmpPath, "CLAUDE.md");
  fs.writeFileSync(
    p,
    "# My Project\n\n" +
      "Custom intro that should be preserved.\n\n" +
      "<!-- wiki-managed: start -->\n" +
      "## Overview\n\nOld generated overview.\n" +
      "<!-- wiki-managed: end -->\n\n" +
      "## My Custom Section\n\nThis is hand-written.\n",
  );
  return p;
}

/** Produce a CLAUDE.md file with no wiki-managed markers. */
function makeClaudeMdWithoutMarkers(tmpPath: string): string {
  const p = path.join(tmpPath, "CLAUDE.md");
  fs.writeFileSync(
    p,
    "# My Project\n\nAll custom content, no managed sections.\n",
  );
  return p;
}

// ── generate_claude_md tests ──────────────────────────────────────

describe("TestGenerateClaudeMd", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_generate_basic", () => {
    const root = makeProjectRoot(tmpPath);
    const result = generateClaudeMd(root, path.join(root, "wiki"));
    expect(result.includes("<!-- wiki-managed: start -->")).toBe(true);
    expect(result.includes("<!-- wiki-managed: end -->")).toBe(true);
  });

  it("test_generate_with_wiki_link", () => {
    const root = makeProjectRoot(tmpPath);
    const result = generateClaudeMd(root, path.join(root, "wiki"));
    expect(result.toLowerCase().includes("wiki")).toBe(true);
    // Should contain a markdown link to the wiki
    expect(result.includes("[") && result.includes("](")).toBe(true);
  });

  it("test_generate_with_submodule", () => {
    const root = makeProjectWithSubmodules(tmpPath);
    const result = generateClaudeMd(
      root,
      path.join(root, "wiki"),
      "services/auth",
    );
    expect(result.includes("<!-- wiki-managed: start -->")).toBe(true);
    // Should reference the root CLAUDE.md
    expect(result.includes("CLAUDE.md")).toBe(true);
  });
});

// ── update_claude_md tests ────────────────────────────────────────

describe("TestUpdateClaudeMd", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_update_preserves_user_sections", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const newManaged = "## Overview\n\nNew generated overview.\n";
    const result = updateClaudeMd(file, newManaged);
    expect(result.includes("Custom intro that should be preserved.")).toBe(true);
    expect(result.includes("## My Custom Section")).toBe(true);
    expect(result.includes("This is hand-written.")).toBe(true);
  });

  it("test_update_replaces_managed_section", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const newManaged = "## Overview\n\nBrand new overview content.\n";
    const result = updateClaudeMd(file, newManaged);
    expect(result.includes("Brand new overview content.")).toBe(true);
    expect(result.includes("Old generated overview.")).toBe(false);
  });

  it("test_idempotent_update", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const newManaged = "## Overview\n\nStable content.\n";
    const first = updateClaudeMd(file, newManaged);
    fs.writeFileSync(file, first);
    const second = updateClaudeMd(file, newManaged);
    expect(first).toBe(second);
  });

  it("test_handles_missing_file", () => {
    const missing = path.join(tmpPath, "nonexistent", "CLAUDE.md");
    const newManaged = "## Overview\n\nFresh content.\n";
    const result = updateClaudeMd(missing, newManaged);
    expect(result.includes("<!-- wiki-managed: start -->")).toBe(true);
    expect(result.includes("<!-- wiki-managed: end -->")).toBe(true);
    expect(result.includes("Fresh content.")).toBe(true);
  });
});

// ── extract_managed_section tests ────────────────────────────────

describe("TestExtractManagedSection", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_extract_managed_section", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const content = fs.readFileSync(file, { encoding: "utf-8" });
    const section = extractManagedSection(content);
    expect(section).not.toBeNull();
    expect(section?.includes("Old generated overview.")).toBe(true);
  });

  it("test_extract_no_markers", () => {
    const file = makeClaudeMdWithoutMarkers(tmpPath);
    const content = fs.readFileSync(file, { encoding: "utf-8" });
    expect(extractManagedSection(content)).toBeNull();
  });
});

// ── list_submodules tests ─────────────────────────────────────────

describe("TestListSubmodules", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_list_submodules", () => {
    const root = makeProjectWithSubmodules(tmpPath);
    const result = listSubmodules(root);
    expect(result).toHaveLength(2);
    const names = [...result].sort();
    expect(names.includes("services/auth")).toBe(true);
    expect(names.includes("services/billing")).toBe(true);
  });

  it("test_list_submodules_empty", () => {
    const root = makeProjectRoot(tmpPath);
    const result = listSubmodules(root);
    expect(result).toEqual([]);
  });
});

// ── CLI tests ─────────────────────────────────────────────────────

describe("TestClaudeMdGenCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_project_root", () => {
    const root = makeProjectRoot(tmpPath);
    const { stdout, status } = runCli([
      "--project-root",
      root,
      "--wiki-root",
      path.join(root, "wiki"),
    ]);
    expect(status).toBe(0);
    expect(stdout.includes("<!-- wiki-managed: start -->")).toBe(true);
  });

  it("test_cli_update", () => {
    const file = makeClaudeMdWithMarkers(tmpPath);
    const projectRoot = path.dirname(file);
    const wikiDir = path.join(projectRoot, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "index.md"), "# Wiki Index\n");

    const { status } = runCli([
      "--project-root",
      projectRoot,
      "--wiki-root",
      wikiDir,
      "--update",
      file,
    ]);
    expect(status).toBe(0);
    const updated = fs.readFileSync(file, { encoding: "utf-8" });
    expect(updated.includes("Custom intro that should be preserved.")).toBe(true);
    expect(updated.includes("<!-- wiki-managed: start -->")).toBe(true);
  });
});

// ======================================================================
// G-CLAUDE-MD-MARKER: balanced-marker validation
// ======================================================================

describe("marker validation (G-CLAUDE-MD-MARKER)", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("marker-corrupt-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("start marker without end marker throws MarkerCorruptError", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `# Project\n\n${MARKER_START}\ndangling\n`,
      "utf-8",
    );
    expect(() => updateClaudeMd(file, "new content")).toThrow(
      MarkerCorruptError,
    );
    // File is not mutated.
    const after = fs.readFileSync(file, "utf-8");
    expect(after).toContain("dangling");
    expect(after).not.toContain("new content");
  });

  it("end marker without start marker throws MarkerCorruptError", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `# Project\n\n${MARKER_END}\ntrailing\n`,
      "utf-8",
    );
    expect(() => updateClaudeMd(file, "new content")).toThrow(
      MarkerCorruptError,
    );
  });

  it("duplicate start markers throws MarkerCorruptError", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `${MARKER_START}\nfirst\n${MARKER_END}\n\n${MARKER_START}\nsecond\n${MARKER_END}\n`,
      "utf-8",
    );
    let err: unknown;
    try {
      updateClaudeMd(file, "new");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MarkerCorruptError);
    const mce = err as MarkerCorruptError;
    expect(mce.error_code).toBe("MARKER_CORRUPT");
    expect(mce.starts).toBe(2);
    expect(mce.ends).toBe(2);
  });

  it("clean file (no markers) appends without error", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(file, "# Project\n\nUser prose.\n", "utf-8");
    const result = updateClaudeMd(file, "managed body");
    expect(result).toContain("User prose.");
    expect(result).toContain(MARKER_START);
    expect(result).toContain("managed body");
    expect(result).toContain(MARKER_END);
  });

  it("balanced markers (1 + 1) replaces managed section", () => {
    const file = path.join(tmpPath, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `${MARKER_START}\nold body\n${MARKER_END}\n\n## User\nkeep me\n`,
      "utf-8",
    );
    const result = updateClaudeMd(file, "new body");
    expect(result).toContain("new body");
    expect(result).not.toContain("old body");
    expect(result).toContain("keep me");
  });

  it("CLI emits MARKER_CORRUPT JSON and exits 1 on corrupted markers", () => {
    const projectRoot = makeProjectRoot(tmpPath);
    const file = path.join(projectRoot, "CLAUDE.md");
    fs.writeFileSync(
      file,
      `# Project\n\n${MARKER_START}\nunclosed\n`,
      "utf-8",
    );
    const { stdout, status } = runCli([
      "--project-root",
      projectRoot,
      "--wiki-root",
      path.join(projectRoot, "wiki"),
      "--update",
      file,
    ]);
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as {
      status: string;
      error_code: string;
      details: { starts: number; ends: number };
    };
    expect(parsed.status).toBe("error");
    expect(parsed.error_code).toBe("MARKER_CORRUPT");
    expect(parsed.details.starts).toBe(1);
    expect(parsed.details.ends).toBe(0);
    // File remains unchanged
    const after = fs.readFileSync(file, "utf-8");
    expect(after).toContain("unclosed");
  });
});
