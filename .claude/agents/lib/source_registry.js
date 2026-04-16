#!/usr/bin/env node
/**
 * source_registry.ts — Agent discovery, registration, and source-matching.
 *
 * Replaces the hardcoded AgentId union and switch statements in
 * how_to_go_deeper.ts with a data-driven registry. Agents are discovered
 * from AGENT.md frontmatter (builtin), config (custom), or installed
 * packages (plugin).
 *
 * The registry answers one key question: given a source string like
 * "jira://AUTH-123" or "https://github.com/org/repo", which agent
 * handles it?
 *
 * Usage as a library:
 *   import { initRegistry, lookupBySource } from "./source_registry.js";
 *   initRegistry({ agentsDir: ".claude/agents" });
 *   const agent = lookupBySource("db://dev/users");
 *
 * Usage as a CLI:
 *   node source_registry.js list --agents-dir .claude/agents
 *   node source_registry.js lookup --source "jira://AUTH-1" --agents-dir .claude/agents
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// ── Registry state ────────────────────────────────────────────────────
const _agents = new Map();
const BUILTIN_DEFAULTS = {
    "wiki-jira-agent": {
        source_schemes: ["jira://"],
        source_url_patterns: [
            { hostname: "*.atlassian.net", path_prefix: "/browse/" },
        ],
        label: "Jira",
    },
    "wiki-confluence-agent": {
        source_schemes: ["confluence://"],
        source_url_patterns: [
            { hostname: "*.atlassian.net", path_prefix: "/wiki/" },
            { hostname: "*.atlassian.net", path_contains: "/spaces/" },
        ],
        label: "Confluence",
    },
    "wiki-github-agent": {
        source_schemes: ["gh://", "github://"],
        source_url_patterns: [
            { hostname: "github.com" },
            { hostname: "*.github.com" },
        ],
        label: "GitHub",
    },
    "wiki-notion-agent": {
        source_schemes: ["notion://"],
        source_url_patterns: [
            { hostname: "notion.so" },
            { hostname: "*.notion.site" },
        ],
        label: "Notion",
    },
    "wiki-gcp-agent": {
        source_schemes: ["gcp://"],
        source_url_patterns: [
            { hostname: "*.cloud.google.com" },
            { hostname: "*.googleapis.com" },
        ],
        label: "GCP",
    },
    "wiki-aws-agent": {
        source_schemes: ["aws://"],
        source_url_patterns: [
            { hostname: "*.amazonaws.com" },
            { hostname: "*.aws.amazon.com" },
        ],
        label: "AWS",
    },
    "wiki-db-agent": {
        source_schemes: ["db://"],
        source_url_patterns: [],
        label: "Database",
    },
};
// ── AGENT.md parsing ──────────────────────────────────────────────────
/**
 * Parse YAML frontmatter from an AGENT.md file's raw content.
 *
 * Returns the parsed frontmatter as a plain object. We avoid importing
 * js-yaml here and use a lightweight regex parser for the simple YAML
 * structure of AGENT.md frontmatter (flat key: value pairs and short
 * arrays). For nested structures we fall back to JSON-like parsing.
 */
