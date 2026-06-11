#!/usr/bin/env node
/**
 * Generate and regenerate CLAUDE.md files with marked-section preservation.
 *
 * Content between ``<!-- wiki-managed: start -->`` and ``<!-- wiki-managed: end -->``
 * is regenerated on re-invocation. All content outside markers is preserved.
 *
 * `--wiki-root` / the `wikiRoot` arg accepts EITHER layout: the scaffold root
 * (the dir that contains a `wiki/` folder — how `/doc-wiki:atlas` invokes us)
 * or the content dir itself (`<root>/wiki`, the layout the CLI examples use).
 * `resolveScaffoldRoot` normalizes both to the scaffold root internally.
 *
 * Library usage:
 *     import { generateClaudeMd, generateManagedBlock, updateClaudeMd } from "./claude_md_gen.js";
 *     const md = generateClaudeMd("/path/to/project", "/path/to/wiki");
 *     const block = generateManagedBlock("/path/to/project", "/path/to/wiki");
 *     const result = updateClaudeMd("CLAUDE.md", newManagedContent);
 *
 * CLI usage:
 *     node claude_md_gen.js --project-root /path --wiki-root /path/wiki
 *     node claude_md_gen.js --project-root /path --wiki-root /path/wiki --update CLAUDE.md
 *     node claude_md_gen.js --project-root /path --wiki-root /path/wiki --block
 *     node claude_md_gen.js --project-root /path --wiki-root /path/wiki --block --update AGENTS.md
 *
 * `--block` prints ONLY the managed-block body (behavioral directive +
 * intent→page routing table + wiki index link + AI-tool config registry
 * pointer when `<wiki-root>/ai-dev/` exists; links relative to the project
 * root) to stdout, with no markers and no file writes — atlas Phase 8 splices
 * it between the `<!-- wiki-managed: reference start/end -->` markers of every
 * AI-tool root file (CLAUDE.md, AGENTS.md, GEMINI.md, …). `--block --update
 * FILE` performs that splice directly, with a guard: files already carrying
 * the body pair (`<!-- wiki-managed: start -->`) are skipped unchanged — they
 * already contain the imperative core, so splicing the reference block too
 * would duplicate it.
 *
 * This is a TypeScript port of claude_md_gen.py; behaviour matches the
 * Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// ── Wiki page scanning ──────────────────────────────────────────────
/**
 * Normalize a caller-supplied `wikiRoot` to the canonical SCAFFOLD root —
 * the directory that *contains* the `wiki/` content folder (so pages live at
 * `<scaffoldRoot>/wiki/` and the index at `<scaffoldRoot>/wiki/index.md`).
 *
 * Two layouts are accepted so both the atlas caller and the documented CLI
 * invocation produce correct output:
 *
 *   - `<scaffoldRoot>` already containing a `wiki/` subdir → scaffold root,
 *     used as-is. This is how `/doc-wiki:atlas` Phase 8 (and every other
 *     `--wiki-root <root>` consumer in the pipeline) invokes us.
 *   - `<…>/wiki` — the caller pointed at the CONTENT dir that directly holds
 *     `index.md`. This is what the script's `--help` examples and the CLI
 *     tests pass. We climb one level to `dirname(wikiRoot)` so the content
 *     dir is treated as `<scaffoldRoot>/wiki/`.
 *   - Otherwise (e.g. an empty/fresh path with neither marker) → use as-is.
 *
 * The first check takes precedence: if `<wikiRoot>/wiki` exists we trust it
 * even when `basename(wikiRoot) === "wiki"` (a genuine `…/wiki/wiki/` scaffold).
 */
export function resolveScaffoldRoot(wikiRoot) {
    let isScaffold = false;
    try {
        isScaffold = fs.statSync(path.join(wikiRoot, "wiki")).isDirectory();
    }
    catch {
        isScaffold = false;
    }
    if (isScaffold)
        return wikiRoot;
    if (path.basename(wikiRoot) === "wiki")
        return path.dirname(wikiRoot);
    return wikiRoot;
}
/**
 * Parse a minimal YAML frontmatter block from `content`.
 * Returns a plain object or null when the block is absent or malformed.
 * This is an intentionally lightweight parser — we only read string-valued
 * top-level keys. It does NOT require the `js-yaml` package so that this
 * script stays self-contained.
 */
