#!/usr/bin/env node
/**
 * aws_wrapper.ts — Wrapper CLI for wiki-aws-agent.
 *
 * Delegates all AWS work to @narai/aws-agent-connector's CLI (spawned as
 * a subprocess) and augments structural envelopes with a wiki-specific
 * Mermaid diagram. Mermaid generation stays in doc-wiki because it is
 * wiki-specific.
 *
 * Connector CLI resolution order:
 *   1. AWS_AGENT_CLI env var (absolute path to cli.js)
 *   2. ~/.claude/plugins/cache/aws-agent-plugin*\/.../node_modules/
 *      @narai/aws-agent-connector/dist/cli.js  (Layer 2 plugin install)
 *   3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/aws-agent-connector/dist/cli.js
 *      (when doc-wiki itself is plugin-installed and its SessionStart
 *       hook has populated ${CLAUDE_PLUGIN_DATA})
 *   4. ~/src/connectors/aws-agent-connector/dist/cli.js  (local dev fallback)
 *
 * Tests import `main` directly and exercise the wrapper end-to-end.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { formatGraph, } from "../../lib/mermaid_format.js";
const STRUCTURAL_ACTIONS = new Set([
    "list_functions",
    "describe_db",
    "list_buckets",
]);
export function resolveAwsAgentCli() {
    // 1. Explicit env var override.
    const envPath = process.env["AWS_AGENT_CLI"];
    if (envPath && fs.existsSync(envPath)) {
        return { command: "node", args: [envPath] };
    }
    // 2. Layer 2 plugin install, under Claude Code's plugin cache.
    const pluginCache = path.join(os.homedir(), ".claude", "plugins", "cache");
    if (fs.existsSync(pluginCache)) {
        for (const entry of fs.readdirSync(pluginCache)) {
            if (!entry.includes("aws-agent-plugin"))
                continue;
            const candidate = path.join(pluginCache, entry, "node_modules/@narai/aws-agent-connector/dist/cli.js");
            if (fs.existsSync(candidate))
                return { command: "node", args: [candidate] };
        }
    }
    // 3. doc-wiki's own ${CLAUDE_PLUGIN_DATA} (when doc-wiki is plugin-installed).
    const pluginData = process.env["CLAUDE_PLUGIN_DATA"];
    if (pluginData) {
        const candidate = path.join(pluginData, "node_modules/@narai/aws-agent-connector/dist/cli.js");
        if (fs.existsSync(candidate))
            return { command: "node", args: [candidate] };
    }
    // 4. Local dev fallback.
    const devPath = path.resolve(os.homedir(), "src/connectors/aws-agent-connector/dist/cli.js");
    if (fs.existsSync(devPath))
        return { command: "node", args: [devPath] };
    return null;
}
function isStructuralAction(argv) {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--action" && argv[i + 1] && STRUCTURAL_ACTIONS.has(argv[i + 1])) {
            return true;
        }
        if (typeof a === "string" && a.startsWith("--action=")) {
            const value = a.slice("--action=".length);
            if (STRUCTURAL_ACTIONS.has(value))
                return true;
        }
    }
    return false;
}
function mermaidForAws(result) {
    if (result["status"] !== "success")
        return undefined;
    const action = result["action"];
    const data = result["data"];
    if (data === undefined)
        return undefined;
    if (action === "list_functions") {
        const fns = data["functions"] ?? [];
        if (fns.length === 0)
            return undefined;
        const region = data["region"] || "region";
        const nodes = [
            { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
            ...fns.map((f) => ({
                id: `fn_${f.name}`,
                label: `${f.name} (${f.runtime || "unknown"})`,
            })),
        ];
        const edges = fns.map((f) => ({
            from: `region_${region}`,
            to: `fn_${f.name}`,
        }));
        return formatGraph("TB", `AWS Lambda Functions — ${region}`, nodes, edges);
    }
    if (action === "describe_db") {
        const region = data["region"] || "region";
        const id = data["db_identifier"] || "db";
        const engine = data["engine"] || "";
        const cls = data["instance_class"] || "";
        const label = engine || cls ? `${id} (${engine}${cls ? `, ${cls}` : ""})` : id;
        const nodes = [
            { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
            { id: `db_${id}`, label, shape: "stadium" },
        ];
        const edges = [{ from: `region_${region}`, to: `db_${id}` }];
        return formatGraph("TB", `AWS RDS — ${id}`, nodes, edges);
    }
    if (action === "list_buckets") {
        const buckets = data["buckets"] ?? [];
        if (buckets.length === 0)
            return undefined;
        const nodes = [
            { id: "account", label: "AWS Account", shape: "rounded" },
            ...buckets.map((b) => ({ id: `bucket_${b.name}`, label: b.name })),
        ];
        const edges = buckets.map((b) => ({
            from: "account",
            to: `bucket_${b.name}`,
        }));
        return formatGraph("TB", "AWS S3 Buckets", nodes, edges);
    }
    return undefined;
}
function runAwsAgent(argv) {
    const resolved = resolveAwsAgentCli();
    if (resolved === null) {
        return Promise.resolve({
            code: 2,
            stdout: "",
            stderr: "aws-agent CLI not found. Set AWS_AGENT_CLI, install aws-agent-plugin, " +
                "or build ~/src/aws-agent-connector.\n",
        });
    }
    return new Promise((resolve) => {
        let stdoutBuf = "";
        let stderrBuf = "";
        const child = spawn(resolved.command, [...resolved.args, ...argv], {
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
        });
        child.stdout.on("data", (data) => {
            stdoutBuf += data.toString("utf-8");
        });
        child.stderr.on("data", (data) => {
            stderrBuf += data.toString("utf-8");
        });
        child.on("close", (code) => {
            resolve({ code: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf });
        });
        child.on("error", (err) => {
            resolve({
                code: 2,
                stdout: "",
                stderr: `aws-agent CLI not available (${resolved.command}): ${err.message}\n`,
            });
        });
    });
}
export async function main(argv = process.argv.slice(2)) {
    const { code, stdout, stderr } = await runAwsAgent(argv);
    if (stderr)
        process.stderr.write(stderr);
    // Attach Mermaid only for structural actions with parseable JSON success.
    if (isStructuralAction(argv) && stdout.trim().length > 0) {
        let parsed = null;
        try {
            parsed = JSON.parse(stdout);
        }
        catch {
            /* not JSON — fall through to passthrough */
        }
        if (parsed !== null && parsed["status"] === "success") {
            const mermaid = mermaidForAws(parsed);
            if (mermaid !== undefined)
                parsed["mermaid"] = mermaid;
            process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
            return code;
        }
    }
    process.stdout.write(stdout);
    return code;
}
function isCliEntry() {
    const argv1 = process.argv[1];
    if (!argv1)
        return false;
    try {
        const scriptPath = fs.realpathSync(path.resolve(argv1));
        const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
        return scriptPath === modulePath;
    }
    catch {
        return false;
    }
}
if (isCliEntry()) {
    main().then((code) => process.exit(code), (e) => {
        process.stderr.write(`${e.message}\n`);
        process.exit(1);
    });
}
