#!/usr/bin/env node
/**
 * db_query.ts — Wrapper CLI for the wiki-db-agent.
 *
 * Delegates all database work to the `db-agent-connector` plugin's CLI
 * (spawned as a subprocess) and augments schema results with a Mermaid ER
 * diagram. Mermaid generation stays in doc-wiki because it's wiki-specific.
 *
 * The db-agent CLI is located via (in order):
 *   1. DB_AGENT_CLI env var (absolute path to cli.js)
 *   2. `db-agent` on PATH (when the plugin is installed and enabled)
 *   3. `~/src/connectors/db-agent-connector/src/cli.js` (local dev fallback)
 *
 * CLI usage passes through verbatim to db-agent; see that plugin's AGENT.md
 * for flags. Example:
 *   node db_query.js --sqlite <file> --action schema
 *
 * Tests import `main` directly and exercise the wrapper end-to-end.
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Wiki-specific: Mermaid ER diagram generation (stays in doc-wiki).
import {
  formatErDiagram,
  type ErColumn,
  type ErTable,
  type MermaidBlock,
} from "../../lib/mermaid_format.js";

interface WrapperTable {
  name: string;
  columns: Array<{
    name: string;
    data_type?: string;
    is_primary_key?: boolean;
  }>;
}

function resolveDbAgentCli(): { command: string; args: string[] } | null {
  // 1. Explicit env var.
  const envPath = process.env["DB_AGENT_CLI"];
  if (envPath && fs.existsSync(envPath)) {
    return { command: "node", args: [envPath] };
  }

  // 2. Dev fallback: ~/src/connectors/db-agent-connector/src/cli.js.
  const devPath = path.resolve(
    os.homedir(),
    "src/connectors/db-agent-connector/src/cli.js",
  );
  if (fs.existsSync(devPath)) {
    return { command: "node", args: [devPath] };
  }

  // 3. `db-agent` on PATH (installed plugin exposes this via bin/).
  return { command: "db-agent", args: [] };
}

function schemaToMermaid(tables: WrapperTable[]): MermaidBlock | null {
  if (tables.length === 0) return null;
  const ermTables: ErTable[] = tables.map((t) => {
    const cols: ErColumn[] = t.columns.map((c) => ({
      name: c.name,
      type: c.data_type || "string",
      key: c.is_primary_key ? "PK" : undefined,
    }));
    return { name: t.name, columns: cols };
  });
  return formatErDiagram("Database Schema", ermTables, []);
}

function isSchemaAction(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--action" && argv[i + 1] === "schema") return true;
    if (a === "--action=schema") return true;
  }
  return false;
}

/**
 * Run the db-agent CLI as a subprocess. Returns {code, stdout, stderr}.
 */
function runDbAgent(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const resolved = resolveDbAgentCli();
  if (resolved === null) {
    return Promise.resolve({
      code: 2,
      stdout: "",
      stderr:
        "db-agent CLI not found. Set DB_AGENT_CLI or install db-agent-connector plugin.\n",
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
        stderr: `db-agent CLI not available (${resolved.command}): ${err.message}\n`,
      });
    });
  });
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const { code, stdout, stderr } = await runDbAgent(argv);

  // Forward stderr unchanged.
  if (stderr) process.stderr.write(stderr);

  // For schema actions, parse the JSON and add a Mermaid ER diagram.
  // For every other action, pass stdout through verbatim (no re-stringify).
  if (isSchemaAction(argv) && stdout.trim().length > 0) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      /* not JSON — fall through to passthrough */
    }
    if (
      parsed !== null &&
      parsed["status"] === "ok" &&
      Array.isArray(parsed["tables"])
    ) {
      const mermaid = schemaToMermaid(parsed["tables"] as WrapperTable[]);
      if (mermaid !== null) parsed["mermaid"] = mermaid;
      process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
      return code;
    }
  }

  process.stdout.write(stdout);
  return code;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