function parseMinimalFrontmatter(content) {
    if (!content.startsWith("---\n"))
        return null;
    const end = content.indexOf("\n---\n", 4);
    if (end === -1)
        return null;
    const fmStr = content.slice(4, end);
    const result = {};
    for (const line of fmStr.split("\n")) {
        const colon = line.indexOf(":");
        if (colon < 1)
            continue;
        const key = line.slice(0, colon).trim();
        const raw = line.slice(colon + 1).trim();
        // Only accept bare scalar strings (no block literals, lists, etc.)
        if (raw.startsWith("|") || raw.startsWith(">") || raw.startsWith("[") || raw.startsWith("{"))
            continue;
        if (key && raw) {
            result[key] = raw.replace(/^['"]|['"]$/g, "");
        }
    }
    return Object.keys(result).length > 0 ? result : null;
}
/**
 * Walk `<scaffoldRoot>/wiki/` for `.md` files (excluding `_archive` and other
 * `_*` reserved dirs), read each file's frontmatter, and return page info
 * records. `relPath` is expressed relative to the scaffold root (e.g.
 * `"wiki/auth/architecture.md"`). Silently skips unreadable files.
 *
 * `wikiRoot` is normalized via `resolveScaffoldRoot` so both the scaffold-root
 * layout (`<root>` containing `wiki/`) and the content-dir layout (`<root>/wiki`)
 * resolve to the same pages.
 */
export function listWikiPagesForRouting(wikiRoot) {
    const scaffoldRoot = resolveScaffoldRoot(wikiRoot);
    const wikiDir = path.join(scaffoldRoot, "wiki");
    if (!fs.existsSync(wikiDir))
        return [];
    const pages = [];
    const stack = [wikiDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Exclude _archive and other _* reserved dirs
                if (!entry.name.startsWith("_"))
                    stack.push(full);
            }
            else if (entry.isFile() && entry.name.endsWith(".md")) {
                let content = "";
                try {
                    content = fs.readFileSync(full, { encoding: "utf-8" });
                }
                catch {
                    continue;
                }
                const fm = parseMinimalFrontmatter(content);
                const relPath = path.relative(scaffoldRoot, full).split(path.sep).join("/");
                pages.push({
                    relPath,
                    facet: fm?.["atlas_facet"] ?? null,
                    title: fm?.["title"] ?? null,
                    crossServicePage: fm?.["cross_service_page"] ?? null,
                });
            }
        }
    }
    pages.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
    return pages;
}
/**
 * Well-known facet → intent mapping. These strings are intentionally generic;
 * they read well for any codebase.
 *
 * The map is split into two groups for routing purposes:
 *
 *   - PER_TOPIC facets recur once per topic in an atlas run (e.g. both
 *     `auth/architecture.md` and `billing/architecture.md` exist). Each page
 *     gets its OWN routing row, with the topic woven into the intent so the
 *     agent can route to the right one. The intent here is a template that
 *     `{topic}` is substituted into.
 *   - GLOBAL facets are single-instance per wiki (e.g. one `overview.md`).
 *     They collapse to one row; if duplicates somehow exist, the
 *     lexicographically-first page wins.
 *
 * The order of keys across both maps (PER_TOPIC first, then GLOBAL) defines
 * the logical sort order of the rendered table.
 */
const PER_TOPIC_FACET_INTENTS = {
    architecture: "understand the {topic} subsystem architecture",
    api: "trace or modify a {topic} API endpoint",
    "data-model": "understand the {topic} data model or schema",
    operations: "operate, deploy, or monitor {topic}",
    environments: "understand {topic} runtime environments",
};
const GLOBAL_FACET_INTENTS = {
    overview: "understand how the system fits together",
    configuration: "change configuration or environment variables",
    integrations: "wire in or debug an external service",
    deploy: "understand the deployment pipeline",
    "getting-started": "get set up for the first time",
    commands: "look up available commands or options",
    troubleshooting: "diagnose a failure or unexpected behaviour",
};
/**
 * Cross-service page slug → intent. The six pages written by
 * `agents/lib/cross_service_pages.ts` all carry `atlas_facet: architecture`
 * but are distinguished by their `cross_service_page` slug. The router branches
 * on the slug FIRST so each gets a distinct, slug-specific intent — never the
 * generic per-topic architecture row. (Cross-service is the product's biggest
 * differentiator; these rows must surface.)
 *
 * Key insertion order defines the rendered order of the cross-service group.
 */