export function parseFrontmatter(content) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (match === null)
        return {};
    const yaml = match[1] ?? "";
    const result = {};
    for (const line of yaml.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#"))
            continue;
        // Handle simple key: value
        const kv = /^(\w[\w_-]*)\s*:\s*(.*)$/.exec(trimmed);
        if (kv === null)
            continue;
        const key = kv[1];
        let val = (kv[2] ?? "").trim();
        // Strip trailing comments
        const commentIdx = val.indexOf(" #");
        if (commentIdx >= 0 && !val.startsWith('"') && !val.startsWith("'")) {
            val = val.slice(0, commentIdx).trim();
        }
        // Parse inline arrays: [Bash, Read, Write]
        if (val.startsWith("[") && val.endsWith("]")) {
            const inner = val.slice(1, -1);
            result[key] = inner
                .split(",")
                .map((s) => s.trim().replace(/^["']|["']$/g, ""))
                .filter(Boolean);
            continue;
        }
        // Quoted strings
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            result[key] = val.slice(1, -1);
            continue;
        }
        // Multiline: |
        if (val === "|") {
            // Collect indented lines as description (simplified)
            result[key] = "";
            continue;
        }
        // Booleans / numbers
        if (val === "true") {
            result[key] = true;
            continue;
        }
        if (val === "false") {
            result[key] = false;
            continue;
        }
        if (/^\d+$/.test(val)) {
            result[key] = parseInt(val, 10);
            continue;
        }
        // Plain string
        result[key] = val;
    }
    return result;
}
// ── Discovery ─────────────────────────────────────────────────────────
/**
 * Build an AgentManifest from parsed frontmatter + directory path.
 * Falls back to BUILTIN_DEFAULTS for agents that lack registry fields.
 */
export function buildManifest(frontmatter, agentDir, origin = "builtin") {
    const dirName = path.basename(agentDir);
    const name = frontmatter["name"] ?? dirName;
    const builtin = BUILTIN_DEFAULTS[dirName];
    // Parse source_schemes from frontmatter or builtin defaults
    let sourceSchemes = [];
    if (Array.isArray(frontmatter["source_schemes"])) {
        sourceSchemes = frontmatter["source_schemes"];
    }
    else if (builtin) {
        sourceSchemes = builtin.source_schemes;
    }
    // Parse source_url_patterns from frontmatter or builtin defaults
    let urlPatterns = [];
    if (Array.isArray(frontmatter["source_url_patterns"])) {
        urlPatterns = frontmatter["source_url_patterns"];
    }
    else if (builtin) {
        urlPatterns = builtin.source_url_patterns;
    }
    // Parse invocation_template
    const tmplRaw = frontmatter["invocation_template"];
    const label = builtin?.label ?? name.replace(/^wiki-/, "").replace(/-agent$/, "");
    const invocationTemplate = {
        subagent_type: tmplRaw?.["subagent_type"] ?? name,
        default_model: tmplRaw?.["default_model"] ?? frontmatter["model"] ?? "haiku",
        label: tmplRaw?.["label"] ?? label,
    };
    return {
        name,
        description: frontmatter["description"] ?? "",
        type: frontmatter["type"] ?? "source",
        autonomy_level: frontmatter["autonomy_level"] ?? "supervised",
        model: frontmatter["model"] ?? "haiku",
        tools: (Array.isArray(frontmatter["tools"]) ? frontmatter["tools"] : []),
        color: frontmatter["color"],
        version: frontmatter["version"] ?? "0.0.0",
        repository: frontmatter["repository"],
        source_schemes: sourceSchemes,
        source_url_patterns: urlPatterns,
        invocation_template: invocationTemplate,
        agent_dir: agentDir,
        origin,
    };
}
/**
 * Scan a directory for agent subdirectories containing AGENT.md files.
 * Returns an array of manifests for all discovered agents.
 */
export function discoverAgents(agentsDir, origin = "builtin") {
    if (!fs.existsSync(agentsDir))
        return [];
    const manifests = [];
    let entries;
    try {
        entries = fs.readdirSync(agentsDir);
    }
    catch {
        return [];
    }
    for (const entry of entries) {
        const agentDir = path.join(agentsDir, entry);
        const agentMd = path.join(agentDir, "AGENT.md");
        try {
            const stat = fs.statSync(agentDir);
            if (!stat.isDirectory())
                continue;
        }
        catch {
            continue;
        }
        if (!fs.existsSync(agentMd))
            continue;
        try {
            const content = fs.readFileSync(agentMd, "utf-8");
            const fm = parseFrontmatter(content);
            manifests.push(buildManifest(fm, agentDir, origin));
        }
        catch {
            // Skip agents with unparseable AGENT.md
        }
    }
    return manifests;
}
// ── Registration ──────────────────────────────────────────────────────
export function registerAgent(manifest) {
    _agents.set(manifest.name, manifest);
}
export function unregisterAgent(name) {
    return _agents.delete(name);
}
export function clearRegistry() {
    _agents.clear();
}
// ── Lookup ────────────────────────────────────────────────────────────
/** Check if a hostname matches a pattern (supports leading `*` glob). */
export function matchHostname(pattern, hostname) {
    if (pattern === hostname)
        return true;
    if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(1); // ".atlassian.net"
        return hostname.endsWith(suffix) || hostname === pattern.slice(2);
    }
    return false;
}
/**
 * Given a source string, find the agent that handles it.
 *
 * Matching order:
 *  1. URL sources (https://): match against source_url_patterns
 *     - Patterns with path_prefix/path_contains are checked first (more specific)
 *  2. Scheme sources (jira://, db://): match against source_schemes
 *  3. Returns null if no match
 */
