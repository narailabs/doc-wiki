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
 *   import { initRegistryFromConfig, lookupBySource } from "./source_registry.js";
 *   initRegistryFromConfig();   // builtins + ecosystem.agents.custom
 *   const agent = lookupBySource("db://dev/users");
 *
 * Usage as a CLI:
 *   node source_registry.js list
 *   node source_registry.js lookup --source "jira://AUTH-1"
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { parseConfig } from "./parse_config.js";
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
        id: "gitlab",
        type: "source",
        source_schemes: ["gitlab://"],
        source_url_patterns: [
            { hostname: "gitlab.com" },
            { hostname: "*.gitlab.com" },
        ],
        label: "GitLab",
    },
    {
        id: "linear",
        type: "source",
        source_schemes: ["linear://"],
        source_url_patterns: [{ hostname: "linear.app" }],
        label: "Linear",
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
// ── Custom agents from wiki.config.yaml ───────────────────────────────
/**
 * Resolve the wiki.config.yaml to load custom agents from. Explicit path
 * wins; otherwise probe `<cwd>/wiki.config.yaml` then
 * `<cwd>/wiki/wiki.config.yaml` — the same locations `atlas_inventory.ts`
 * probes, with cwd standing in for the wiki root (the classification
 * scripts run from there). Returns null when no config exists.
 */
function resolveWikiConfigPath(configPath) {
    const candidates = configPath !== undefined
        ? [configPath]
        : [
            path.join(process.cwd(), "wiki.config.yaml"),
            path.join(process.cwd(), "wiki", "wiki.config.yaml"),
        ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate))
            return candidate;
    }
    return null;
}
function warnCustomAgents(msg) {
    process.stderr.write(`[source_registry] ${msg}\n`);
}
/**
 * Validate one `ecosystem.agents.custom` entry. Returns null (after a
 * stderr warning) when the entry is malformed — a bad entry is skipped,
 * never fatal, so one typo can't take down an ingest run.
 */