const CROSS_SERVICE_INTENTS = {
    "service-map": "Understand the overall service topology — how services connect",
    "service-dependencies": "See which services depend on which",
    "client-registry": "Find where one service calls another (HTTP/RPC client callsites)",
    "queue-registry": "Trace async/queue producers and consumers",
    "database-traces": "See which services read/write which database tables",
    "shared-libraries": "Find shared libraries used across services",
};
/** Slug order for the cross-service group (matches the writer's page order). */
const CROSS_SERVICE_ORDER = Object.keys(CROSS_SERVICE_INTENTS);
/**
 * Resolve the intent for a cross-service page. Known slugs use the curated
 * mapping; an unknown slug falls back to a sensible generic phrasing that
 * still names the slug, so a future cross-service page type never crashes the
 * router or collapses into a generic architecture row.
 */
function crossServiceIntent(slug) {
    const known = CROSS_SERVICE_INTENTS[slug];
    if (known)
        return known;
    // Humanize the slug (kebab → spaced) for the fallback.
    const human = slug.replace(/[-_]+/g, " ").trim();
    return `See the cross-service ${human} view`;
}
/**
 * Combined facet order: per-topic facets first, then global facets. Cross-service
 * rows are ordered separately (by CROSS_SERVICE_ORDER) and rendered after these.
 */
const FACET_ORDER = [
    ...Object.keys(PER_TOPIC_FACET_INTENTS),
    ...Object.keys(GLOBAL_FACET_INTENTS),
];
/**
 * Derive a human-readable topic label for a per-topic page from its relPath.
 *
 * `wiki/auth/architecture.md` → "auth". A top-level page such as
 * `wiki/architecture.md` has no topic directory; fall back to the page's
 * `title` (if any), else a generic "subsystem"/"the system" phrasing handled
 * by the caller via a null return.
 */
function deriveTopic(page) {
    // relPath looks like "wiki/<maybe-topic>/<file>.md" or "wiki/<file>.md".
    const parts = page.relPath.split("/");
    // Drop the leading "wiki" segment and the trailing filename.
    const dirSegments = parts.slice(1, -1);
    if (dirSegments.length > 0) {
        // Use the deepest directory as the topic (e.g. wiki/services/auth/api.md → "auth").
        return dirSegments[dirSegments.length - 1] ?? null;
    }
    return null;
}
/**
 * Build a routing table from wiki pages that have a recognized `atlas_facet`.
 * Pages without a known facet are omitted — the table only lists rows the
 * agent can act on.
 *
 * Per-topic facets (architecture, api, data-model, operations, environments)
 * emit ONE ROW PER PAGE, disambiguated by the page's topic, so the agent can
 * route to (say) the auth vs billing architecture page. Global single-instance
 * facets (overview, configuration, troubleshooting, …) collapse to one row.
 *
 * `wikiRelDir` is the path from the project root (or submodule dir) to the
 * wiki folder (e.g. `"docs/my-app-wiki"` or `"wiki"`), used to prefix page
 * paths so links resolve from wherever the generated file lives.
 */
