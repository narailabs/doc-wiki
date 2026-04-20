#!/usr/bin/env node
/**
 * jira_wrapper.ts — Wrapper CLI for wiki-jira-agent.
 *
 * Delegates to @narai/jira-agent-connector (subprocess) and augments
 * structural envelopes with a Mermaid issue-status tree.
 *
 * Resolution order:
 *   1. JIRA_AGENT_CLI env var
 *   2. ~/.claude/plugins/cache/jira-agent-plugin*\/.../node_modules/
 *      @narai/jira-agent-connector/dist/cli.js
 *   3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/jira-agent-connector/dist/cli.js
 *   4. ~/src/connectors/jira-agent-connector/dist/cli.js
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

const STRUCTURAL_ACTIONS: ReadonlySet<string> = new Set(["jql_search"]);

export function resolveJiraAgentCli(): { command: string; args: string[] } | null {
  const envPath = process.env["JIRA_AGENT_CLI"];
  if (envPath && fs.existsSync(envPath)) {
    return { command: "node", args: [envPath] };
  }

  const pluginCache = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (fs.existsSync(pluginCache)) {
    for (const entry of fs.readdirSync(pluginCache)) {
      if (!entry.includes("jira-agent-plugin")) continue;
      const candidate = path.join(
        pluginCache,
        entry,
        "node_modules/@narai/jira-agent-connector/dist/cli.js",
      );
      if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
    }
  }

  const pluginData = process.env["CLAUDE_PLUGIN_DATA"];
  if (pluginData) {
    const candidate = path.join(
      pluginData,
      "node_modules/@narai/jira-agent-connector/dist/cli.js",
    );
    if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
  }

  const devPath = path.resolve(
    os.homedir(),
    "src/connectors/jira-agent-connector/dist/cli.js",
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

function mermaidForJira(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  if (result["action"] !== "jql_search") return undefined;
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;
  const issues =
    (data["issues"] as Array<Record<string, unknown>> | undefined) ?? [];
  if (issues.length === 0) return undefined;

  const byStatus = new Map<string, Array<Record<string, unknown>>>();
  for (const issue of issues) {
    const status = ((issue["status"] as string | undefined) ?? "unknown") || "unknown";
    let bucket = byStatus.get(status);
    if (bucket === undefined) {
      bucket = [];
      byStatus.set(status, bucket);
    }
    bucket.push(issue);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  nodes.push({ id: "root", label: "Issues", shape: "rounded" });
  let si = 0;
  let ii = 0;
  const PER_DIAGRAM_CAP = 40;
  let drawn = 0;
  for (const [status, bucket] of byStatus) {
    if (drawn >= PER_DIAGRAM_CAP) break;
    const sid = `s${si++}`;
    nodes.push({ id: sid, label: status });
    edges.push({ from: "root", to: sid });
    for (const issue of bucket) {
      if (drawn >= PER_DIAGRAM_CAP) break;
      const key = (issue["key"] as string | undefined) ?? `I${ii}`;
      const summary = ((issue["summary"] as string | undefined) ?? "").slice(0, 40);
      const label = summary ? `${key}: ${summary}` : key;
      const id = `i${ii++}`;
      nodes.push({ id, label });
      edges.push({ from: sid, to: id });
      drawn++;
    }
  }
  return formatGraph("TB", "Issue Status Tree", nodes, edges);
}

function runJiraAgent(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const resolved = resolveJiraAgentCli();
  if (resolved === null) {
    return Promise.resolve({
      code: 2,
      stdout: "",
      stderr:
        "jira-agent CLI not found. Set JIRA_AGENT_CLI, install jira-agent-plugin, " +
        "or build ~/src/jira-agent-connector.\n",
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
        stderr: `jira-agent CLI not available (${resolved.command}): ${err.message}\n`,
      });
    });
  });
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const { code, stdout, stderr } = await runJiraAgent(argv);

  if (stderr) process.stderr.write(stderr);

  if (isStructuralAction(argv) && stdout.trim().length > 0) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      /* passthrough */
    }
    if (parsed !== null && parsed["status"] === "success") {
      const mermaid = mermaidForJira(parsed);
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
