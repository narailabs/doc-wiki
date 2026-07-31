#!/usr/bin/env node
/**
 * Read-only input assembly for `/doc-wiki:atlas` Phase 7 (global synthesis).
 *
 * Each global page (`overview`, `integrations`, `deploy`) has its own input
 * shape — different per-topic pages contribute, different config files are
 * relevant. This module is the canonical place to assemble those bundles
 * so the orchestrator skill doesn't hand-roll the file walking.
 *
 * Used as a library:
 *     import { assembleOverviewInputs } from "../agents/lib/atlas_synthesize.js";
 *     const bundle = assembleOverviewInputs(wikiRoot);
 *     // hand bundle.text + bundle.sources to the LLM synthesis step.
 *
 * Used as a CLI:
 *     node agents/lib/atlas_synthesize.js overview      --wiki-root <p>
 *     node agents/lib/atlas_synthesize.js integrations  --wiki-root <p> [--connectors-config <p>]
 *     node agents/lib/atlas_synthesize.js deploy        --wiki-root <p> [--repo-root <p>]
 *
 * Each subcommand prints one JSON object on stdout with keys
 *   { sources, text, notes }.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { parseFrontmatter } from "../../skills/doc-wiki/scripts/_frontmatter.js";
import { formatPhaseFlow, } from "./mermaid_format.js";
import { walkRepoTargets } from "./repo_walker.js";
import { builtinConnectorIds } from "./source_registry.js";
/**
 * Walk `<wikiRoot>/wiki/` and yield every `.md` page whose frontmatter has a
 * `atlas_facet` field matching one of `wantedFacets`. The wanted facets
 * default to all known facets; pass a smaller set to filter (e.g. just
 * `architecture` for the overview bundle).
 */
function _findAtlasPages(wikiRoot, wantedFacets) {
    const wikiContent = path.join(wikiRoot, "wiki");
    if (!fs.existsSync(wikiContent))
        return [];
    const out = [];
    const wanted = wantedFacets ? new Set(wantedFacets) : null;
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                // Skip _-prefixed dirs (archive, drafts, etc.) — see _wiki_fs.ts EXCLUDE_PREFIX
                if (!e.name.startsWith("_"))
                    walk(full);
                continue;
            }
            if (!e.isFile() || !full.endsWith(".md"))
                continue;
            let body;
            try {
                body = fs.readFileSync(full, "utf-8");
            }
            catch {
                continue;
            }
            const { frontmatter, body: pageBody } = parseFrontmatter(body);
            if (!frontmatter)
                continue;
            const facet = frontmatter["atlas_facet"];
            if (typeof facet !== "string" || facet.length === 0)
                continue;
            if (wanted !== null && !wanted.has(facet))
                continue;
            out.push({
                page: path.relative(wikiRoot, full).split(path.sep).join("/"),
                facet,
                body: pageBody,
                frontmatter,
            });
        }
    };
    walk(wikiContent);
    out.sort((a, b) => a.page.localeCompare(b.page));
    return out;
}
/**
 * Pull the TL;DR section of a page body, defined as the contents between
 * `## TL;DR` and the next `## ` header (or end of body). Returns the empty
 * string when no TL;DR section is present.
 */
function _extractTldr(body) {
    const re = /^## TL;DR\s*\n([\s\S]*?)(?=^## |\Z)/m;
    const m = body.match(re);
    if (!m)
        return "";
    return (m[1] ?? "").trim();
}
/**
 * Resolve the page's audience for routing purposes. Honors an explicit
 * `audience` frontmatter field if present; otherwise falls back to a default
 * derived from the `atlas_facet`. Mirrors the table documented in
 * `references/compilation.md` ("Additional frontmatter for atlas pages").
 */