export function buildRoutingTable(pages, wikiRelDir) {
    const prefix = (relPath) => wikiRelDir ? `${wikiRelDir}/${relPath}` : relPath;
    const tagged = [];
    // Maps a global facet to its currently-winning row, so duplicate global
    // pages collapse to the lexicographically-smallest page deterministically
    // (independent of input iteration order).
    const globalSeen = new Map();
    // De-dupe cross-service pages by slug (one row per slug, smallest path wins).
    const crossSeen = new Map();
    for (const page of pages) {
        // Branch on cross_service_page FIRST: these pages carry
        // `atlas_facet: architecture` but must NOT route as per-topic architecture
        // rows. Each gets its own slug-specific intent.
        if (page.crossServicePage) {
            const slug = page.crossServicePage;
            const existing = crossSeen.get(slug);
            if (existing) {
                if (page.relPath < existing.sortKey) {
                    existing.pagePath = prefix(page.relPath);
                    existing.sortKey = page.relPath;
                }
                continue;
            }
            const orderIdx = CROSS_SERVICE_ORDER.indexOf(slug);
            const row = {
                intent: crossServiceIntent(slug),
                pagePath: prefix(page.relPath),
                // Unknown slugs sort after known ones, then alphabetically by slug.
                group: 1,
                orderKey: orderIdx === -1 ? CROSS_SERVICE_ORDER.length : orderIdx,
                sortKey: orderIdx === -1 ? `~${slug}` : page.relPath,
            };
            crossSeen.set(slug, row);
            tagged.push(row);
            continue;
        }
        if (!page.facet)
            continue;
        const perTopicTemplate = PER_TOPIC_FACET_INTENTS[page.facet];
        if (perTopicTemplate) {
            const topic = deriveTopic(page);
            const intent = topic
                ? perTopicTemplate.replace("{topic}", topic)
                : // No topic dir: strip the "{topic} " placeholder for a clean generic phrasing.
                    perTopicTemplate.replace("{topic} ", "");
            tagged.push({
                intent,
                pagePath: prefix(page.relPath),
                group: 0,
                orderKey: FACET_ORDER.indexOf(page.facet),
                sortKey: page.relPath,
            });
            continue;
        }
        const globalIntent = GLOBAL_FACET_INTENTS[page.facet];
        if (globalIntent) {
            const existing = globalSeen.get(page.facet);
            if (existing) {
                // Keep the lexicographically-smallest page so the choice is
                // deterministic regardless of input iteration order.
                if (page.relPath < existing.sortKey) {
                    existing.pagePath = prefix(page.relPath);
                    existing.sortKey = page.relPath;
                }
                continue;
            }
            const row = {
                intent: globalIntent,
                pagePath: prefix(page.relPath),
                group: 0,
                orderKey: FACET_ORDER.indexOf(page.facet),
                sortKey: page.relPath,
            };
            globalSeen.set(page.facet, row);
            tagged.push(row);
        }
        // Unknown facets are ignored.
    }
    // Sort by group (facets before cross-service), then the within-group order
    // key (facet order / cross-service slug order), then page path for stable
    // per-topic grouping.
    tagged.sort((a, b) => {
        if (a.group !== b.group)
            return a.group - b.group;
        const oa = a.orderKey === -1 ? 999 : a.orderKey;
        const ob = b.orderKey === -1 ? 999 : b.orderKey;
        if (oa !== ob)
            return oa - ob;
        return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    });
    return tagged.map(({ intent, pagePath }) => ({ intent, pagePath }));
}
// ── Constants ───────────────────────────────────────────────────────
export const MARKER_START = "<!-- wiki-managed: start -->";
export const MARKER_END = "<!-- wiki-managed: end -->";
/** Root-file reference pair — the block atlas Phase 8 fills via `--block`. */
export const REFERENCE_MARKER_START = "<!-- wiki-managed: reference start -->";
export const REFERENCE_MARKER_END = "<!-- wiki-managed: reference end -->";
/**
 * G-CLAUDE-MD-MARKER: raised by `updateClaudeMd` when the target file's
 * wiki-managed markers are unbalanced — e.g. a `start` without an `end`,
 * or two `start`s. The AGENT.md contract lists this as error_code
 * MARKER_CORRUPT; the CLI catches it and writes a structured JSON
 * payload to stdout.
 */
export class MarkerCorruptError extends Error {
    error_code = "MARKER_CORRUPT";
    starts;
    ends;
    constructor(starts, ends) {
        super(`Corrupted wiki-managed markers: ${starts} start marker(s) and ` +
            `${ends} end marker(s) (expected exactly 1 of each). Reset markers ` +
            "manually or delete the file and re-run without --update.");
        this.name = "MarkerCorruptError";
        this.starts = starts;
        this.ends = ends;
    }
}
function countOccurrences(haystack, needle) {
    if (needle.length === 0)
        return 0;
    let count = 0;
    let i = 0;
    while (true) {
        const hit = haystack.indexOf(needle, i);
        if (hit < 0)
            break;
        count++;
        i = hit + needle.length;
    }
    return count;
}
/** Regex to find and replace the managed section. Matches Python's
 *  `re.compile(re.escape(MARKER_START) + r"\n(.*?)" + re.escape(MARKER_END), re.DOTALL)`.
 *
 *  The markers contain regex-special `!`, `-`, `<`, `>`, `:`, and whitespace;
 *  we pre-escape them with a helper equivalent to Python's `re.escape`. */
function escapeRegex(s) {
    return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}
const _MANAGED_RE = new RegExp(escapeRegex(MARKER_START) + "\\n([\\s\\S]*?)" + escapeRegex(MARKER_END));
const _REFERENCE_RE = new RegExp(escapeRegex(REFERENCE_MARKER_START) +
    "\\n([\\s\\S]*?)" +
    escapeRegex(REFERENCE_MARKER_END));
// ── Library API ────────────────────────────────────────────────────
/**
 * Compute a relative path from `from` to `to`, matching Python's
 * `os.path.relpath(to, from)` semantics.
 *
 * Node's `path.relative` already mirrors Python's `os.path.relpath`,
 * so we defer to it. Python may raise ValueError on Windows when paths
 * are on different drives; Node returns an absolute fallback that we
 * surface directly (the caller's try/except block in Python handled
 * that edge case and we preserve parity by never throwing here).
 */
