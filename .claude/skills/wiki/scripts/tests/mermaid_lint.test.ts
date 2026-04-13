/**
 * Tests for mermaid_lint.ts — ported from test_mermaid_lint.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled mermaid_lint.js via Node.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  extractMermaidBlocks,
  validateBlock,
  lintPage,
  lintWikiMermaid,
} from "../mermaid_lint.js";
import {
  SCRIPTS_DIR,
  makeTmpPath,
  cleanupTmpPath,
  makeWikiWithPages,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "mermaid_lint.js");

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

// ── Fixture helpers ─────────────────────────────────────────────────

/** Mirrors the `page_with_valid_mermaid` pytest fixture. */
function makePageWithValidMermaid(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  const p = path.join(wikiDir, "valid.md");
  fs.writeFileSync(
    p,
    "---\ntitle: Valid\n---\n\n" +
      "# Valid Page\n\n" +
      "Some text.\n\n" +
      "```mermaid\n" +
      "erDiagram\n" +
      "    users ||--o{ orders : has\n" +
      "```\n",
  );
  return p;
}

/** Mirrors the `page_with_invalid_mermaid` pytest fixture. */
function makePageWithInvalidMermaid(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  const p = path.join(wikiDir, "invalid.md");
  fs.writeFileSync(
    p,
    "---\ntitle: Invalid\n---\n\n" +
      "```mermaid\n" +
      "unknownDiagram\n" +
      "    A -> B\n" +
      "```\n",
  );
  return p;
}

/** Mirrors the `page_no_mermaid` pytest fixture. */
function makePageNoMermaid(tmpPath: string): string {
  const wikiDir = path.join(tmpPath, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  const p = path.join(wikiDir, "plain.md");
  fs.writeFileSync(
    p,
    "---\ntitle: Plain\n---\n\n# Just text\n\nNo diagrams here.\n",
  );
  return p;
}

// ── extractMermaidBlocks tests ──────────────────────────────────────

describe("TestExtractMermaidBlocks", () => {
  it("test_single_block", () => {
    const content =
      "# Title\n\n```mermaid\nerDiagram\n    A ||--o{ B : has\n```\n";
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(1);
    const first = blocks[0];
    expect(first).toBeDefined();
    expect(first?.diagram_type).toBe("erDiagram");
    expect(first?.content.includes("A ||--o{ B")).toBe(true);
  });

  it("test_multiple_blocks", () => {
    const content =
      "```mermaid\nerDiagram\n    A ||--o{ B : has\n```\n\n" +
      "Some text\n\n" +
      "```mermaid\nsequenceDiagram\n    A->>B: msg\n```\n\n" +
      "```mermaid\ngraph TD\n    A --> B\n```\n";
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(3);
  });

  it("test_no_blocks", () => {
    const content = "# Just text\n\nNo diagrams.\n";
    expect(extractMermaidBlocks(content)).toEqual([]);
  });

  it("test_non_mermaid_code_blocks", () => {
    const content = "```python\nprint('hello')\n```\n\n```json\n{}\n```\n";
    expect(extractMermaidBlocks(content)).toEqual([]);
  });

  it("test_line_numbers", () => {
    const content = "line 1\nline 2\n```mermaid\nerDiagram\n```\nline 6\n";
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(1);
    const first = blocks[0];
    expect(first).toBeDefined();
    expect(first?.line).toBe(3);
  });
});

// ── validateBlock tests ────────────────────────────────────────────

describe("TestValidateBlock", () => {
  it("test_valid_er_diagram", () => {
    const block = "erDiagram\n    users ||--o{ orders : has\n";
    expect(validateBlock(block)).toEqual([]);
  });

  it("test_valid_sequence_diagram", () => {
    const block =
      "sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi\n";
    expect(validateBlock(block)).toEqual([]);
  });

  it("test_valid_graph", () => {
    const block = "graph TD\n    A --> B\n    B --> C\n";
    expect(validateBlock(block)).toEqual([]);
  });

  it("test_valid_flowchart", () => {
    const block = "flowchart LR\n    A --> B\n";
    expect(validateBlock(block)).toEqual([]);
  });

  it("test_valid_class_diagram", () => {
    const block = "classDiagram\n    class Animal\n    Animal : +String name\n";
    expect(validateBlock(block)).toEqual([]);
  });

  it("test_unknown_diagram_type", () => {
    const block = "unknownDiagram\n    A -> B\n";
    const errors = validateBlock(block);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const first = errors[0] ?? "";
    const lower = first.toLowerCase();
    expect(lower.includes("unknown") || lower.includes("unrecognized")).toBe(true);
  });

  it("test_empty_block", () => {
    const errors = validateBlock("");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("test_unbalanced_brackets", () => {
    const block = "graph TD\n    A[unclosed\n    B --> C\n";
    const errors = validateBlock(block);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ── lintPage tests ─────────────────────────────────────────────────

describe("TestLintPage", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("mermaid-lint-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_valid_page", () => {
    const page = makePageWithValidMermaid(tmpPath);
    expect(lintPage(page)).toEqual([]);
  });

  it("test_page_with_errors", () => {
    const page = makePageWithInvalidMermaid(tmpPath);
    const issues = lintPage(page);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    const first = issues[0];
    expect(first).toBeDefined();
    expect(first?.page).toBeDefined();
    expect(first?.line).toBeDefined();
    expect(first?.errors).toBeDefined();
  });

  it("test_no_mermaid", () => {
    const page = makePageNoMermaid(tmpPath);
    expect(lintPage(page)).toEqual([]);
  });
});

// ── lintWikiMermaid tests ──────────────────────────────────────────

describe("TestLintWikiMermaid", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("mermaid-wiki-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_all_valid", () => {
    const wikiRoot = makeWikiWithPages(tmpPath);
    const issues = lintWikiMermaid(wikiRoot);
    const mermaidIssues = issues.filter((i) => i.errors && i.errors.length > 0);
    // wiki_with_pages has one valid mermaid block in auth/session.md and no
    // other mermaid blocks, so the filtered list must be empty.
    for (const issue of mermaidIssues) {
      expect(issue.errors).toBeDefined();
    }
    expect(mermaidIssues).toHaveLength(0);
  });

  it("test_wiki_with_errors", () => {
    const wikiDir = path.join(tmpPath, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(
      path.join(wikiDir, "bad.md"),
      "---\ntitle: Bad\n---\n\n" + "```mermaid\nbadDiagram\n```\n",
    );
    const issues = lintWikiMermaid(tmpPath);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  it("test_empty_wiki", () => {
    fs.mkdirSync(path.join(tmpPath, "wiki"), { recursive: true });
    expect(lintWikiMermaid(tmpPath)).toEqual([]);
  });
});

// ── CLI tests ──────────────────────────────────────────────────────

describe("TestMermaidLintCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("mermaid-cli-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_single_page", () => {
    const page = makePageWithValidMermaid(tmpPath);
    const r = runCli(["--page", page]);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  it("test_cli_wiki_root", () => {
    const wikiRoot = makeWikiWithPages(tmpPath);
    const r = runCli(["--wiki-root", wikiRoot]);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

