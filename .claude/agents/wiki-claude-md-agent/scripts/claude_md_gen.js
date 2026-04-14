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
 * Returns the full managed section (between markers) as a markdown string.
 */
export function generateClaudeMd(projectRoot, wikiRoot, submodule = null) {
    const lines = [];
    // Overview
    lines.push("## Overview");
    lines.push("");
    const projectName = path.basename(projectRoot) || "Project";
    lines.push(`Auto-generated documentation index for **${projectName}**.`);
    lines.push("");
    // Wiki link — prefer a relative path when possible.
    const wikiRel = safeRelpath(wikiRoot, projectRoot);
    lines.push(`- [Wiki documentation](${wikiRel}/index.md)`);
    lines.push("");
    if (submodule) {
        // Link back to root CLAUDE.md
        const subDepth = submodule.split(path.sep).filter((s) => s.length > 0).length;
        const rootRel = new Array(subDepth).fill("..").join("/");
        lines.push("## Parent Project");
        lines.push("");
        lines.push(`- [Root CLAUDE.md](${rootRel}/CLAUDE.md)`);
        lines.push("");
    }
    // Submodules listing (only for root, not submodule pages)
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
    // Build & Run
    lines.push("## Build & Run");
    lines.push("");
    lines.push("See project-specific build instructions.");
    lines.push("");
    // Service Dependencies
    lines.push("## Service Dependencies");
    lines.push("");
    lines.push("See wiki for service dependency details.");
    lines.push("");
    // Database references
    lines.push("## Database References");
    lines.push("");
    lines.push("See wiki for database schema documentation.");
    lines.push("");
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
const HELP_TEXT = `usage: claude_md_gen.js [-h] --project-root PROJECT_ROOT --wiki-root WIKI_ROOT [--submodule SUBMODULE] [--update FILE]

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