function safeRelpath(to, from) {
    try {
        return path.relative(from, to);
    }
    catch {
        return to;
    }
}
/**
 * Build the IMPERATIVE CORE shared by `generateClaudeMd` (full-file body
 * between `wiki-managed: start/end`) and `generateManagedBlock` (root-file
 * block between `wiki-managed: reference start/end`): the behavioral
 * directive, the intent→page routing table (or its no-routing-rows fallback
 * pointer), and the documentation-index link.
 *
 * `linkBaseDir` is the directory the emitted links must resolve from — the
 * project root for root files, the submodule directory for a submodule
 * CLAUDE.md. Returns the lines (with a trailing "" so a join ends in \n).
 */
function buildImperativeCoreLines(wikiRoot, linkBaseDir) {
    const lines = [];
    // ── Behavioral directive ────────────────────────────────────────────
    lines.push("## Wiki");
    lines.push("");
    lines.push("Before changing code in this repository, consult the wiki for the relevant " +
        "subsystem. Treat the wiki as the source of truth for architecture, data flow, " +
        "and conventions; verify your assumptions against it before implementing. If " +
        "the wiki does not cover something, say so rather than guessing.");
    lines.push("");
    // ── Intent → resource routing table ────────────────────────────────
    // Normalize wikiRoot to the scaffold root (the dir containing `wiki/`), so
    // both the atlas `--wiki-root <root>` layout and the documented content-dir
    // `--wiki-root <root>/wiki` layout produce correct page paths and links.
    const scaffoldRoot = resolveScaffoldRoot(wikiRoot);
    // `wikiRel` points at the scaffold root; `<wikiRel>/wiki/...` is a content path.
    const wikiRel = safeRelpath(scaffoldRoot, linkBaseDir);
    const pages = listWikiPagesForRouting(scaffoldRoot);
    const routingRows = buildRoutingTable(pages, wikiRel);
    const wikiDirRel = wikiRel ? `${wikiRel}/wiki` : "wiki";
    if (routingRows.length > 0) {
        lines.push("| If you need to… | Read |");
        lines.push("|---|---|");
        for (const row of routingRows) {
            const filename = path.basename(row.pagePath);
            lines.push(`| ${row.intent} | [${filename}](${row.pagePath}) |`);
        }
        lines.push("");
    }
    else {
        // No faceted pages yet (fresh or pre-atlas wiki). The behavioral directive
        // above still applies, so the body must NOT collapse to a bare directive —
        // give the agent a concrete pointer to where docs live and grow.
        lines.push(`No topic routing table yet — the wiki has not been built out with atlas ` +
            `pages. Browse [${wikiDirRel}/](${wikiDirRel}/) for whatever pages exist, ` +
            `and run \`/doc-wiki:atlas\` to generate full coverage.`);
        lines.push("");
    }
    // ── Documentation index ─────────────────────────────────────────────
    // The index lives under <scaffoldRoot>/wiki/ (same dir the page scanner
    // walks). Only link it if it actually exists — never emit a phantom link.
    const wikiIndexPath = `${wikiDirRel}/index.md`;
    if (fs.existsSync(path.join(scaffoldRoot, "wiki", "index.md"))) {
        lines.push(`[Full wiki index](${wikiIndexPath})`);
        lines.push("");
    }
    // ── AI-tool configuration registry pointer ──────────────────────────
    // Per-tool config files (<tool>-config.md) live at <scaffoldRoot>/ai-dev/ —
    // OUTSIDE wiki/, so the routing table and index cannot surface them. One
    // compact pointer line keeps them discoverable from the root files. Only
    // emitted when the directory exists — never a phantom link.
    let aiDevExists = false;
    try {
        aiDevExists = fs.statSync(path.join(scaffoldRoot, "ai-dev")).isDirectory();
    }
    catch {
        aiDevExists = false;
    }
    if (aiDevExists) {
        const aiDevDirRel = wikiRel ? `${wikiRel}/ai-dev` : "ai-dev";
        lines.push(`AI-tool configuration registry: [${aiDevDirRel}/](${aiDevDirRel}/)`);
        lines.push("");
    }
    return lines;
}
/**
 * Generate the managed-block BODY for AI-tool root files (CLAUDE.md,
 * AGENTS.md, GEMINI.md, …) — the content atlas Phase 8 splices between
 * `<!-- wiki-managed: reference start -->` / `<!-- wiki-managed: reference end -->`.
 *
 * Returns ONLY the body: behavioral directive + intent→page routing table
 * (or its no-routing-rows fallback pointer) + documentation-index link. No
 * markers, no file header. Exactly the imperative core `generateClaudeMd`
 * emits — both share `buildImperativeCoreLines`, so the two paths can never
 * drift.
 *
 * Links are relative to `projectRoot` (root files live there). `wikiRoot`
 * accepts both layouts via `resolveScaffoldRoot` — e.g. a nested
 * `<projectRoot>/docs/saleor-wiki` scaffold yields links like
 * `docs/saleor-wiki/wiki/<topic>/<facet>.md`, while a sibling `wiki/` at the
 * project root yields `wiki/<topic>/<facet>.md`.
 */