function _inferAudience(facet, frontmatterAudience) {
    if (typeof frontmatterAudience === "string" &&
        frontmatterAudience.length > 0) {
        return frontmatterAudience;
    }
    switch (facet) {
        case "getting-started":
            return "new-user";
        case "commands":
        case "configuration":
        case "operations":
            return "operator";
        case "architecture":
        case "data-model":
        case "environments":
        case "overview":
            return "contributor";
        case "api":
        case "integrations":
        case "deploy":
            return "integrator";
        case "troubleshooting":
            return "debugger";
        default:
            return "contributor";
    }
}
// ── Overview bundle ────────────────────────────────────────────────
/**
 * Assemble the input for `wiki/overview.md` synthesis: every per-topic
 * `architecture.md` body in full, plus the TL;DR sections of the other per-
 * topic facets, prefixed by an audience-routing table generated from each
 * page's `audience` frontmatter field (default-inferred from facet). The
 * routing table mirrors `docs/README.md`'s "Where to start" section so the
 * synthesized overview can route human readers to the right depth.
 */
export function assembleOverviewInputs(wikiRoot) {
    const allPages = _findAtlasPages(wikiRoot);
    const arch = allPages.filter((p) => p.facet === "architecture");
    const others = allPages.filter((p) => p.facet === "data-model" ||
        p.facet === "environments" ||
        p.facet === "api" ||
        p.facet === "operations");
    const sources = [];
    const parts = [];
    const notes = [];
    // Audience-routing table at the top — gives the LLM a structural anchor
    // for the synthesized page's "Where to start" section.
    if (allPages.length > 0) {
        const grouped = new Map();
        for (const page of allPages) {
            const audience = _inferAudience(page.facet, page.frontmatter["audience"]);
            const list = grouped.get(audience);
            if (list)
                list.push(page.page);
            else
                grouped.set(audience, [page.page]);
        }
        parts.push("## Audience routing\n");
        parts.push("| Audience | Pages |");
        parts.push("|---|---|");
        const order = [
            "new-user",
            "operator",
            "contributor",
            "integrator",
            "debugger",
        ];
        for (const audience of order) {
            const pages = grouped.get(audience);
            if (!pages || pages.length === 0)
                continue;
            parts.push(`| ${audience} | ${pages.join(", ")} |`);
        }
        // Surface any audience labels not in the canonical order at the end.
        for (const [audience, pages] of grouped) {
            if (order.includes(audience))
                continue;
            parts.push(`| ${audience} | ${pages.join(", ")} |`);
        }
        parts.push("");
    }
    if (arch.length === 0) {
        notes.push("no architecture.md pages found — overview will be sparse");
    }
    for (const page of arch) {
        sources.push(page.page);
        parts.push(`# ${page.page}\n\n${page.body.trim()}\n`);
    }
    if (others.length > 0) {
        parts.push("## Per-facet TL;DRs\n");
        for (const page of others) {
            sources.push(page.page);
            const tldr = _extractTldr(page.body);
            const summary = tldr.length > 0 ? tldr : "(no TL;DR section)";
            parts.push(`### ${page.page} (${page.facet})\n\n${summary}\n`);
        }
    }
    return { sources, text: parts.join("\n"), notes };
}
// ── Integrations bundle ────────────────────────────────────────────
/**
 * Default lookup paths for the connector config. The first existing file
 * wins; the orchestrator may override via `--connectors-config`.
 */
function _defaultConnectorConfigPaths() {
    return [
        path.join(process.cwd(), ".connectors", "config.yaml"),
        path.join(os.homedir(), ".connectors", "config.yaml"),
    ];
}
/**
 * Assemble the input for `wiki/integrations.md` synthesis: every per-topic
 * `api.md` page plus external-service mentions in `architecture.md` pages
 * (heuristic: any line that mentions a connector ID like `jira`, `github`,
 * `notion`, `aws`, `gcp`, `confluence`, `db`), plus the connector config
 * file if accessible.
 */