function validateCustomAgentEntry(entry, index, configPath) {
    const where = `ecosystem.agents.custom[${index}] in ${configPath}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        warnCustomAgents(`skipping ${where}: expected a mapping, got ${JSON.stringify(entry)}`);
        return null;
    }
    const e = entry;
    const name = e["name"];
    if (typeof name !== "string" || name.trim() === "") {
        warnCustomAgents(`skipping ${where}: "name" (non-empty string) is required`);
        return null;
    }
    const schemes = e["source_schemes"];
    if (schemes !== undefined &&
        (!Array.isArray(schemes) || !schemes.every((s) => typeof s === "string"))) {
        warnCustomAgents(`skipping ${where}: "source_schemes" must be a list of strings`);
        return null;
    }
    const urlPatterns = e["source_url_patterns"];
    if (urlPatterns !== undefined &&
        (!Array.isArray(urlPatterns) ||
            !urlPatterns.every((p) => p !== null &&
                typeof p === "object" &&
                !Array.isArray(p) &&
                typeof p["hostname"] === "string"))) {
        warnCustomAgents(`skipping ${where}: every "source_url_patterns" entry needs a "hostname" string`);
        return null;
    }
    const invocation = e["invocation_template"];
    if (invocation !== undefined &&
        (invocation === null || typeof invocation !== "object" || Array.isArray(invocation))) {
        warnCustomAgents(`skipping ${where}: "invocation_template" must be a mapping`);
        return null;
    }
    const out = { name };
    if (typeof e["description"] === "string")
        out.description = e["description"];
    if (typeof e["type"] === "string")
        out.type = e["type"];
    if (typeof e["model"] === "string")
        out.model = e["model"];
    if (schemes !== undefined)
        out.source_schemes = schemes;
    if (urlPatterns !== undefined)
        out.source_url_patterns = urlPatterns;
    if (invocation !== undefined)
        out.invocation_template = invocation;
    return out;
}
/**
 * Load `ecosystem.agents.custom` entries from a wiki.config.yaml.
 *
 * Degrades gracefully — this feeds the ingest path, so a broken custom
 * block must never abort a run:
 *  - missing config file → `[]` (no wiki config is a normal state)
 *  - unparseable / invalid config → stderr warning + `[]`
 *  - malformed entry → stderr warning + that entry skipped
 */
export function loadCustomAgentConfigs(configPath) {
    const resolved = resolveWikiConfigPath(configPath);
    if (resolved === null)
        return [];
    let config;
    try {
        config = parseConfig(resolved);
    }
    catch (e) {
        warnCustomAgents(`ignoring custom agents — failed to load ${resolved}: ${e.message}`);
        return [];
    }
    // parseConfig guarantees `ecosystem` is an object; `agents` is passthrough.
    const ecosystem = config["ecosystem"];
    const agents = ecosystem["agents"];
    if (agents === null || agents === undefined || typeof agents !== "object")
        return [];
    const custom = agents["custom"];
    if (custom === undefined || custom === null)
        return [];
    if (!Array.isArray(custom)) {
        warnCustomAgents(`ignoring ecosystem.agents.custom in ${resolved}: expected a list, got ${typeof custom}`);
        return [];
    }
    const out = [];
    for (let i = 0; i < custom.length; i++) {
        const validated = validateCustomAgentEntry(custom[i], i, resolved);
        if (validated !== null)
            out.push(validated);
    }
    return out;
}
/**
 * `initRegistry` with custom agents loaded from `wiki.config.yaml` in one
 * call. This is the ingest-path bootstrap: `how_to_go_deeper.ts` and
 * `external_sources.ts` initialize through here so patterns registered
 * via `ecosystem.agents.custom` actually participate in classification.
 */
export function initRegistryFromConfig(configPath) {
    initRegistry({ customAgents: loadCustomAgentConfigs(configPath) });
}
// ── Connector config ──────────────────────────────────────────────────
/**
 * Read the set of CONFIGURED connector ids from a `.connectors/config.yaml`.
 *
 * Schema: top-level `connectors:` map; a child key is "configured" when its
 * value is a map with `enabled: true` (or, lenient: when the key is present
 * with a truthy/empty map and not `enabled: false`).
 *
 * Default search path: `<cwd>/.connectors/config.yaml` then
 * `~/.connectors/config.yaml` (first that exists).
 *
 * Returns an empty Set when no config exists or it's malformed.
 */
export function loadConfiguredConnectorIds(configPath) {
    const resolved = resolveConnectorConfigPath(configPath);
    if (resolved === null)
        return new Set();
    let raw;
    try {
        raw = fs.readFileSync(resolved, "utf-8");
    }
    catch {
        return new Set();
    }
    let parsed;
    try {
        parsed = yaml.load(raw);
    }
    catch {
        return new Set();
    }
    if (parsed === null ||
        typeof parsed !== "object" ||
        !("connectors" in parsed)) {
        return new Set();
    }
    const connectors = parsed["connectors"];
    if (connectors === null || typeof connectors !== "object")
        return new Set();
    const ids = new Set();
    for (const [id, val] of Object.entries(connectors)) {
        // Exclude only when explicitly disabled (enabled === false).
        if (val !== null && typeof val === "object" && val["enabled"] === false) {
            continue;
        }
        ids.add(id);
    }
    return ids;
}
function resolveConnectorConfigPath(configPath) {
    if (configPath !== undefined) {
        return configPath;
    }
    const localPath = path.join(process.cwd(), ".connectors", "config.yaml");
    if (fs.existsSync(localPath))
        return localPath;
    const homePath = path.join(os.homedir(), ".connectors", "config.yaml");
    if (fs.existsSync(homePath))
        return homePath;
    return null;
}
// ── CLI ───────────────────────────────────────────────────────────────
function cliMain(argv) {
    const cmd = argv[0];
    if (cmd === "list") {
        initRegistryFromConfig();
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
        initRegistryFromConfig();
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
