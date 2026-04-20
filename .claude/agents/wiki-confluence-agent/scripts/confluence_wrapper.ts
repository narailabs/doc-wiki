#!/usr/bin/env node
/**
 * confluence_wrapper.ts — Wrapper CLI for wiki-confluence-agent.
 *
 * Delegates all Confluence work to @narai/confluence-agent-connector
 * (subprocess) and augments structural envelopes with a wiki-specific
 * Mermaid page hierarchy.
 *
 * Resolution order:
 *   1. CONFLUENCE_AGENT_CLI env var
 *   2. ~/.claude/plugins/cache/confluence-agent-plugin*\/.../node_modules/
 *      @narai/confluence-agent-connector/dist/cli.js
 *   3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/confluence-agent-connector/dist/cli.js
 *   4. ~/src/connectors/confluence-agent-connector/dist/cli.js
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
  "cql_search",
  "get_page",
]);

export function resolveConfluenceAgentCli(): { command: string; args: string[] } | null {
  const envPath = process.env["CONFLUENCE_AGENT_CLI"];
  if (envPath && fs.existsSync(envPath)) {
    return { command: "node", args: [envPath] };
  }

  const pluginCache = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (fs.existsSync(pluginCache)) {
    for (const entry of fs.readdirSync(pluginCache)) {
      if (!entry.includes("confluence-agent-plugin")) continue;
      const candidate = path.join(
        pluginCache,
        entry,
        "node_modules/@narai/confluence-agent-connector/dist/cli.js",
      );
      if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
    }
  }

  const pluginData = process.env["CLAUDE_PLUGIN_DATA"];
  if (pluginData) {
    const candidate = path.join(
      pluginData,
      "node_modules/@narai/confluence-agent-connector/dist/cli.js",
    );
    if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
  }

  const devPath = path.resolve(
    os.homedir(),
    "src/connectors/confluence-agent-connector/dist/cli.js",
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

function mermaidForConfluence(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "cql_search") {
    const pages = (data["pages"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (pages.length === 0) return undefined;
    const spaceKeys = new Set(
      pages
        .map((p) => (p["space_key"] as string | undefined) ?? "")
        .filter((k) => k.length > 0),
    );
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const capped = pages.slice(0, 30);
    if (spaceKeys.size <= 1) {
      const root = [...spaceKeys][0] ?? "Results";
      nodes.push({ id: "space", label: root, shape: "rounded" });
      for (const [i, p] of capped.entries()) {
        const title = ((p["title"] as string | undefined) ?? `page ${i}`).slice(0, 60);
        nodes.push({ id: `p${i}`, label: title });
        edges.push({ from: "space", to: `p${i}` });
      }
    } else {
      const spaceIdx = new Map<string, string>();
      let si = 0;
      for (const k of spaceKeys) {
        const id = `s${si++}`;
        spaceIdx.set(k, id);
        nodes.push({ id, label: k, shape: "rounded" });
      }
      for (const [i, p] of capped.entries()) {
        const key = (p["space_key"] as string | undefined) ?? "";
        const parent = spaceIdx.get(key);
        if (parent === undefined) continue;
        const title = ((p["title"] as string | undefined) ?? `page ${i}`).slice(0, 60);
        nodes.push({ id: `p${i}`, label: title });
        edges.push({ from: parent, to: `p${i}` });
      }
    }
    return formatGraph("TB", "Page Hierarchy", nodes, edges);
  }

  if (action === "get_page") {
    const spaceKey = (data["space_key"] as string | undefined) ?? "";
    const title = ((data["title"] as string | undefined) ?? "page").slice(0, 60);
    if (title.length === 0) return undefined;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    if (spaceKey.length > 0) {
      nodes.push({ id: "space", label: spaceKey, shape: "rounded" });
      nodes.push({ id: "page", label: title });
      edges.push({ from: "space", to: "page" });
    } else {
      nodes.push({ id: "page", label: title });
    }
    return formatGraph("TB", "Page Hierarchy", nodes, edges);
  }

  return undefined;
}

function runConfluenceAgent(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const resolved = resolveConfluenceAgentCli();
  if (resolved === null) {
    return Promise.resolve({
      code: 2,
      stdout: "",
      stderr:
        "confluence-agent CLI not found. Set CONFLUENCE_AGENT_CLI, install confluence-agent-plugin, " +
        "or build ~/src/confluence-agent-connector.\n",
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
        stderr: `confluence-agent CLI not available (${resolved.command}): ${err.message}\n`,
      });
    });
  });
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const { code, stdout, stderr } = await runConfluenceAgent(argv);

  if (stderr) process.stderr.write(stderr);

  if (isStructuralAction(argv) && stdout.trim().length > 0) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      /* not JSON — passthrough */
    }
    if (parsed !== null && parsed["status"] === "success") {
      const mermaid = mermaidForConfluence(parsed);
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
