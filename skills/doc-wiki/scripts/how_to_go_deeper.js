#!/usr/bin/env node
/**
 * how_to_go_deeper.ts — auto-generated "How to Go Deeper" section.
 *
 * Per v2 design §20 + compilation.md §"How to Go Deeper", every wiki
 * page compiled from EXTERNAL sources (Jira, Confluence, GitHub,
 * Notion, GCP, AWS, a database, or a code file) gets a trailing
 * section that tells future readers / agents exactly which command to
 * run to pull the latest state of the source system.
 *
 * Source-to-connector matching is driven by source_registry's static
 * BUILTIN_PATTERNS. Custom connectors registered via wiki.config.yaml's
 * `ecosystem.agents.custom` block are supported automatically.
 *
 * Hints emit `/doc-wiki:ingest <source>` uniformly — the wiki ingest
 * pipeline (step 7) calls @narai/connector-hub's `gather()`, which
 * picks the right connector from the matched source.
 *
 * Usage as a library:
 *     import { buildHowToGoDeeper } from "./how_to_go_deeper.js";
 *     const section = buildHowToGoDeeper(sources, { enabledAgents });
 *
 * Usage as a CLI:
 *     node how_to_go_deeper.js \
 *       --sources '["jira://AUTH-1","src/auth.py:1-20"]' \
 *       --enabled jira,github
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./_cli_args.js";
import { agentShortId, lookupBySource, ensureRegistryForConfig, _resetRegistryConfigState, resolveWikiConfigPath, } from "../../../agents/lib/source_registry.js";
const LOCAL_RAW_PREFIX = "raw/";
const CODE_EXTS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".kt", ".go", ".rs",
    ".cs", ".rb", ".c", ".h", ".cc", ".cpp", ".hpp", ".swift", ".php",
    ".sql", ".sh",
]);
// ── Registry initialization ──────────────────────────────────────────
function ensureRegistry(wikiRoot) {
    try {
        // Builtins + `ecosystem.agents.custom` from wiki.config.yaml. When the
        // caller passes a wiki root (--wiki-root), its config is used with no
        // cwd fallback; otherwise cwd is probed.
        //
        // The "which config is loaded" state lives in the registry, not here. A
        // local flag went stale as soon as `external_sources.ts` reloaded the same
        // global registry, so a long-lived process that built the section for wiki
        // A and then wiki B classified B with A's custom connectors.
        const configPath = wikiRoot !== undefined
            ? resolveWikiConfigPath(wikiRoot) ?? path.join(wikiRoot, "wiki.config.yaml")
            : undefined;
        ensureRegistryForConfig(configPath);
    }
    catch {
        // Non-fatal: fall through to no-match for all sources
    }
}
/** Reset registry state (test helper). */
export function _resetRegistry() {
    _resetRegistryConfigState();
}
// ── Short ID extraction ──────────────────────────────────────────────
/**
 * Extract the connector ID from a manifest: "wiki-jira-agent" → "jira".
 *
 * Delegates to `source_registry.agentShortId`, which owns the derivation:
 * the `wiki-<id>-agent` unwrap applies to builtins only, and every ID is
 * lowercased so `parseEnabled`'s lowercased `--enabled` tokens match.
 */
function shortId(manifest) {
    return agentShortId(manifest);
}
// ── Hint builder ──────────────────────────────────────────────────────
/**
 * Build a DeepEntry from a matched agent manifest and source string.
 *
 * Hints are uniform: `/doc-wiki:ingest <source>` regardless of connector.
 * The ingest pipeline routes through `@narai/connector-hub`'s `gather()`,
 * which picks the right connector for the given source. Connectors that
 * accept richer params (e.g. Jira JQL) get them from the planner stage,
 * not from a literal CLI hint.
 */