export function assembleIntegrationsInputs(wikiRoot, connectorsConfigPath) {
    const sources = [];
    const parts = [];
    const notes = [];
    const apis = _findAtlasPages(wikiRoot, ["api"]);
    if (apis.length === 0) {
        notes.push("no api.md pages found — integrations will draw only from architecture mentions");
    }
    for (const page of apis) {
        sources.push(page.page);
        parts.push(`# ${page.page}\n\n${page.body.trim()}\n`);
    }
    // Architecture pages — extract external-service-ish lines.
    const archPages = _findAtlasPages(wikiRoot, ["architecture"]);
    const integrationKeywords = _getIntegrationKeywords();
    for (const page of archPages) {
        const lines = page.body.split("\n");
        const hits = [];
        for (const line of lines) {
            const lower = line.toLowerCase();
            for (const kw of integrationKeywords) {
                if (lower.includes(kw)) {
                    hits.push(line.trim());
                    break;
                }
            }
        }
        if (hits.length > 0) {
            sources.push(page.page);
            parts.push(`## external-mentions in ${page.page}\n\n${hits.join("\n")}\n`);
        }
    }
    // Connector config (read-only; redact nothing — it lives outside the wiki).
    const candidates = connectorsConfigPath && connectorsConfigPath.length > 0
        ? [connectorsConfigPath]
        : _defaultConnectorConfigPaths();
    for (const p of candidates) {
        if (!fs.existsSync(p))
            continue;
        try {
            const body = fs.readFileSync(p, "utf-8");
            sources.push(p);
            parts.push(`## connectors config: ${p}\n\n\`\`\`yaml\n${body}\n\`\`\`\n`);
            break;
        }
        catch {
            notes.push(`could not read connector config at ${p}`);
        }
    }
    return { sources, text: parts.join("\n"), notes };
}
// ── Deploy bundle ──────────────────────────────────────────────────
const DEPLOY_FILE_GLOBS = [
    /^Dockerfile(\.[^/]+)?$/,
    /^docker-compose(\.[^/]+)?\.ya?ml$/,
    /^Jenkinsfile$/,
    /^Procfile$/,
    /^Makefile$/,
];
const DEPLOY_DIR_PATTERNS = [
    { dir: ".github/workflows", rx: /\.ya?ml$/ },
    { dir: ".gitlab", rx: /\.ya?ml$/ },
    { dir: "terraform", rx: /\.tf$/ },
    { dir: "deploy", rx: /\.ya?ml$/ },
    { dir: "k8s", rx: /\.ya?ml$/ },
];
/**
 * Body-truncation cap for files inlined into a synthesis bundle. Beyond
 * this, the file is sliced and a marker line is appended so the LLM sees
 * the truncation. Tuned to keep a single bundle well under the synthesis
 * context budget while preserving most real-world config / Dockerfile /
 * workflow content.
 */
const _BUNDLE_FILE_TRUNCATE_BYTES = 200 * 1024;
/**
 * Read each `paths` entry under `repoRoot`, truncate at
 * {@link _BUNDLE_FILE_TRUNCATE_BYTES}, and format as a fenced
 * `## <rel>` section. Per-file read failures append to `notes` and skip
 * the file. Shared by `assembleDeployInputs` and
 * `assembleConfigurationInputs`.
 */
function _readAndFormatBundleFiles(repoRoot, paths, notes) {
    const parts = [];
    for (const rel of paths) {
        const abs = path.join(repoRoot, rel);
        let body;
        try {
            body = fs.readFileSync(abs, "utf-8");
        }
        catch {
            notes.push(`could not read ${rel}`);
            continue;
        }
        const truncated = body.length > _BUNDLE_FILE_TRUNCATE_BYTES
            ? body.slice(0, _BUNDLE_FILE_TRUNCATE_BYTES) + "\n... [truncated]\n"
            : body;
        parts.push(`## ${rel}\n\n\`\`\`\n${truncated}\n\`\`\`\n`);
    }
    return parts;
}
/**
 * Walk the repo root looking for canonical build/deploy files. Returns
 * the relative paths (sorted) plus a concatenated text bundle the
 * orchestrator passes to `/doc-wiki:ingest --output wiki/deploy.md`.
 *
 * Big files (>200 KB) are truncated with a marker line — full inclusion
 * would blow the synthesis context budget for little additional value.
 */
