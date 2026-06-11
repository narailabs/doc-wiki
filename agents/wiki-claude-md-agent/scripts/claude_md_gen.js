#!/usr/bin/env node
/**
 * Generate and regenerate CLAUDE.md files with marked-section preservation.
 *
 * Content between ``<!-- wiki-managed: start -->`` and ``<!-- wiki-managed: end -->``
 * is regenerated on re-invocation. All content outside markers is preserved.
 *
 * Library usage:
 *     import { generateClaudeMd, updateClaudeMd } from "./claude_md_gen.js";
 *     const md = generateClaudeMd("/path/to/project", "/path/to/wiki");
 *     const result = updateClaudeMd("CLAUDE.md", newManagedContent);
 *
 * CLI usage:
 *     node claude_md_gen.js --project-root /path --wiki-root /path/wiki
 *     node claude_md_gen.js --project-root /path --wiki-root /path/wiki --update CLAUDE.md
 *
 * This is a TypeScript port of claude_md_gen.py; behaviour matches the
 * Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
 * Walk `<wikiRoot>/wiki/` for `.md` files (excluding `_archive` and other
 * `_*` reserved dirs), read each file's frontmatter, and return page info
 * records. Silently skips unreadable files.
 */
export function listWikiPagesForRouting(wikiRoot) {
    const wikiDir = path.join(wikiRoot, "wiki");
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
                const relPath = path.relative(wikiRoot, full).split(path.sep).join("/");
                pages.push({
                    relPath,
                    facet: fm?.["atlas_facet"] ?? null,
                    title: fm?.["title"] ?? null,
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
 */
const FACET_INTENTS = {
    overview: "understand how the system fits together",
    architecture: "understand the architecture of a subsystem",
    "data-model": "understand the data model or schema",
    api: "trace or modify an API endpoint",
    configuration: "change configuration or environment variables",
    operations: "operate, deploy, or monitor the system",
    environments: "understand runtime environments or deployment targets",
    integrations: "wire in or debug an external service",
    deploy: "understand the deployment pipeline",
    "getting-started": "get set up for the first time",
    commands: "look up available commands or options",
    troubleshooting: "diagnose a failure or unexpected behaviour",
    "service-map": "see the service topology diagram",
    "service-dependencies": "trace inter-service dependencies",
    "client-registry": "find HTTP client callsites",
    "queue-registry": "find queue producers and consumers",
    "database-traces": "trace datasource access paths",
    "shared-libraries": "find shared library usage across services",
};
/**
 * Build a routing table from wiki pages that have a recognized `atlas_facet`.
 * Pages without a known facet are omitted — the table only lists rows the
 * agent can act on.
 *
 * `wikiRelDir` is the path from the project root to the wiki folder
 * (e.g. `"docs/my-app-wiki"` or `"wiki"`), used to prefix page paths.
 */
export function buildRoutingTable(pages, wikiRelDir) {
    // Collect the first page seen per facet (pages are sorted by relPath so the
    // result is deterministic across runs).
    const seen = new Set();
    const rows = [];
    for (const page of pages) {
        if (!page.facet)
            continue;
        const intent = FACET_INTENTS[page.facet];
        if (!intent)
            continue;
        if (seen.has(page.facet))
            continue;
        seen.add(page.facet);
        // page.relPath is already relative to wikiRoot; prepend wikiRelDir if needed
        const fullRel = wikiRelDir ? `${wikiRelDir}/${page.relPath}` : page.relPath;
        rows.push({ intent, pagePath: fullRel });
    }
    // Sort by the order facets appear in FACET_INTENTS for a stable, logical order
    const facetOrder = Object.keys(FACET_INTENTS);
    rows.sort((a, b) => {
        // Recover the facet key from pagePath by looking up which row it came from
        const facetA = pages.find((p) => {
            const fp = wikiRelDir ? `${wikiRelDir}/${p.relPath}` : p.relPath;
            return fp === a.pagePath;
        })?.facet ?? "";
        const facetB = pages.find((p) => {
            const fp = wikiRelDir ? `${wikiRelDir}/${p.relPath}` : p.relPath;
            return fp === b.pagePath;
        })?.facet ?? "";
        const ia = facetOrder.indexOf(facetA);
        const ib = facetOrder.indexOf(facetB);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    return rows;
}
// ── Constants ───────────────────────────────────────────────────────
export const MARKER_START = "<!-- wiki-managed: start -->";
export const MARKER_END = "<!-- wiki-managed: end -->";
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
 * Generate CLAUDE.md content with wiki-managed markers.
 *
 * `projectRoot` is the top-level project directory. `wikiRoot` is the
 * path to the wiki directory. `submodule` (optional) is a relative path
 * to a submodule; when set the generated content includes a link back
 * to the root CLAUDE.md.
 *
 * The generated block leads with a behavioral directive that tells coding
 * agents to consult the wiki before making changes, followed by an
 * intent→resource routing table derived from the actual pages in the wiki.
 * Only pages with a recognized `atlas_facet` appear in the table, so the
 * table degrades gracefully when few pages exist.
 *
 * Returns the full managed section (between markers) as a markdown string.
 */
export function generateClaudeMd(projectRoot, wikiRoot, submodule = null) {
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
    const wikiRel = safeRelpath(wikiRoot, projectRoot);
    const pages = listWikiPagesForRouting(wikiRoot);
    const routingRows = buildRoutingTable(pages, wikiRel);
    if (routingRows.length > 0) {
        lines.push("| If you need to… | Read |");
        lines.push("|---|---|");
        for (const row of routingRows) {
            const filename = path.basename(row.pagePath);
            lines.push(`| ${row.intent} | [${filename}](${row.pagePath}) |`);
        }
        lines.push("");
    }
    // ── Documentation index ─────────────────────────────────────────────
    const wikiIndexPath = wikiRel ? `${wikiRel}/index.md` : "wiki/index.md";
    lines.push(`[Full wiki index](${wikiIndexPath})`);
    lines.push("");
    // ── Submodule back-link ─────────────────────────────────────────────
    if (submodule) {
        const subDepth = submodule.split(path.sep).filter((s) => s.length > 0).length;
        const rootRel = new Array(subDepth).fill("..").join("/");
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
const HELP_TEXT = `usage: claude_md_gen.js [-h] --project-root PROJECT_ROOT --wiki-root WIKI_ROOT [--submodule SUBMODULE] [--update FILE] [--check]

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