export function generateManagedBlock(projectRoot, wikiRoot) {
    return buildImperativeCoreLines(wikiRoot, projectRoot).join("\n");
}
/**
 * Generate CLAUDE.md content with wiki-managed markers.
 *
 * `projectRoot` is the top-level project directory. `wikiRoot` is the
 * path to the wiki directory. `submodule` (optional) is a relative path
 * to a submodule; when set the generated content includes a link back
 * to the root CLAUDE.md.
 *
 * The generated block ALWAYS leads with a behavioral directive that tells
 * coding agents to consult the wiki before making changes, followed by an
 * intent→resource routing table derived from the actual pages in the wiki.
 * Only pages with a recognized `atlas_facet` appear in the table, so the
 * table degrades gracefully when few pages exist. When there are no faceted
 * pages at all, the table is replaced by a short pointer line so the body
 * never collapses to a bare directive.
 *
 * Returns the full managed section (between markers) as a markdown string.
 */
export function generateClaudeMd(projectRoot, wikiRoot, submodule = null) {
    // Links must resolve from wherever THIS file lives. For a submodule
    // CLAUDE.md (e.g. services/auth/CLAUDE.md) the relative base is the
    // submodule directory, not the project root — otherwise the links point
    // under the submodule and break. Stay consistent with the back-link block
    // below, which also offsets by the submodule depth.
    const linkBaseDir = submodule
        ? path.join(projectRoot, submodule)
        : projectRoot;
    // ── Behavioral directive + routing table + index link ──────────────
    // Shared with generateManagedBlock (the Phase 8 root-file block).
    const lines = buildImperativeCoreLines(wikiRoot, linkBaseDir);
    // ── Submodule back-link ─────────────────────────────────────────────
    // Emitted under a "Parent Project" heading: a navigational section boundary
    // around the backlink (required by the eval contract in evals/evals.json,
    // eval 1 expectation 3 — "under a Parent Project heading").
    if (submodule) {
        const subDepth = submodule.split(path.sep).filter((s) => s.length > 0).length;
        const rootRel = new Array(subDepth).fill("..").join("/");
        lines.push("## Parent Project");
        lines.push("");
        lines.push(`[Root CLAUDE.md](${rootRel}/CLAUDE.md)`);
        lines.push("");
    }
    // ── Submodules listing (root only) ──────────────────────────────────
    if (!submodule) {
        const submodules = listSubmodules(projectRoot);
        if (submodules.length > 0) {
            lines.push("## Submodules");
            lines.push("");
            for (const sub of [...submodules].sort()) {
                lines.push(`- [${sub}](${sub}/CLAUDE.md)`);
            }
            lines.push("");
        }
    }
    const innerContent = lines.join("\n");
    return `${MARKER_START}\n${innerContent}${MARKER_END}\n`;
}
/**
 * Replace content between markers, preserving the rest.
 *
 * If the file does not exist or has no markers, wraps `newManagedContent`
 * with markers and returns the result.
 *
 * Returns the full file content as a string.
 */
