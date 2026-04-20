#!/usr/bin/env node
/**
 * github_wrapper.ts — Wrapper CLI for wiki-github-agent.
 *
 * Delegates to @narai/github-agent-connector (subprocess) and augments
 * `get_file` dependency-manifest envelopes with a Mermaid dependency
 * graph. Mermaid stays in doc-wiki.
 *
 * Resolution order:
 *   1. GITHUB_AGENT_CLI env var
 *   2. ~/.claude/plugins/cache/github-agent-plugin*\/.../node_modules/
 *      @narai/github-agent-connector/dist/cli.js
 *   3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/github-agent-connector/dist/cli.js
 *   4. ~/src/connectors/github-agent-connector/dist/cli.js
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { formatGraph, } from "../../lib/mermaid_format.js";
const STRUCTURAL_ACTIONS = new Set(["get_file"]);
export function resolveGithubAgentCli() {
    const envPath = process.env["GITHUB_AGENT_CLI"];
    if (envPath && fs.existsSync(envPath)) {
        return { command: "node", args: [envPath] };
    }
    const pluginCache = path.join(os.homedir(), ".claude", "plugins", "cache");
    if (fs.existsSync(pluginCache)) {
        for (const entry of fs.readdirSync(pluginCache)) {
            if (!entry.includes("github-agent-plugin"))
                continue;
            const candidate = path.join(pluginCache, entry, "node_modules/@narai/github-agent-connector/dist/cli.js");
            if (fs.existsSync(candidate))
                return { command: "node", args: [candidate] };
        }
    }
    const pluginData = process.env["CLAUDE_PLUGIN_DATA"];
    if (pluginData) {
        const candidate = path.join(pluginData, "node_modules/@narai/github-agent-connector/dist/cli.js");
        if (fs.existsSync(candidate))
            return { command: "node", args: [candidate] };
    }
    const devPath = path.resolve(os.homedir(), "src/connectors/github-agent-connector/dist/cli.js");
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
function parsePackageJsonDeps(content) {
    try {
        const parsed = JSON.parse(content);
        const deps = [
            ...Object.keys(parsed.dependencies ?? {}),
            ...Object.keys(parsed.devDependencies ?? {}),
        ];
        return [...new Set(deps)];
    }
    catch {
        return [];
    }
}
function parseRequirementsTxt(content) {
    const deps = [];
    const seen = new Set();
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#"))
            continue;
        const m = line.match(/^([A-Za-z0-9_.\-]+)/);
        if (!m)
            continue;
        const name = m[1];
        if (seen.has(name))
            continue;
        seen.add(name);
        deps.push(name);
    }
    return deps;
}
function mermaidForGithub(result) {
    if (result["status"] !== "success")
        return undefined;
    if (result["action"] !== "get_file")
        return undefined;
    const data = result["data"];
    if (data === undefined)
        return undefined;
    const filePath = (data["path"] ?? "").toLowerCase();
    const content = data["content"] ?? "";
    if (content === "")
        return undefined;
    let deps = [];
    if (filePath.endsWith("package.json")) {
        deps = parsePackageJsonDeps(content);
    }
    else if (filePath.endsWith("requirements.txt")) {
        deps = parseRequirementsTxt(content);
    }
    if (deps.length === 0)
        return undefined;
    const capped = deps.slice(0, 40);
    const rootLabel = data["path"] || "repo";
    const nodes = [
        { id: "root", label: rootLabel, shape: "rounded" },
        ...capped.map((d, i) => ({ id: `dep_${i}`, label: d })),
    ];
    const edges = capped.map((_, i) => ({
        from: "root",
        to: `dep_${i}`,
    }));
    return formatGraph("LR", "Dependency Graph", nodes, edges);
}
function runGithubAgent(argv) {
    const resolved = resolveGithubAgentCli();
    if (resolved === null) {
        return Promise.resolve({
            code: 2,
            stdout: "",
            stderr: "github-agent CLI not found. Set GITHUB_AGENT_CLI, install github-agent-plugin, " +
                "or build ~/src/github-agent-connector.\n",
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
                stderr: `github-agent CLI not available (${resolved.command}): ${err.message}\n`,
            });
        });
    });
}
export async function main(argv = process.argv.slice(2)) {
    const { code, stdout, stderr } = await runGithubAgent(argv);
    if (stderr)
        process.stderr.write(stderr);
    if (isStructuralAction(argv) && stdout.trim().length > 0) {
        let parsed = null;
        try {
            parsed = JSON.parse(stdout);
        }
        catch {
            /* passthrough */
        }
        if (parsed !== null && parsed["status"] === "success") {
            const mermaid = mermaidForGithub(parsed);
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