export function assembleDeployInputs(repoRoot) {
    const { paths, notes } = walkRepoTargets(repoRoot, {
        topLevelBasenames: DEPLOY_FILE_GLOBS,
        subdirPatterns: DEPLOY_DIR_PATTERNS,
    });
    if (paths.length === 0) {
        notes.push("no build/deploy files matched — wiki/deploy.md will be sparse");
        return { sources: [], text: "", notes };
    }
    const parts = _readAndFormatBundleFiles(repoRoot, paths, notes);
    return { sources: [...paths], text: parts.join("\n"), notes };
}
/**
 * Sourced integration-keyword list. Used by `assembleIntegrationsInputs`
 * to scan architecture pages for external-service mentions. Pulls
 * builtin connector ids from `source_registry` (data-driven; satisfies
 * architecture invariant #6) and unions in a curated list of common SaaS
 * integrations that aren't bundled connectors but are still worth
 * surfacing in the synthesized integrations page.
 *
 * The `db` connector is excluded — it's a database connector, not an
 * external service in the sense the integrations page covers.
 *
 * Some connector ids whose bare name is too ambiguous for a substring
 * scan are mapped to more specific, unambiguous tokens. `linear` is an
 * extremely common technical word ("linear time", "linear backoff",
 * "nonlinear"), so it's scanned as its source signals `linear.app` and
 * `linear://` instead — those still catch genuine Linear URLs and
 * `linear://` scheme mentions in architecture pages while avoiding
 * false-positive integration mentions from ordinary prose.
 */
const _KEYWORD_OVERRIDES = {
    linear: ["linear.app", "linear://"],
};
const _COMMON_SAAS_KEYWORDS = [
    "stripe",
    "datadog",
    "sentry",
    "auth0",
    "okta",
    "twilio",
    "sendgrid",
];
function _getIntegrationKeywords() {
    const fromRegistry = builtinConnectorIds()
        .filter((id) => id !== "db")
        .flatMap((id) => _KEYWORD_OVERRIDES[id] ?? [id]);
    return [...new Set([...fromRegistry, ..._COMMON_SAAS_KEYWORDS])];
}
// ── Commands bundle ────────────────────────────────────────────────
/**
 * Build a Mermaid `flowchart TD` showing the slash-command fan-out:
 * User → each `/<command>` → skill orchestrator. Project-agnostic — the
 * shape is identical for any repo, only the command list varies.
 *
 * Returned as a fenced Mermaid block wrapped in `<!-- mermaid-seed -->`
 * markers so the synthesis step (the orchestrator LLM) preserves it
 * verbatim or refines without re-deriving the topology from the bundle
 * text. Idempotent: passing the same slug list yields the same code.
 */
function _commandsLifecycleSeed(slugs) {
    if (slugs.length === 0)
        return "";
    const nodes = [
        { id: "user", label: "User", className: "actor" },
        { id: "orch", label: "doc-wiki<br/>skill orchestrator", className: "orch" },
    ];
    const edges = [];
    for (const slug of slugs) {
        const id = "cmd_" + slug.replace(/[^a-z0-9]/gi, "_");
        nodes.push({ id, label: `/${slug}`, className: "cmd" });
        edges.push({ from: "user", to: id });
        edges.push({ from: id, to: "orch" });
    }
    const classDefs = [
        { name: "actor", fill: "#cfe2f3", stroke: "#0c5394" },
        { name: "cmd", fill: "#fff3cd", stroke: "#856404" },
        { name: "orch", fill: "#d4edda", stroke: "#155724" },
    ];
    const block = formatPhaseFlow("slash-command fan-out", nodes, edges, classDefs);
    return [
        "<!-- mermaid-seed: slash-command fan-out — preserve in synthesized page -->",
        "```mermaid",
        block.code,
        "```",
        "<!-- /mermaid-seed -->",
        "",
    ].join("\n");
}
/**
 * Assemble the input for `wiki/commands.md` synthesis: a Mermaid flowchart
 * seed of the slash-command fan-out, every `commands/*.md` wrapper file in
 * the repo, plus any `### /` headings extracted from the project's
 * `SKILL.md` files. The intent is to give the LLM all the slash-command
 * surface area plus a structural anchor for the diagram, so it can produce
 * a single operator-friendly reference page with a real Mermaid block.
 */