export function updateClaudeMd(filePath, newManagedContent) {
    let content = "";
    if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, { encoding: "utf-8" });
    }
    const replacement = `${MARKER_START}\n${newManagedContent}${MARKER_END}`;
    // G-CLAUDE-MD-MARKER: validate balanced markers BEFORE any file I/O. The
    // MARKER_CORRUPT error code is documented in AGENT.md but was never
    // raised. Accept exactly one of each (the normal managed case) or zero
    // of each (fresh file, markers will be appended). Any other combination
    // — a lone start, a lone end, or multiple starts/ends from a hand-edit
    // gone wrong — is ambiguous, so we refuse to mutate.
    const starts = countOccurrences(content, MARKER_START);
    const ends = countOccurrences(content, MARKER_END);
    const isClean = starts === 0 && ends === 0;
    const isBalanced = starts === 1 && ends === 1;
    if (!isClean && !isBalanced) {
        throw new MarkerCorruptError(starts, ends);
    }
    if (isBalanced) {
        // Single-match replace (Python's `re.sub` replaces the first match only
        // when used without `count` override; since the markers are unique the
        // result is identical to `replace(first_match, replacement)`).
        return content.replace(_MANAGED_RE, replacement);
    }
    if (content) {
        let base = content;
        if (!base.endsWith("\n")) {
            base += "\n";
        }
        return `${base}\n${replacement}\n`;
    }
    return `${replacement}\n`;
}
/**
 * Splice `blockBody` between a root file's reference markers
 * (`wiki-managed: reference start/end`), preserving everything outside.
 *
 * BODY-PAIR GUARD: if the file already carries the body pair
 * (`<!-- wiki-managed: start -->`), it already contains the imperative core
 * verbatim (both blocks come from `buildImperativeCoreLines`), so splicing
 * the reference block too would duplicate the directive + routing table.
 * Such files are returned unchanged with `skipped: true` — the caller
 * reports them as `skipped (body-managed)`.
 *
 * Missing file / no markers → block is appended wrapped in reference
 * markers (same semantics as `updateClaudeMd` for the body pair).
 * Unbalanced reference markers throw `MarkerCorruptError`.
 */
export function updateReferenceBlock(filePath, blockBody) {
    let content = "";
    if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, { encoding: "utf-8" });
    }
    // Body-pair guard: body-managed files already carry the imperative core.
    if (content.includes(MARKER_START)) {
        return { content, skipped: true };
    }
    const replacement = `${REFERENCE_MARKER_START}\n${blockBody}${REFERENCE_MARKER_END}`;
    const starts = countOccurrences(content, REFERENCE_MARKER_START);
    const ends = countOccurrences(content, REFERENCE_MARKER_END);
    const isClean = starts === 0 && ends === 0;
    const isBalanced = starts === 1 && ends === 1;
    if (!isClean && !isBalanced) {
        throw new MarkerCorruptError(starts, ends);
    }
    if (isBalanced) {
        return { content: content.replace(_REFERENCE_RE, replacement), skipped: false };
    }
    if (content) {
        let base = content;
        if (!base.endsWith("\n")) {
            base += "\n";
        }
        return { content: `${base}\n${replacement}\n`, skipped: false };
    }
    return { content: `${replacement}\n`, skipped: false };
}
/**
 * Return content between wiki-managed markers, or null if absent.
 */
export function extractManagedSection(content) {
    const match = _MANAGED_RE.exec(content);
    if (match && match[1] !== undefined) {
        return match[1];
    }
    return null;
}
/**
 * List directories that have their own CLAUDE.md files.
 *
 * Returns relative paths from `projectRoot`. The root CLAUDE.md itself
 * is excluded.
 */
