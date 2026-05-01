#!/usr/bin/env node
/**
 * source_registry.ts — Source-to-connector matching registry.
 *
 * Given a source string (URL or scheme), returns the connector that
 * handles it. The wiki uses this to classify external sources for the
 * "How to Go Deeper" section and to emit `/doc-wiki:ingest` hints targeted
 * at the right connector.
 *
 * Builtin patterns are static — one entry per @narai/*-agent-connector
 * the wiki knows about. Custom patterns can be registered via
 * `wiki.config.yaml`'s `ecosystem.agents.custom` block (e.g. an
 * internal kb:// scheme).
 *
 * Usage as a library:
 *   import { initRegistry, lookupBySource } from "./source_registry.js";
 *   initRegistry();
 *   const agent = lookupBySource("db://dev/users");
 *
 * Usage as a CLI:
 *   node source_registry.js list
 *   node source_registry.js lookup --source "jira://AUTH-1"
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const BUILTIN_PATTERNS = [
    {
        id: "jira",
        type: "source",
        source_schemes: ["jira://"],
        source_url_patterns: [
            { hostname: "*.atlassian.net", path_prefix: "/browse/" },
        ],
        label: "Jira",
    },
    {
        id: "confluence",
        type: "source",
        source_schemes: ["confluence://"],
        source_url_patterns: [
            { hostname: "*.atlassian.net", path_prefix: "/wiki/" },
            { hostname: "*.atlassian.net", path_contains: "/spaces/" },
        ],
        label: "Confluence",
    },
    {
        id: "github",
        type: "source",
        source_schemes: ["gh://", "github://"],
        source_url_patterns: [
            { hostname: "github.com" },
            { hostname: "*.github.com" },
        ],
        label: "GitHub",
    },
    {
        id: "notion",
        type: "source",
        source_schemes: ["notion://"],
        source_url_patterns: [
            { hostname: "notion.so" },
            { hostname: "*.notion.site" },
        ],
        label: "Notion",
    },
    {
        id: "gcp",
        type: "source",
        source_schemes: ["gcp://"],
        source_url_patterns: [
            { hostname: "*.cloud.google.com" },
            { hostname: "*.googleapis.com" },
        ],
        label: "GCP",
    },
    {
        id: "aws",
        type: "source",
        source_schemes: ["aws://"],
        source_url_patterns: [
            { hostname: "*.amazonaws.com" },
            { hostname: "*.aws.amazon.com" },
        ],
        label: "AWS",
    },
    {
        id: "db",
        type: "database",
        source_schemes: ["db://"],
        source_url_patterns: [],
        label: "Database",
    },
];
/**
 * Builtin connector short IDs (e.g. "jira", "confluence", "github").
 * Read-only view over `BUILTIN_PATTERNS` — does NOT mutate the global
 * registry. Use this when you only need the connector names (atlas
 * integration-keyword detection, doc generation), not full manifests.
 */
export function builtinConnectorIds() {
    return BUILTIN_PATTERNS.map((p) => p.id);
}
function patternToManifest(p) {
    const name = `wiki-${p.id}-agent`;
    return {
        name,
        description: "",
        type: p.type,
        autonomy_level: "supervised",
        model: "haiku",
        tools: [],
        version: "1.0.0",
        source_schemes: [...p.source_schemes],
        source_url_patterns: p.source_url_patterns.map((u) => ({ ...u })),
        invocation_template: {
            subagent_type: name,
            default_model: "haiku",
            label: p.label,
        },
        agent_dir: "",
        origin: "builtin",
    };
}
// ── Registry state ────────────────────────────────────────────────────
const _agents = new Map();
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
/** Return the set of all registered agent short IDs (for enabledAgents filtering). */
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
 * Bootstrap the registry from the static builtin pattern list + custom
 * agents from config. Idempotent — clears any prior state first.
 *
 * Order: builtins → custom (custom wins on name collision, allowing a
 * user to override a builtin pattern).
 */
export function initRegistry(options = {}) {
    clearRegistry();
    // 1. Builtins from the static pattern list
    for (const p of BUILTIN_PATTERNS) {
        registerAgent(patternToManifest(p));
    }
    // 2. Custom agents from wiki.config.yaml
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
    if (cmd === "list") {
        initRegistry();
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
        initRegistry();
        const agent = lookupBySource(source);
        if (agent) {
            process.stdout.write(JSON.stringify(agent, null, 2) + "\n");
        }
        else {
            process.stdout.write("null\n");
        }
        return 0;
    }
    process.stderr.write("usage: source_registry.js <list|lookup> [--source SRC] [--type TYPE]\n");
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