export function assembleCommandsInputs(repoRoot) {
    const sources = [];
    const parts = [];
    const notes = [];
    const slugs = [];
    // commands/*.md wrappers
    const commandsDir = path.join(repoRoot, "commands");
    if (fs.existsSync(commandsDir)) {
        let files;
        try {
            files = fs
                .readdirSync(commandsDir)
                .filter((f) => f.endsWith(".md"))
                .sort();
        }
        catch {
            files = [];
            notes.push(`could not read ${commandsDir}`);
        }
        for (const f of files) {
            const abs = path.join(commandsDir, f);
            try {
                const body = fs.readFileSync(abs, "utf-8");
                const rel = path.posix.join("commands", f);
                sources.push(rel);
                parts.push(`## ${rel}\n\n${body.trim()}\n`);
                slugs.push(f.replace(/\.md$/, ""));
            }
            catch {
                notes.push(`could not read commands/${f}`);
            }
        }
    }
    else {
        notes.push("no commands/ directory — commands page will be sparse");
    }
    // Prepend the Mermaid seed so the LLM sees the diagram before the
    // per-command bodies. Skipped silently when no commands/ exists.
    const seed = _commandsLifecycleSeed(slugs);
    if (seed.length > 0)
        parts.unshift(seed);
    // ### / headings extracted from any SKILL.md under skills/
    const skillsDir = path.join(repoRoot, "skills");
    if (fs.existsSync(skillsDir)) {
        const skillFiles = [];
        const walk = (d) => {
            let entries;
            try {
                entries = fs.readdirSync(d, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of entries) {
                const full = path.join(d, e.name);
                if (e.isDirectory())
                    walk(full);
                else if (e.isFile() && e.name === "SKILL.md")
                    skillFiles.push(full);
            }
        };
        walk(skillsDir);
        for (const skillFile of skillFiles) {
            let body;
            try {
                body = fs.readFileSync(skillFile, "utf-8");
            }
            catch {
                continue;
            }
            const headings = [];
            for (const line of body.split("\n")) {
                if (/^###\s+\//.test(line))
                    headings.push(line.trim());
            }
            if (headings.length > 0) {
                const rel = path
                    .relative(repoRoot, skillFile)
                    .split(path.sep)
                    .join("/");
                sources.push(rel);
                parts.push(`## Slash-command headings in ${rel}\n\n${headings.join("\n")}\n`);
            }
        }
    }
    return { sources, text: parts.join("\n"), notes };
}
// ── Getting-started bundle ─────────────────────────────────────────
const _BOOTSTRAP_FILE_CANDIDATES = [
    "setup.sh",
    "bootstrap.sh",
    "install.sh",
    "Makefile",
];
/**
 * Assemble the input for `wiki/getting-started.md` synthesis: top-level
 * README + package.json scripts + any common bootstrap files (setup.sh,
 * Makefile, etc.). Gives the LLM enough raw material to produce a
 * numbered first-run walkthrough for new users.
 */
export function assembleGettingStartedInputs(repoRoot) {
    const sources = [];
    const parts = [];
    const notes = [];
    // README.md (truncated if huge)
    const readmePath = path.join(repoRoot, "README.md");
    if (fs.existsSync(readmePath)) {
        try {
            const body = fs.readFileSync(readmePath, "utf-8");
            const truncated = body.length > 50 * 1024
                ? body.slice(0, 50 * 1024) + "\n... [truncated]\n"
                : body;
            sources.push("README.md");
            parts.push(`## README.md\n\n${truncated}\n`);
        }
        catch {
            notes.push("could not read README.md");
        }
    }
    else {
        notes.push("no README.md — getting-started will be sparse");
    }
    // package.json scripts (Node projects)
    const pkgPath = path.join(repoRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
        try {
            const body = fs.readFileSync(pkgPath, "utf-8");
            const json = JSON.parse(body);
            if (json.scripts && Object.keys(json.scripts).length > 0) {
                sources.push("package.json");
                parts.push("## package.json scripts\n\n```json\n" +
                    JSON.stringify(json.scripts, null, 2) +
                    "\n```\n");
            }
        }
        catch {
            notes.push("could not parse package.json");
        }
    }
    // Bootstrap-y top-level files
    for (const name of _BOOTSTRAP_FILE_CANDIDATES) {
        const p = path.join(repoRoot, name);
        if (!fs.existsSync(p))
            continue;
        try {
            const body = fs.readFileSync(p, "utf-8");
            const truncated = body.length > 50 * 1024
                ? body.slice(0, 50 * 1024) + "\n... [truncated]\n"
                : body;
            sources.push(name);
            parts.push(`## ${name}\n\n\`\`\`\n${truncated}\n\`\`\`\n`);
        }
        catch {
            notes.push(`could not read ${name}`);
        }
    }
    return { sources, text: parts.join("\n"), notes };
}
// ── Configuration bundle ───────────────────────────────────────────
const _CONFIGURATION_FILE_GLOBS = [
    /^[a-z][a-z0-9-]*\.config\.(ya?ml|json|toml)$/i,
    /^wiki\.config\.ya?ml$/i,
    /^\.env\.example$/i,
    /^\.env\.template$/i,
    /^\.env\.sample$/i,
    /^pyproject\.toml$/i,
    /^Cargo\.toml$/i,
    /^setup\.cfg$/i,
    /^settings\.gradle(\.kts)?$/i,
    /^application\.(properties|ya?ml)$/i,
];
const _CONFIGURATION_DIR_PATTERNS = [
    { dir: "config", rx: /\.(ya?ml|json|toml|conf|ini|properties)$/i },
    { dir: ".connectors", rx: /\.ya?ml$/i },
];
/**
 * Assemble the input for `wiki/configuration.md` synthesis: top-level
 * configuration files (wiki.config.yaml, *.config.yaml, .env.example, …)
 * plus the contents of `config/` and `.connectors/` directories. Gives
 * the LLM enough surface to produce an operator-facing schema reference.
 *
 * Big files (>200 KB) are truncated; a `... [truncated]` marker is left
 * inline so the synthesis step can note the truncation when relevant.
 */
export function assembleConfigurationInputs(repoRoot) {
    const { paths, notes } = walkRepoTargets(repoRoot, {
        topLevelBasenames: _CONFIGURATION_FILE_GLOBS,
        subdirPatterns: _CONFIGURATION_DIR_PATTERNS,
    });
    if (paths.length === 0) {
        notes.push("no configuration files matched — wiki/configuration.md will be sparse");
        return { sources: [], text: "", notes };
    }
    const parts = _readAndFormatBundleFiles(repoRoot, paths, notes);
    return { sources: [...paths], text: parts.join("\n"), notes };
}
// ── Troubleshooting bundle ─────────────────────────────────────────
const _TROUBLESHOOTING_EVENT_LIMIT = 30;
function _isErrorEvent(rec) {
    if (rec["error"] !== undefined && rec["error"] !== null)
        return true;
    if (rec["status"] === "failed" || rec["status"] === "error")
        return true;
    const details = rec["details"];
    if (details && typeof details === "object" && !Array.isArray(details)) {
        const d = details;
        if (d["error"] !== undefined && d["error"] !== null)
            return true;
        if (d["status"] === "failed" || d["status"] === "error")
            return true;
    }
    return false;
}
/**
 * Assemble the input for `wiki/troubleshooting.md` synthesis: the most
 * recent error/failure events from `events.jsonl` plus the latest atlas
 * drift report (if present). Gives the LLM symptom signals the page can
 * organize into symptom → cause → fix triplets.
 */
export function assembleTroubleshootingInputs(wikiRoot) {
    const sources = [];
    const parts = [];
    const notes = [];
    // Recent error events from events.jsonl
    const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
    if (fs.existsSync(eventsPath)) {
        let raw;
        try {
            raw = fs.readFileSync(eventsPath, "utf-8");
        }
        catch {
            raw = "";
        }
        const errors = [];
        // ⚡ Bolt: Iterate backwards using lastIndexOf and substring to avoid
        // massive synchronous array allocation from .split('\n') on large log files
        let pos = raw.length;
        while (pos > 0 && errors.length < _TROUBLESHOOTING_EVENT_LIMIT) {
            const prevPos = raw.lastIndexOf("\n", pos - 1);
            const line = raw.substring(prevPos + 1, pos);
            pos = prevPos;
            if (!line)
                continue;
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                continue;
            const rec = parsed;
            if (_isErrorEvent(rec)) {
                errors.push({ raw: line, parsed: rec });
            }
        }
        if (errors.length > 0) {
            sources.push("log/events.jsonl");
            parts.push("## Recent error/failure events\n");
            parts.push("```jsonl");
            // Reverse so oldest-first within the recent window
            for (const e of [...errors].reverse())
                parts.push(e.raw);
            parts.push("```\n");
        }
        else {
            notes.push("no error events in events.jsonl — troubleshooting will be sparse");
        }
    }
    else {
        notes.push("no log/events.jsonl found");
    }
    // Latest atlas drift report
    const atlasOutputs = path.join(wikiRoot, "outputs", "atlas");
    if (fs.existsSync(atlasOutputs)) {
        let runs;
        try {
            runs = fs
                .readdirSync(atlasOutputs, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => e.name)
                .sort()
                .reverse();
        }
        catch {
            runs = [];
        }
        for (const run of runs) {
            const driftPath = path.join(atlasOutputs, run, "drift-report.md");
            if (!fs.existsSync(driftPath))
                continue;
            try {
                const body = fs.readFileSync(driftPath, "utf-8");
                const rel = path.posix.join("outputs", "atlas", run, "drift-report.md");
                sources.push(rel);
                parts.push(`## Drift report (${run})\n\n${body.trim()}\n`);
                break; // only the most recent
            }
            catch {
                notes.push(`could not read ${driftPath}`);
            }
        }
    }
    return { sources, text: parts.join("\n"), notes };
}
/** Directory names that gate a topic-bearing path component. The
 *  directory IMMEDIATELY following one of these is treated as the
 *  topic candidate. Curated to match the layouts atlas already
 *  recognises in topic discovery (Phase 2). */
const _TOPIC_DIR_PREFIXES = new Set([
    "src",
    "app",
    "apps",
    "services",
    "lib",
    "internal",
    "pkg",
    "packages",
    "modules",
    "cmd",
]);
/**
 * Canonicalize a topic candidate to match the topic-discovery convention
 * (SKILL.md Phase 2): lowercase-kebab-case, strip `-service`, `-svc`,
 * `-module` suffixes.
 */
function _canonicalizeTopic(raw) {
    let s = raw.toLowerCase().replace(/[_\s]+/g, "-");
    s = s.replace(/-(service|svc|module)$/i, "");
    return s;
}
/**
 * Extract a topic candidate from a repo-relative source-file path.
 * Looks for `<prefix>/<topic>/...` where `<prefix>` is one of the
 * known topic-bearing directories. Returns the canonicalized topic,
 * or `null` if no recognized topic directory is found or the candidate
 * is the path's leaf (i.e. a file, not a sub-directory).
 */
export function extractTopicFromPath(sourceFile) {
    const parts = sourceFile.split("/").filter((p) => p.length > 0);
    // Need at least <prefix>/<topic>/<more> — if `<topic>` is the leaf,
    // it's likely a file (e.g. `src/utils.ts`), not a topic directory.
    for (let i = 0; i < parts.length - 2; i++) {
        if (_TOPIC_DIR_PREFIXES.has(parts[i] ?? "")) {
            const candidate = parts[i + 1] ?? "";
            if (candidate.length > 0)
                return _canonicalizeTopic(candidate);
        }
    }
    return null;
}
/**
 * Build a topic → facet → source-files map for the two manifest-backed
 * facets — `data-model` (from `inventory.orm_entities`) and `api` (from
 * `inventory.rest_endpoints`). Topic assignment is path-based via
 * {@link extractTopicFromPath}; entries whose extracted topic does not
 * canonicalize to a member of `topics` are dropped.
 *
 * Other facets (`architecture`, `environments`, `operations`) are NOT
 * manifest-backed — the orchestrator continues to use SKILL.md
 * heuristics for them, merging the two source lists.
 */
export function groupManifestByTopicFacet(inventory, topics) {
    const wantedTopics = new Set(topics.map((t) => _canonicalizeTopic(t)));
    const out = {};
    const ensure = (topic) => {
        const existing = out[topic];
        if (existing)
            return existing;
        const fresh = { "data-model": [], api: [] };
        out[topic] = fresh;
        return fresh;
    };
    for (const entity of inventory.orm_entities) {
        const topic = extractTopicFromPath(entity.source_file);
        if (!topic || !wantedTopics.has(topic))
            continue;
        const bucket = ensure(topic);
        if (!bucket["data-model"].includes(entity.source_file)) {
            bucket["data-model"].push(entity.source_file);
        }
    }
    for (const endpoint of inventory.rest_endpoints) {
        const topic = extractTopicFromPath(endpoint.file);
        if (!topic || !wantedTopics.has(topic))
            continue;
        const bucket = ensure(topic);
        if (!bucket["api"].includes(endpoint.file)) {
            bucket["api"].push(endpoint.file);
        }
    }
    return out;
}
// ── CLI ────────────────────────────────────────────────────────────
const FLAG_SPEC = {
    "--wiki-root": "wikiRoot",
    "--repo-root": "repoRoot",
    "--connectors-config": "connectorsConfig",
};
const HELP_TEXT = `usage: atlas_synthesize.js {overview,integrations,deploy,commands,configuration,getting-started,troubleshooting} [...]

Read-only input assembly for /doc-wiki:atlas global synthesis.

Subcommands:
  overview          --wiki-root <p>
                    Audience-routing table + concatenated architecture pages +
                    per-facet TL;DRs.
  integrations      --wiki-root <p> [--connectors-config <p>]
                    api.md pages + external-service mentions + connector config.
  deploy            --wiki-root <p> [--repo-root <p>]
                    Build/deploy files: Dockerfile, compose, workflows, terraform.
  commands          --repo-root <p>
                    commands/*.md wrappers + ### / headings from SKILL.md files.
  configuration     --repo-root <p>
                    Top-level config files + config/ + .connectors/ dirs.
  getting-started   --repo-root <p>
                    README + package.json scripts + bootstrap files.
  troubleshooting   --wiki-root <p>
                    Recent error events + latest atlas drift report.

Each prints one JSON object on stdout with keys: sources, text, notes.
`;
export function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    const sub = argv[0];
    let parsed;
    try {
        parsed = parseFlags(argv.slice(1), FLAG_SPEC);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (parsed.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    const repoRoot = typeof parsed.values["repoRoot"] === "string" &&
        parsed.values["repoRoot"].length > 0
        ? parsed.values["repoRoot"]
        : process.cwd();
    // Subcommands that need --wiki-root.
    if (sub === "overview" ||
        sub === "integrations" ||
        sub === "troubleshooting") {
        if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
            process.stderr.write("--wiki-root is required\n");
            return 2;
        }
        let bundle;
        if (sub === "overview") {
            bundle = assembleOverviewInputs(wikiRoot);
        }
        else if (sub === "integrations") {
            const cfg = typeof parsed.values["connectorsConfig"] === "string"
                ? parsed.values["connectorsConfig"]
                : undefined;
            bundle = assembleIntegrationsInputs(wikiRoot, cfg);
        }
        else {
            bundle = assembleTroubleshootingInputs(wikiRoot);
        }
        process.stdout.write(JSON.stringify(bundle) + "\n");
        return 0;
    }
    // Subcommands that work off repoRoot (cwd by default).
    if (sub === "deploy") {
        const bundle = assembleDeployInputs(repoRoot);
        process.stdout.write(JSON.stringify(bundle) + "\n");
        return 0;
    }
    if (sub === "commands") {
        const bundle = assembleCommandsInputs(repoRoot);
        process.stdout.write(JSON.stringify(bundle) + "\n");
        return 0;
    }
    if (sub === "getting-started") {
        const bundle = assembleGettingStartedInputs(repoRoot);
        process.stdout.write(JSON.stringify(bundle) + "\n");
        return 0;
    }
    if (sub === "configuration") {
        const bundle = assembleConfigurationInputs(repoRoot);
        process.stdout.write(JSON.stringify(bundle) + "\n");
        return 0;
    }
    process.stderr.write(`unknown subcommand: ${sub}\n`);
    return 2;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
