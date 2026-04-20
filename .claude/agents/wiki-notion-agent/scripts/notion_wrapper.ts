#!/usr/bin/env node
/**
 * notion_wrapper.ts — Wrapper CLI for wiki-notion-agent.
 *
 * Delegates all Notion work to @narai/notion-agent-connector's CLI
 * (spawned as a subprocess) and augments structural envelopes with a
 * wiki-specific Mermaid diagram. Mermaid stays in doc-wiki.
 *
 * Resolution order:
 *   1. NOTION_AGENT_CLI env var
 *   2. ~/.claude/plugins/cache/notion-agent-plugin*\/.../node_modules/
 *      @narai/notion-agent-connector/dist/cli.js
 *   3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/notion-agent-connector/dist/cli.js
 *   4. ~/src/connectors/notion-agent-connector/dist/cli.js
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import {
  formatGraph,
  type GraphEdge,
  type GraphNode,
  type MermaidBlock,
} from "../../lib/mermaid_format.js";

const STRUCTURAL_ACTIONS: ReadonlySet<string> = new Set([
  "search",
  "query_database",
]);

export function resolveNotionAgentCli(): { command: string; args: string[] } | null {
  const envPath = process.env["NOTION_AGENT_CLI"];
  if (envPath && fs.existsSync(envPath)) {
    return { command: "node", args: [envPath] };
  }

  const pluginCache = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (fs.existsSync(pluginCache)) {
    for (const entry of fs.readdirSync(pluginCache)) {
      if (!entry.includes("notion-agent-plugin")) continue;
      const candidate = path.join(
        pluginCache,
        entry,
        "node_modules/@narai/notion-agent-connector/dist/cli.js",
      );
      if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
    }
  }

  const pluginData = process.env["CLAUDE_PLUGIN_DATA"];
  if (pluginData) {
    const candidate = path.join(
      pluginData,
      "node_modules/@narai/notion-agent-connector/dist/cli.js",
    );
    if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
  }

  const devPath = path.resolve(
    os.homedir(),
    "src/connectors/notion-agent-connector/dist/cli.js",
  );
  if (fs.existsSync(devPath)) return { command: "node", args: [devPath] };

  return null;
}

function isStructuralAction(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--action" && argv[i + 1] && STRUCTURAL_ACTIONS.has(argv[i + 1] as string)) {
      return true;
    }
    if (typeof a === "string" && a.startsWith("--action=")) {
      const value = a.slice("--action=".length);
      if (STRUCTURAL_ACTIONS.has(value)) return true;
    }
  }
  return false;
}

function mermaidForNotion(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "search") {
    const results = (data["results"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (results.length === 0) return undefined;
    const capped = results.slice(0, 30);
    const nodes: GraphNode[] = [
      { id: "root", label: "Search Results", shape: "rounded" },
    ];
    const edges: GraphEdge[] = [];
    for (const [i, r] of capped.entries()) {
      const id = ((r["id"] as string | undefined) ?? `r${i}`).slice(0, 8);
      const objType = ((r["object_type"] as string | undefined) ?? "page").slice(0, 20);
      nodes.push({ id: `r${i}`, label: `${objType} ${id}` });
      edges.push({ from: "root", to: `r${i}` });
    }
    return formatGraph("TB", "Notion Search Hierarchy", nodes, edges);
  }

  if (action === "query_database") {
    const databaseId = (data["database_id"] as string | undefined) ?? "database";
    const results = (data["results"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (results.length === 0) return undefined;
    const capped = results.slice(0, 30);
    const dbLabel = databaseId.length > 8 ? databaseId.slice(0, 8) + "…" : databaseId;
    const nodes: GraphNode[] = [
      { id: "db", label: `DB ${dbLabel}`, shape: "rounded" },
    ];
    const edges: GraphEdge[] = [];
    for (const [i, r] of capped.entries()) {
      const title = ((r["title"] as string | undefined) ?? `row ${i}`).slice(0, 60);
      nodes.push({ id: `p${i}`, label: title });
      edges.push({ from: "db", to: `p${i}` });
    }
    return formatGraph("TB", "Notion Page Tree", nodes, edges);
  }

  return undefined;
}

function runNotionAgent(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const resolved = resolveNotionAgentCli();
  if (resolved === null) {
    return Promise.resolve({
      code: 2,
      stdout: "",
      stderr:
        "notion-agent CLI not found. Set NOTION_AGENT_CLI, install notion-agent-plugin, " +
        "or build ~/src/notion-agent-connector.\n",
    });
  }

  return new Promise((resolve) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    const child = spawn(resolved.command, [...resolved.args, ...argv], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    child.stdout.on("data", (data: Buffer) => {
      stdoutBuf += data.toString("utf-8");
    });
    child.stderr.on("data", (data: Buffer) => {
      stderrBuf += data.toString("utf-8");
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf });
    });
    child.on("error", (err) => {
      resolve({
        code: 2,
        stdout: "",
        stderr: `notion-agent CLI not available (${resolved.command}): ${err.message}\n`,
      });
    });
  });
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const { code, stdout, stderr } = await runNotionAgent(argv);

  if (stderr) process.stderr.write(stderr);

  if (isStructuralAction(argv) && stdout.trim().length > 0) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      /* not JSON — passthrough */
    }
    if (parsed !== null && parsed["status"] === "success") {
      const mermaid = mermaidForNotion(parsed);
      if (mermaid !== undefined) parsed["mermaid"] = mermaid;
      process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
      return code;
    }
  }

  process.stdout.write(stdout);
  return code;
}

function isCliEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const scriptPath = fs.realpathSync(path.resolve(argv1));
    const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
    return scriptPath === modulePath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
