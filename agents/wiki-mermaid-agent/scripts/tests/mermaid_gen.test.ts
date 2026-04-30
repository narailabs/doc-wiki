/**
 * Tests for mermaid_gen.ts — ported from test_mermaid_gen.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled mermaid_gen.js via Node.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  formatMermaidBlock,
  injectMermaid,
  extractMermaidFromOutput,
  validateMermaidType,
} from "../mermaid_gen.js";

const SCRIPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const CLI = path.join(SCRIPTS_DIR, "mermaid_gen.js");

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

function makeTmpPath(prefix: string = "mermaid-gen-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTmpPath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

const erDiagramData = {
  type: "erDiagram",
  title: "User Orders",
  code: "    users ||--o{ orders : has\n    orders ||--|{ items : contains",
};

const sequenceDiagramData = {
  type: "sequenceDiagram",
  title: "Login Flow",
  code: "    Client->>Server: Login\n    Server-->>Client: Token",
};

const graphData = {
  type: "graph TD",
  title: "Service Dependencies",
  code: "    A --> B\n    B --> C\n    A --> C",
};

const agentOutputWithMermaid: Record<string, unknown> = {
  page: "wiki/db/schema.md",
  content: "Database schema overview.",
  mermaid: [
    {
      type: "erDiagram",
      title: "Schema",
      code: "    users ||--o{ orders : has",
    },
    {
      type: "classDiagram",
      title: "Models",
      code: "    class User\n    User : +String name",
    },
  ],
};

const agentOutputNoMermaid: Record<string, unknown> = {
  page: "wiki/auth/session.md",
  content: "Session management details.",
};

const wikiPageContent =
  "---\ntitle: Schema\n---\n\n" +
  "# Database Schema\n\n" +
  "The database has users and orders tables.\n";

const wikiPageWithDiagrams =
  "---\ntitle: Schema\n---\n\n" +
  "# Database Schema\n\n" +
  "Some text.\n\n" +
  "## Diagrams\n\n" +
  "```mermaid\nerDiagram\n    old ||--o{ stuff : had\n```\n\n" +
  "## Notes\n\n" +
  "Keep this section.\n";

// ── format_mermaid_block tests ────────────────────────────────────

describe("TestFormatMermaidBlock", () => {
  it("test_format_er_diagram", () => {
    const result = formatMermaidBlock(erDiagramData);
    expect(result.includes("```mermaid")).toBe(true);
    expect(result.includes("erDiagram")).toBe(true);
    expect(result.trim().endsWith("```")).toBe(true);
    expect(result.includes("users ||--o{ orders : has")).toBe(true);
  });

  it("test_format_sequence_diagram", () => {
    const result = formatMermaidBlock(sequenceDiagramData);
    expect(result.includes("```mermaid")).toBe(true);
    expect(result.includes("sequenceDiagram")).toBe(true);
    expect(result.includes("Client->>Server: Login")).toBe(true);
    expect(result.trim().endsWith("```")).toBe(true);
  });

  it("test_format_graph", () => {
    const result = formatMermaidBlock(graphData);
    expect(result.includes("```mermaid")).toBe(true);
    expect(result.includes("graph TD")).toBe(true);
    expect(result.includes("A --> B")).toBe(true);
  });

  it("test_format_with_title", () => {
    const result = formatMermaidBlock(erDiagramData);
    const lines = result.split("\n");
    const titleLines = lines.filter((l) => l.includes("User Orders"));
    expect(titleLines.length).toBeGreaterThanOrEqual(1);
  });
});

// ── inject_mermaid tests ──────────────────────────────────────────

describe("TestInjectMermaid", () => {
  it("test_inject_into_empty_page", () => {
    const block = "```mermaid\nerDiagram\n    A ||--o{ B : has\n```";
    const result = injectMermaid("", [block]);
    expect(result.includes("## Diagrams")).toBe(true);
    expect(result.includes("```mermaid")).toBe(true);
  });

  it("test_inject_into_existing_page", () => {
    const block = "```mermaid\nerDiagram\n    users ||--o{ orders : has\n```";
    const result = injectMermaid(wikiPageContent, [block]);
    // Original content preserved
    expect(result.includes("# Database Schema")).toBe(true);
    expect(result.includes("The database has users and orders tables.")).toBe(true);
    // Diagrams added
    expect(result.includes("## Diagrams")).toBe(true);
    expect(result.includes("```mermaid")).toBe(true);
  });

  it("test_inject_replaces_existing_diagrams_section", () => {
    const newBlock =
      "```mermaid\nerDiagram\n    new ||--o{ stuff : has\n```";
    const result = injectMermaid(wikiPageWithDiagrams, [newBlock]);
    expect(result.includes("old ||--o{ stuff : had")).toBe(false);
    expect(result.includes("new ||--o{ stuff : has")).toBe(true);
    expect(result.includes("## Notes")).toBe(true);
    expect(result.includes("Keep this section.")).toBe(true);
  });
});

// ── extract_mermaid_from_output tests ─────────────────────────────

describe("TestExtractMermaidFromOutput", () => {
  it("test_extract_from_agent_output", () => {
    const result = extractMermaidFromOutput(agentOutputWithMermaid);
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe("erDiagram");
    expect(result[1]?.type).toBe("classDiagram");
  });

  it("test_extract_no_mermaid", () => {
    const result = extractMermaidFromOutput(agentOutputNoMermaid);
    expect(result).toEqual([]);
  });
});

// ── validate_mermaid_type tests ───────────────────────────────────

describe("TestValidateMermaidType", () => {
  it("test_validate_known_types", () => {
    const knownTypes = [
      "erDiagram",
      "sequenceDiagram",
      "graph",
      "flowchart",
      "classDiagram",
    ];
    for (const t of knownTypes) {
      expect(validateMermaidType(t)).toBe(true);
    }
  });

  it("test_validate_unknown_type", () => {
    expect(validateMermaidType("unknownDiagram")).toBe(false);
    expect(validateMermaidType("")).toBe(false);
    expect(validateMermaidType("mermaid")).toBe(false);
  });
});

// ── CLI tests ─────────────────────────────────────────────────────

describe("TestMermaidGenCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath();
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_input_json", () => {
    const inputFile = path.join(tmpPath, "agent_output.json");
    fs.writeFileSync(inputFile, JSON.stringify(agentOutputWithMermaid));

    const { stdout, status } = runCli(["--input", inputFile]);
    expect(status).toBe(0);
    expect(stdout.includes("```mermaid")).toBe(true);
    expect(stdout.includes("erDiagram")).toBe(true);
  });

  it("test_cli_page_injection", () => {
    const inputFile = path.join(tmpPath, "agent_output.json");
    fs.writeFileSync(inputFile, JSON.stringify(agentOutputWithMermaid));

    const pageFile = path.join(tmpPath, "schema.md");
    fs.writeFileSync(
      pageFile,
      "---\ntitle: Schema\n---\n\n# Schema\n\nSome content.\n",
    );

    const { status } = runCli([
      "--input",
      inputFile,
      "--page",
      pageFile,
    ]);
    expect(status).toBe(0);
    const updated = fs.readFileSync(pageFile, { encoding: "utf-8" });
    expect(updated.includes("```mermaid")).toBe(true);
    expect(updated.includes("# Schema")).toBe(true);
  });
});
