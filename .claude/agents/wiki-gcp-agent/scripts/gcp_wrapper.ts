#!/usr/bin/env node
/**
 * gcp_wrapper.ts — Wrapper CLI for wiki-gcp-agent.
 *
 * Delegates all GCP work to @narai/gcp-agent-connector's CLI (spawned as
 * a subprocess) and augments structural envelopes with a wiki-specific
 * Mermaid diagram. Mermaid generation stays in doc-wiki.
 *
 * Connector CLI resolution order:
 *   1. GCP_AGENT_CLI env var (absolute path to cli.js)
 *   2. ~/.claude/plugins/cache/gcp-agent-plugin*\/.../node_modules/
 *      @narai/gcp-agent-connector/dist/cli.js  (Layer 2 plugin install)
 *   3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/gcp-agent-connector/dist/cli.js
 *   4. ~/src/connectors/gcp-agent-connector/dist/cli.js  (local dev fallback)
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
  "list_services",
  "describe_db",
  "list_topics",
]);

export function resolveGcpAgentCli(): { command: string; args: string[] } | null {
  const envPath = process.env["GCP_AGENT_CLI"];
  if (envPath && fs.existsSync(envPath)) {
    return { command: "node", args: [envPath] };
  }

  const pluginCache = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (fs.existsSync(pluginCache)) {
    for (const entry of fs.readdirSync(pluginCache)) {
      if (!entry.includes("gcp-agent-plugin")) continue;
      const candidate = path.join(
        pluginCache,
        entry,
        "node_modules/@narai/gcp-agent-connector/dist/cli.js",
      );
      if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
    }
  }

  const pluginData = process.env["CLAUDE_PLUGIN_DATA"];
  if (pluginData) {
    const candidate = path.join(
      pluginData,
      "node_modules/@narai/gcp-agent-connector/dist/cli.js",
    );
    if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
  }

  const devPath = path.resolve(
    os.homedir(),
    "src/connectors/gcp-agent-connector/dist/cli.js",
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

function mermaidForGcp(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "list_services") {
    const services =
      (data["services"] as Array<{ name: string; title: string }> | undefined) ?? [];
    if (services.length === 0) return undefined;
    const project = (data["project_id"] as string) || "project";
    const nodes: GraphNode[] = [
      { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
      ...services.map((s, i) => ({ id: `svc_${i}`, label: s.title || s.name })),
    ];
    const edges: GraphEdge[] = services.map((_, i) => ({
      from: `proj_${project}`,
      to: `svc_${i}`,
    }));
    return formatGraph("TB", `GCP Services — ${project}`, nodes, edges);
  }

  if (action === "describe_db") {
    const project = (data["project_id"] as string) || "project";
    const instance = (data["instance_id"] as string) || "instance";
    const engine = (data["engine"] as string) || "";
    const version = (data["version"] as string) || "";
    const label = engine || version ? `${instance} (${engine}${version ? ` ${version}` : ""})` : instance;
    const nodes: GraphNode[] = [
      { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
      { id: `db_${instance}`, label, shape: "stadium" },
    ];
    const edges: GraphEdge[] = [{ from: `proj_${project}`, to: `db_${instance}` }];
    return formatGraph("TB", `GCP Cloud SQL — ${instance}`, nodes, edges);
  }

  if (action === "list_topics") {
    const topics = (data["topics"] as string[] | undefined) ?? [];
    if (topics.length === 0) return undefined;
    const project = (data["project_id"] as string) || "project";
    const nodes: GraphNode[] = [
      { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
      ...topics.map((t, i) => ({ id: `topic_${i}`, label: t })),
    ];
    const edges: GraphEdge[] = topics.map((_, i) => ({
      from: `proj_${project}`,
      to: `topic_${i}`,
    }));
    return formatGraph("TB", `GCP Pub/Sub Topics — ${project}`, nodes, edges);
  }

  return undefined;
}

function runGcpAgent(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const resolved = resolveGcpAgentCli();
  if (resolved === null) {
    return Promise.resolve({
      code: 2,
      stdout: "",
      stderr:
        "gcp-agent CLI not found. Set GCP_AGENT_CLI, install gcp-agent-plugin, " +
        "or build ~/src/gcp-agent-connector.\n",
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
        stderr: `gcp-agent CLI not available (${resolved.command}): ${err.message}\n`,
      });
    });
  });
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const { code, stdout, stderr } = await runGcpAgent(argv);

  if (stderr) process.stderr.write(stderr);

  if (isStructuralAction(argv) && stdout.trim().length > 0) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      /* not JSON — passthrough */
    }
    if (parsed !== null && parsed["status"] === "success") {
      const mermaid = mermaidForGcp(parsed);
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
