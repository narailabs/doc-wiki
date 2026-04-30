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
// ── Overview bundle ────────────────────────────────────────────────
/**
 * Assemble the input for `wiki/overview.md` synthesis: every per-topic
 * `architecture.md` body in full, plus the TL;DR sections of the other per-
 * topic facets. The intent is to give the LLM the full architecture story
 * for each topic plus a one-paragraph snapshot of every other facet (data
 * model, environments, api, operations) so the synthesized narrative can
 * cross-reference without needing every page in full.
 */
export function assembleOverviewInputs(wikiRoot) {
    const arch = _findAtlasPages(wikiRoot, ["architecture"]);
    const others = _findAtlasPages(wikiRoot, [
        "data-model",
        "environments",
        "api",
        "operations",
    ]);
    const sources = [];
    const parts = [];
    const notes = [];
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
    const integrationKeywords = [
        "jira", "github", "confluence", "notion", "aws", "gcp",
        "stripe", "datadog", "sentry", "auth0", "okta", "twilio", "sendgrid",
    ];
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
 * Walk the repo root looking for canonical build/deploy files. Returns the
 * relative paths (sorted) plus a concatenated text bundle the orchestrator
 * passes to `/doc-wiki:ingest --output wiki/deploy.md`.
 *
 * Big files (>200 KB) are truncated with a marker line — full inclusion
 * would blow the synthesis context budget for little additional value.
 */
export function assembleDeployInputs(repoRoot) {
    const sources = [];
    const parts = [];
    const notes = [];
    // Top-level files.
    let topLevel;
    try {
        topLevel = fs.readdirSync(repoRoot, { withFileTypes: true });
    }
    catch {
        notes.push(`could not read repo root: ${repoRoot}`);
        return { sources, text: "", notes };
    }
    for (const e of topLevel) {
        if (!e.isFile())
            continue;
        if (DEPLOY_FILE_GLOBS.some((rx) => rx.test(e.name))) {
            sources.push(e.name);
        }
    }
    // Directory patterns.
    for (const { dir, rx } of DEPLOY_DIR_PATTERNS) {
        const abs = path.join(repoRoot, dir);
        if (!fs.existsSync(abs))
            continue;
        const walk = (d, relBase) => {
            let entries;
            try {
                entries = fs.readdirSync(d, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of entries) {
                const full = path.join(d, e.name);
                const rel = path.posix.join(relBase, e.name);
                if (e.isDirectory())
                    walk(full, rel);
                else if (e.isFile() && rx.test(e.name))
                    sources.push(rel);
            }
        };
        walk(abs, dir);
    }
    sources.sort();
    if (sources.length === 0) {
        notes.push("no build/deploy files matched — wiki/deploy.md will be sparse");
        return { sources, text: "", notes };
    }
    for (const rel of sources) {
        const abs = path.join(repoRoot, rel);
        let body;
        try {
            body = fs.readFileSync(abs, "utf-8");
        }
        catch {
            notes.push(`could not read ${rel}`);
            continue;
        }
        const truncated = body.length > 200 * 1024 ? body.slice(0, 200 * 1024) + "\n... [truncated]\n" : body;
        parts.push(`## ${rel}\n\n\`\`\`\n${truncated}\n\`\`\`\n`);
    }
    return { sources, text: parts.join("\n"), notes };
}
// ── CLI ────────────────────────────────────────────────────────────
const FLAG_SPEC = {
    "--wiki-root": "wikiRoot",
    "--repo-root": "repoRoot",
    "--connectors-config": "connectorsConfig",
};
const HELP_TEXT = `usage: atlas_synthesize.js {overview,integrations,deploy} [...]

Read-only input assembly for /doc-wiki:atlas global synthesis.

Subcommands:
  overview       --wiki-root <p>
                 Concatenated architecture pages + per-facet TL;DRs.
  integrations   --wiki-root <p> [--connectors-config <p>]
                 api.md pages + external-service mentions + connector config.
  deploy         --wiki-root <p> [--repo-root <p>]
                 Build/deploy files: Dockerfile, compose, workflows, terraform.

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
    if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
        process.stderr.write("--wiki-root is required\n");
        return 2;
    }
    if (sub === "overview") {
        const bundle = assembleOverviewInputs(wikiRoot);
        process.stdout.write(JSON.stringify(bundle) + "\n");
        return 0;
    }
    if (sub === "integrations") {
        const cfg = typeof parsed.values["connectorsConfig"] === "string"
            ? parsed.values["connectorsConfig"]
            : undefined;
        const bundle = assembleIntegrationsInputs(wikiRoot, cfg);
        process.stdout.write(JSON.stringify(bundle) + "\n");
        return 0;
    }
    if (sub === "deploy") {
        const repoRoot = typeof parsed.values["repoRoot"] === "string" && parsed.values["repoRoot"].length > 0
            ? parsed.values["repoRoot"]
            : process.cwd();
        const bundle = assembleDeployInputs(repoRoot);
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