export function listSubmodules(projectRoot) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile() && entry.name === "CLAUDE.md") {
                const parent = path.dirname(full);
                if (parent === projectRoot)
                    continue; // skip root CLAUDE.md
                const rel = path.relative(projectRoot, parent);
                out.push(rel);
            }
        }
    };
    walk(projectRoot);
    return out.sort();
}
function parseArgs(argv) {
    const out = {};
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a === undefined) {
            i++;
            continue;
        }
        if (a === "-h" || a === "--help") {
            out.help = true;
            i++;
            continue;
        }
        if (a === "--check") {
            out.check = true;
            i++;
            continue;
        }
        if (a === "--block") {
            out.block = true;
            i++;
            continue;
        }
        let name;
        let value;
        if (a.startsWith("--")) {
            const eq = a.indexOf("=");
            if (eq >= 0) {
                name = a.slice(2, eq);
                value = a.slice(eq + 1);
                i++;
            }
            else {
                name = a.slice(2);
                value = argv[i + 1];
                i += 2;
            }
        }
        else {
            throw new Error(`unrecognized argument: ${a}`);
        }
        switch (name) {
            case "project-root":
                out.projectRoot = value ?? "";
                break;
            case "wiki-root":
                out.wikiRoot = value ?? "";
                break;
            case "submodule":
                out.submodule = value ?? "";
                break;
            case "update":
                out.update = value ?? "";
                break;
            default:
                throw new Error(`unrecognized argument: --${name}`);
        }
    }
    return out;
}
const HELP_TEXT = `usage: claude_md_gen.js [-h] --project-root PROJECT_ROOT --wiki-root WIKI_ROOT [--submodule SUBMODULE] [--update FILE] [--check] [--block]

Generate or update CLAUDE.md with wiki-managed sections.

options:
  -h, --help            show this help message and exit
  --project-root PROJECT_ROOT
                        Root directory of the project
  --wiki-root WIKI_ROOT
                        Path to the wiki directory
  --submodule SUBMODULE
                        Submodule relative path (for submodule-specific CLAUDE.md)
  --update FILE         Path to existing CLAUDE.md to update in-place
  --check               Dry-run with --update: print would-be content as JSON to
                        stdout without writing the target file. Exit 0 on success,
                        1 on MarkerCorruptError (same as --update without --check).
                        Has no effect when --update is not set.
  --block               Print ONLY the managed-block body (behavioral directive +
                        intent→page routing table + wiki index link + AI-tool
                        config registry pointer when <wiki-root>/ai-dev exists)
                        to stdout — no markers, no file writes. Links are
                        relative to --project-root. Used by atlas Phase 8 to
                        fill the "wiki-managed: reference" block in AI-tool
                        root files. With --update FILE, splice the body between
                        the file's "wiki-managed: reference start/end" markers
                        instead — SKIPPED when the file already carries the
                        body pair "wiki-managed: start" (it already contains
                        the imperative core; duplicating it is never correct).
                        Honors --check (JSON dry-run).
`;
export function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArgs(argv);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (args.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (!args.projectRoot || !args.wikiRoot) {
        process.stderr.write("the following arguments are required: --project-root, --wiki-root\n");
        return 2;
    }
    if (args.block) {
        const blockBody = generateManagedBlock(args.projectRoot, args.wikiRoot);
        if (args.update) {
            // Guarded reference splice: write the body between the target's
            // `wiki-managed: reference` markers — UNLESS the target already
            // carries the body pair (it then already contains the imperative
            // core, and splicing again would duplicate it).
            let result;
            try {
                result = updateReferenceBlock(args.update, blockBody);
            }
            catch (e) {
                if (e instanceof MarkerCorruptError) {
                    process.stdout.write(JSON.stringify({
                        status: "error",
                        error_code: e.error_code,
                        message: e.message,
                        details: { starts: e.starts, ends: e.ends },
                    }, null, 2) + "\n");
                    return 1;
                }
                throw e;
            }
            if (args.check) {
                process.stdout.write(JSON.stringify(result.skipped
                    ? { status: "skipped", reason: "body-managed", target: args.update }
                    : { status: "would-update", target: args.update, would_write: result.content }, null, 2) + "\n");
                return 0;
            }
            if (result.skipped) {
                process.stdout.write(`Skipped (body-managed): ${args.update}\n`);
                return 0;
            }
            fs.mkdirSync(path.dirname(args.update), { recursive: true });
            fs.writeFileSync(args.update, result.content);
            process.stdout.write(`Updated: ${args.update}\n`);
            return 0;
        }
        // No --update: print only the managed-block body (no markers, no
        // writes). The caller splices it between the existing
        // `wiki-managed: reference` markers in CLAUDE.md / AGENTS.md / etc.
        process.stdout.write(blockBody);
        return 0;
    }
    const fullGenerated = generateClaudeMd(args.projectRoot, args.wikiRoot, args.submodule ?? null);
    let inner = extractManagedSection(fullGenerated);
    if (inner === null) {
        inner = fullGenerated;
    }
    if (args.update) {
        let result;
        try {
            result = updateClaudeMd(args.update, inner);
        }
        catch (e) {
            if (e instanceof MarkerCorruptError) {
                // G-CLAUDE-MD-MARKER: surface as structured JSON + non-zero exit so
                // the orchestrator (and any callers) can inspect error_code.
                process.stdout.write(JSON.stringify({
                    status: "error",
                    error_code: e.error_code,
                    message: e.message,
                    details: { starts: e.starts, ends: e.ends },
                }, null, 2) + "\n");
                return 1;
            }
            throw e;
        }
        if (args.check) {
            process.stdout.write(JSON.stringify({
                status: "would-update",
                target: args.update,
                would_write: result,
            }, null, 2) + "\n");
            return 0;
        }
        fs.mkdirSync(path.dirname(args.update), { recursive: true });
        fs.writeFileSync(args.update, result);
        process.stdout.write(`Updated: ${args.update}\n`);
    }
    else {
        // Match Python's `print(full_generated)` — adds a trailing newline on
        // top of whatever `fullGenerated` already ends with.
        process.stdout.write(fullGenerated + "\n");
    }
    return 0;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