export function lookupBySource(source) {
    const trimmed = source.trim();
    if (trimmed === "")
        return null;
    // URL-based matching
    if (/^https?:\/\//i.test(trimmed)) {
        let url;
        try {
            url = new URL(trimmed);
        }
        catch {
            return null;
        }
        // First pass: patterns with path constraints (more specific)
        for (const agent of _agents.values()) {
            for (const p of agent.source_url_patterns) {
                if (!matchHostname(p.hostname, url.hostname))
                    continue;
                if (p.path_prefix && url.pathname.startsWith(p.path_prefix))
                    return agent;
                if (p.path_contains && url.pathname.includes(p.path_contains))
                    return agent;
            }
        }
        // Second pass: hostname-only patterns
        for (const agent of _agents.values()) {
            for (const p of agent.source_url_patterns) {
                if (p.path_prefix || p.path_contains)
                    continue; // already checked
                if (matchHostname(p.hostname, url.hostname))
                    return agent;
            }
        }
        return null;
    }
    // Scheme-based matching
    const schemeMatch = /^([a-z]+):\/\//i.exec(trimmed);
    if (schemeMatch !== null) {
        const scheme = `${(schemeMatch[1] ?? "").toLowerCase()}://`;
        for (const agent of _agents.values()) {
            if (agent.source_schemes.includes(scheme))
                return agent;
        }
    }
    return null;
}
/** Direct lookup by agent name. */
export function lookupByName(name) {
    return _agents.get(name) ?? null;
}
/** List all registered agents, optionally filtered. */
export function listAgents(filter) {
    let agents = [..._agents.values()];
    if (filter?.type)
        agents = agents.filter((a) => a.type === filter.type);
    if (filter?.origin)
        agents = agents.filter((a) => a.origin === filter.origin);
    return agents;
}
/** Return the set of all registered agent names (for enabledAgents filtering). */
export function registeredAgentIds() {
    const ids = new Set();
    for (const agent of _agents.values()) {
        // Extract the short ID: "wiki-jira-agent" → "jira"
        const short = agent.name.replace(/^wiki-/, "").replace(/-agent$/, "");
        ids.add(short);
    }
    return ids;
}
/**
 * Bootstrap the registry from filesystem discovery + config.
 *
 * Discovery order: builtins → plugins → custom (last wins on name collision).
 */
export function initRegistry(options) {
    clearRegistry();
    // 1. Discover builtin agents
    for (const m of discoverAgents(options.agentsDir, "builtin")) {
        registerAgent(m);
    }
    // 2. Discover plugin agents (e.g. from .claude/plugins/)
    if (options.pluginsDir) {
        for (const m of discoverAgents(options.pluginsDir, "plugin")) {
            registerAgent(m);
        }
    }
    // 3. Register custom agents from config
    if (options.customAgents) {
        for (const cfg of options.customAgents) {
            registerAgent(customConfigToManifest(cfg));
        }
    }
}
function customConfigToManifest(cfg) {
    const label = cfg.name.replace(/^wiki-/, "").replace(/-agent$/, "");
    return {
        name: cfg.name,
        description: cfg.description ?? "",
        type: cfg.type ?? "source",
        autonomy_level: "supervised",
        model: cfg.model ?? "haiku",
        tools: [],
        version: "0.0.0",
        source_schemes: cfg.source_schemes ?? [],
        source_url_patterns: cfg.source_url_patterns ?? [],
        invocation_template: {
            subagent_type: cfg.invocation_template?.subagent_type ?? cfg.name,
            default_model: cfg.invocation_template?.default_model ?? cfg.model ?? "haiku",
            label: cfg.invocation_template?.label ?? label,
        },
        agent_dir: "",
        origin: "custom",
    };
}
// ── CLI ───────────────────────────────────────────────────────────────
function cliMain(argv) {
    const cmd = argv[0];
    const agentsDir = getFlagValue(argv, "--agents-dir") ?? ".claude/agents";
    if (cmd === "list") {
        initRegistry({ agentsDir });
        const filter = {};
        const typeFlag = getFlagValue(argv, "--type");
        if (typeFlag)
            filter.type = typeFlag;
        const agents = listAgents(filter);
        process.stdout.write(JSON.stringify(agents, null, 2) + "\n");
        return 0;
    }
    if (cmd === "lookup") {
        const source = getFlagValue(argv, "--source");
        if (!source) {
            process.stderr.write("--source is required\n");
            return 2;
        }
        initRegistry({ agentsDir });
        const agent = lookupBySource(source);
        if (agent) {
            process.stdout.write(JSON.stringify(agent, null, 2) + "\n");
        }
        else {
            process.stdout.write("null\n");
        }
        return 0;
    }
    process.stderr.write("usage: source_registry.js <list|lookup> [--agents-dir DIR] [--source SRC]\n");
    return 2;
}
function getFlagValue(argv, flag) {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length)
        return undefined;
    return argv[idx + 1];
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(cliMain(process.argv.slice(2)));
}
