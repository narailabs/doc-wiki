/**
 * Tests for mermaid_inject.ts — splices agent Mermaid blocks into pages.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  injectMermaidBlocks,
  startMarker,
  endMarker,
  type AgentOutput,
} from "../mermaid_inject.js";
import { SCRIPTS_DIR, cleanupTmpPath, makeTmpPath } from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "mermaid_inject.js");

describe("injectMermaidBlocks", () => {
  it("returns body unchanged when no agent output carries a mermaid field", () => {
    const body = "# Title\n\nBody.\n";
    expect(injectMermaidBlocks(body, [])).toBe(body);
    expect(injectMermaidBlocks(body, [{ agent: "jira" }])).toBe(body);
  });

  it("appends a fenced block wrapped in markers for a new title", () => {
    const body = "# Page\n\nBody paragraph.\n";
    const agents: AgentOutput[] = [
      {
        agent: "db",
        mermaid: {
          type: "erDiagram",
          title: "User schema",
          code: "erDiagram\n    users ||--o{ orders : owns",
        },
      },
    ];
    const out = injectMermaidBlocks(body, agents);
    expect(out).toContain(startMarker("User schema"));
    expect(out).toContain(endMarker("User schema"));
    expect(out).toContain("## User schema");
    expect(out).toContain("```mermaid");
    expect(out).toContain("erDiagram");
    expect(out).toContain("users ||--o{ orders : owns");
    expect(out.startsWith("# Page")).toBe(true);
  });

  it("replaces an existing block with the same title (idempotent update)", () => {
    const initial =
      "# Page\n\nBody.\n\n" +
      startMarker("Schema") +
      "\n## Schema\n\n```mermaid\nerDiagram\n    old_code\n```\n" +
      endMarker("Schema") +
      "\n";
    const agents: AgentOutput[] = [
      {
        mermaid: {
          type: "erDiagram",
          title: "Schema",
          code: "erDiagram\n    fresh_code",
        },
      },
    ];
    const out = injectMermaidBlocks(initial, agents);
    expect(out).toContain("fresh_code");
    expect(out).not.toContain("old_code");
    // Only one start-marker for the title — idempotent, no stacking.
    const starts = out.match(new RegExp(startMarker("Schema"), "g"));
    expect(starts?.length).toBe(1);
  });

  it("runs twice with the same input and produces the same output", () => {
    const body = "# Page\n\nBody.\n";
    const agents: AgentOutput[] = [
      {
        mermaid: {
          type: "graph TB",
          title: "Topology",
          code: "graph TB\n    A --> B",
        },
      },
    ];
    const once = injectMermaidBlocks(body, agents);
    const twice = injectMermaidBlocks(once, agents);
    expect(twice).toBe(once);
  });

  it("appends multiple blocks in the order agents provided them", () => {
    const body = "# Page\n";
    const agents: AgentOutput[] = [
      { mermaid: { type: "graph TB", title: "First", code: "graph TB\n    A --> B" } },
      { mermaid: { type: "erDiagram", title: "Second", code: "erDiagram\n    X ||--o{ Y : r" } },
    ];
    const out = injectMermaidBlocks(body, agents);
    const idxFirst = out.indexOf("## First");
    const idxSecond = out.indexOf("## Second");
    expect(idxFirst).toBeGreaterThan(0);
    expect(idxSecond).toBeGreaterThan(idxFirst);
  });

  it("ignores malformed mermaid envelopes (missing fields, empty strings)", () => {
    const body = "# Page\n";
    const agents: AgentOutput[] = [
      // @ts-expect-error — intentionally broken shape
      { mermaid: { type: "erDiagram", code: "x" } },
      { mermaid: { type: "", title: "", code: "" } },
      // @ts-expect-error — intentionally broken shape
      { mermaid: { type: "graph TB", title: "ok", code: 42 } },
    ];
    expect(injectMermaidBlocks(body, agents)).toBe(body);
  });

  it("preserves surrounding text and existing code blocks unrelated to the injected title", () => {
    const body =
      "# Page\n\nIntro.\n\n```python\nprint('hello')\n```\n\nMore body text.\n";
    const agents: AgentOutput[] = [
      {
        mermaid: {
          type: "graph LR",
          title: "Dep Graph",
          code: "graph LR\n    mod_a --> mod_b",
        },
      },
    ];
    const out = injectMermaidBlocks(body, agents);
    expect(out).toContain("```python\nprint('hello')\n```");
    expect(out).toContain("More body text.");
    expect(out).toContain("## Dep Graph");
  });
});

describe("mermaid_inject CLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("mermaid-inject-cli-");
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

  it("writes the spliced body to stdout by default", () => {
    const page = path.join(tmpPath, "page.md");
    const agents = path.join(tmpPath, "agents.json");
    fs.writeFileSync(page, "# Page\n\nBody.\n");
    fs.writeFileSync(
      agents,
      JSON.stringify([
        { mermaid: { type: "graph TB", title: "Arch", code: "graph TB\n    A --> B" } },
      ]),
    );
    const result = runCli(["--page", page, "--agents", agents]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("## Arch");
    expect(result.stdout).toContain("A --> B");
    // Page on disk is unchanged without --in-place.
    expect(fs.readFileSync(page, "utf-8")).toBe("# Page\n\nBody.\n");
  });

  it("rewrites the page in place with --in-place", () => {
    const page = path.join(tmpPath, "page.md");
    const agents = path.join(tmpPath, "agents.json");
    fs.writeFileSync(page, "# Page\n");
    fs.writeFileSync(
      agents,
      JSON.stringify([
        { mermaid: { type: "graph TB", title: "Arch", code: "graph TB\n    A --> B" } },
      ]),
    );
    const result = runCli(["--page", page, "--agents", agents, "--in-place"]);
    expect(result.status).toBe(0);
    const onDisk = fs.readFileSync(page, "utf-8");
    expect(onDisk).toContain("## Arch");
  });

  it("exits 2 on missing required flags", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--page");
  });

  it("exits 2 when --agents points at non-array JSON", () => {
    const page = path.join(tmpPath, "page.md");
    const agents = path.join(tmpPath, "agents.json");
    fs.writeFileSync(page, "# Page\n");
    fs.writeFileSync(agents, JSON.stringify({ not: "an array" }));
    const result = runCli(["--page", page, "--agents", agents]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("JSON array");
  });
});