function buildAgentEntry(manifest, source) {
    const id = shortId(manifest);
    const label = manifest.invocation_template.label;
    return {
        agent: id,
        label,
        hint: `\`/doc-wiki:ingest "${source}"\``,
        source,
    };
}
// ── Local source classification (non-agent) ──────────────────────────
function classifyLocal(source) {
    if (source.startsWith(LOCAL_RAW_PREFIX))
        return null;
    const codeMatch = /^([^:]+\.[A-Za-z0-9]+)(?::(\d+(?:-\d+)?))?$/.exec(source);
    if (codeMatch !== null) {
        const file = codeMatch[1] ?? "";
        const ext = path.extname(file).toLowerCase();
        if (CODE_EXTS.has(ext)) {
            return { label: "Live code", hint: `Read \`${source}\``, source };
        }
    }
    return null;
}
// ── Main classifier ──────────────────────────────────────────────────
/** Classify one source string into a bullet, or `null` when we skip it. */
export function classifySource(source) {
    const trimmed = source.trim();
    if (trimmed === "")
        return null;
    if (trimmed.startsWith(LOCAL_RAW_PREFIX))
        return null;
    ensureRegistry();
    // Try URL matching first
    if (/^https?:\/\//i.test(trimmed)) {
        const manifest = lookupBySource(trimmed);
        if (manifest !== null) {
            return buildAgentEntry(manifest, trimmed);
        }
        // Unmatched URL — generic external link
        return { label: "External link", hint: `Open <${trimmed}>`, source: trimmed };
    }
    // Try scheme matching. RFC 3986 scheme grammar:
    // ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) — matches lookupBySource so
    // custom schemes like s3:// or kb-v2:// reach the registry.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        const manifest = lookupBySource(trimmed);
        if (manifest !== null) {
            return buildAgentEntry(manifest, trimmed);
        }
    }
    // Local classification (code refs, file paths)
    const local = classifyLocal(trimmed);
    if (local !== null)
        return local;
    if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.includes("/")) {
        return { label: "Source file", hint: `Read \`${trimmed}\``, source: trimmed };
    }
    return null;
}
// ── Section builder ──────────────────────────────────────────────────
/**
 * Build the "How to Go Deeper" section for a page. Returns `""` when
 * the page has no external sources worth calling out. Pass `wikiRoot`
 * so `ecosystem.agents.custom` patterns load even when the wiki root
 * is not the process cwd.
 */
export function buildHowToGoDeeper(sources, options = {}) {
    ensureRegistry(options.wikiRoot);
    const enabled = options.enabledAgents;
    const bullets = [];
    const seen = new Set();
    for (const s of sources) {
        const entry = classifySource(s);
        if (entry === null)
            continue;
        if (entry.agent && enabled !== undefined && !enabled.has(entry.agent)) {
            bullets.push({
                label: entry.label,
                hint: `${entry.source} — enable the \`${entry.agent}\` connector in \`.connectors/config.yaml\` to ingest this live`,
                source: entry.source,
            });
            continue;
        }
        if (seen.has(entry.source))
            continue;
        seen.add(entry.source);
        bullets.push(entry);
    }
    if (bullets.length === 0)
        return "";
    const lines = [];
    lines.push("## How to Go Deeper");
    lines.push("");
    for (const b of bullets) {
        lines.push(`- **${b.label}:** ${b.hint}`);
    }
    lines.push("");
    return lines.join("\n");
}
// ── CLI ──────────────────────────────────────────────────────────────
const FLAG_SPEC = {
    "--sources": "sources",
    "--enabled": "enabled",
    "--wiki-root": "wikiRoot",
};
const HELP_TEXT = `usage: how_to_go_deeper.js --sources JSON_ARRAY [--enabled csv] [--wiki-root DIR]

Emit the "How to Go Deeper" markdown section for a page's sources.

arguments:
  --sources JSON_ARRAY  JSON array of source strings (the frontmatter
                        \`sources:\` field, JSON-encoded)
  --enabled csv         Comma-separated list of enabled source agents
                        (e.g. jira,github,db). When omitted, all hints
                        are rendered.
  --wiki-root DIR       Wiki root whose wiki.config.yaml supplies
                        \`ecosystem.agents.custom\` patterns. When
                        omitted, the working directory is probed.
options:
  -h, --help            show this help message and exit
`;
function parseEnabled(csv) {
    const out = new Set();
    for (const tok of csv.split(",")) {
        const trimmed = tok.trim().toLowerCase();
        if (trimmed !== "")
            out.add(trimmed);
    }
    return out;
}
export function main(argv = process.argv.slice(2)) {
    if (argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    let parsed;
    try {
        parsed = parseFlags(argv, FLAG_SPEC);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (parsed.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    const sourcesRaw = parsed.values["sources"];
    if (typeof sourcesRaw !== "string" || sourcesRaw === "") {
        process.stderr.write("the following arguments are required: --sources\n");
        return 2;
    }
    let sources;
    try {
        sources = JSON.parse(sourcesRaw);
    }
    catch (e) {
        process.stderr.write(`--sources is not valid JSON: ${e.message}\n`);
        return 2;
    }
    if (!Array.isArray(sources) || !sources.every((s) => typeof s === "string")) {
        process.stderr.write("--sources must be a JSON array of strings\n");
        return 2;
    }
    let enabled;
    const enabledRaw = parsed.values["enabled"];
    if (typeof enabledRaw === "string" && enabledRaw !== "") {
        enabled = parseEnabled(enabledRaw);
    }
    let wikiRoot;
    const wikiRootRaw = parsed.values["wikiRoot"];
    if (typeof wikiRootRaw === "string" && wikiRootRaw !== "") {
        wikiRoot = wikiRootRaw;
    }
    const out = buildHowToGoDeeper(sources, {
        enabledAgents: enabled,
        wikiRoot,
    });
    process.stdout.write(out);
    return 0;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
