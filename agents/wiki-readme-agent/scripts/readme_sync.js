#!/usr/bin/env node
/**
 * README.md marker-handling library + CLI for wiki-readme-agent.
 *
 * Library API:
 *   import { extractMarkerBlock, replaceMarkerBlock, insertMarkers } from "./readme_sync.js";
 *
 * CLI:
 *   node readme_sync.js extract --readme <path>
 *   node readme_sync.js write --readme <path> --block-file <path>
 *   node readme_sync.js init --readme <path> --depth <minimal|standard|generous>
 *
 * Mirrors agents/wiki-claude-md-agent/scripts/claude_md_gen.ts patterns:
 * library-first, custom error classes with `error_code`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags as parseSharedFlags } from "../../../skills/doc-wiki/scripts/_cli_args.js";
// ── Constants ───────────────────────────────────────────────────────
export const MARKER_START = "<!-- wiki-managed: quickstart start -->";
export const MARKER_END = "<!-- wiki-managed: quickstart end -->";
const INSTALL_HEADINGS = [
    /^##\s+install\s*$/im,
    /^##\s+installation\s*$/im,
    /^##\s+setup\s*$/im,
    /^##\s+get\s+started\s*$/im,
    /^##\s+getting\s+started\s*$/im,
];
// ── Errors ──────────────────────────────────────────────────────────
export class MarkersMissingError extends Error {
    error_code = "MARKERS_MISSING";
    constructor() {
        super(`README has no wiki-managed quickstart markers. Run with action: "init" to insert them.`);
        this.name = "MarkersMissingError";
    }
}
export class MarkersCorruptError extends Error {
    error_code = "MARKERS_CORRUPT";
    starts;
    ends;
    constructor(starts, ends) {
        super(`Corrupted wiki-managed quickstart markers: ${starts} start marker(s) and ${ends} end marker(s) (expected exactly 1 of each).`);
        this.name = "MarkersCorruptError";
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
export function extractMarkerBlock(readme) {
    const starts = countOccurrences(readme, MARKER_START);
    const ends = countOccurrences(readme, MARKER_END);
    if (starts === 0 && ends === 0)
        throw new MarkersMissingError();
    if (starts !== 1 || ends !== 1)
        throw new MarkersCorruptError(starts, ends);
    const sIdx = readme.indexOf(MARKER_START);
    const eIdx = readme.indexOf(MARKER_END);
    if (eIdx < sIdx)
        throw new MarkersCorruptError(starts, ends);
    // before: everything up to (not including) the start marker
    // after: everything after (not including) the end marker
    const before = readme.substring(0, sIdx);
    const innerStart = sIdx + MARKER_START.length;
    const eEnd = eIdx + MARKER_END.length;
    const inner = readme.substring(innerStart, eIdx);
    const between = inner.replace(/^\n/, "").replace(/\n$/, "");
    const after = readme.substring(eEnd);
    return { before, between, after };
}
export function replaceMarkerBlock(readme, newBlock) {
    const { before, after } = extractMarkerBlock(readme);
    return `${before}${MARKER_START}\n${newBlock}\n${MARKER_END}${after}`;
}
/**
 * Walk the README line-by-line, tracking ``` fence state, and return the
 * 0-based index of the first line that satisfies `predicate` while OUTSIDE
 * any fenced code block. Returns -1 if no such line exists.
 *
 * Toggling on lines that begin with three (or more) backticks covers the
 * common case. Doesn't handle ~~~ fences or 4-space indented code blocks —
 * both rare in modern Markdown READMEs and out of scope for this heuristic.
 *
 * Tracks fence delimiter LENGTH so a 4-backtick fence (commonly used to
 * show triple-backtick examples inside) is closed only by another fence
 * of >=4 backticks — not by a 3-backtick content line. Per CommonMark,
 * the closing fence must be at least as long as the opening one.
 */
function findHeadingLineOutsideFence(readme, predicate) {
    const lines = readme.split("\n");
    // 0 = outside any fence; >=3 = inside a fence with that opening length.
    // CommonMark rules applied:
    //   - Up to 3 leading spaces of indentation on the fence line.
    //   - Opening fence: backticks followed by an optional info string (any text).
    //   - Closing fence: same character, length >= opening, followed by ONLY
    //     whitespace (an info string makes it content, not a closer).
    let openFenceLen = 0;
    const FENCE_RE = /^ {0,3}(`{3,})(.*)$/;
    for (let i = 0; i < lines.length; i++) {
        // Loop bound guarantees the index is valid; cast suppresses
        // noUncheckedIndexedAccess.
        const line = lines[i];
        const fenceMatch = line.match(FENCE_RE);
        if (fenceMatch) {
            const len = fenceMatch[1].length;
            const rest = fenceMatch[2] ?? "";
            if (openFenceLen === 0) {
                // Opening fence — info string allowed.
                openFenceLen = len;
                continue;
            }
            // Closing fence requires length >= opening AND whitespace-only after.
            if (len >= openFenceLen && /^\s*$/.test(rest)) {
                openFenceLen = 0;
                continue;
            }
            // Otherwise: shorter run, or non-whitespace after — content.
        }
        if (openFenceLen > 0)
            continue;
        if (predicate(line))
            return i;
    }
    return -1;
}
export function insertMarkers(readme, placeholder) {
    // Try install-heading regexes in priority order, skipping fenced code.
    let anchorLine = -1;
    for (const re of INSTALL_HEADINGS) {
        anchorLine = findHeadingLineOutsideFence(readme, (line) => re.test(line));
        if (anchorLine !== -1)
            break;
    }
    if (anchorLine === -1) {
        // Fallback: first ## heading outside any fence.
        anchorLine = findHeadingLineOutsideFence(readme, (line) => /^##\s+/.test(line));
    }
    if (anchorLine === -1) {
        // Last resort: append at the end.
        return `${readme}\n${MARKER_START}\n${placeholder}\n${MARKER_END}\n`;
    }
    const lines = readme.split("\n");
    const before = lines.slice(0, anchorLine + 1).join("\n");
    const after = lines.slice(anchorLine + 1).join("\n");
    return `${before}\n\n${MARKER_START}\n${placeholder}\n${MARKER_END}${after.length > 0 ? "\n" + after : ""}`;
}
// ── CLI ─────────────────────────────────────────────────────────────
const HELP_TEXT = `usage: readme_sync.js {extract,write,init} [...]

Subcommands:
  extract --readme <path>
                    Print the marker block as JSON: { before, between, after }.
                    Errors emit { status: "error", error_code, message }.

  write   --readme <path> --block-file <path>
                    Replace the marker block with the contents of <block-file>.
                    Preserves text outside the markers.

  init    --readme <path> --depth {minimal|standard|generous}
                    Insert markers if missing. Idempotent when markers exist.
                    The depth seeds a one-line placeholder (real content lands
                    on the next /doc-wiki:atlas run).
`;
// All three depths currently seed the same one-line placeholder. Real depth
// differentiation happens at sync time, when the agent generates the new
// quickstart block from wiki/getting-started.md per the depth template.
const PLACEHOLDERS = {
    minimal: "> Quickstart synced from wiki/getting-started.md on next /doc-wiki:atlas run.",
    standard: "> Quickstart synced from wiki/getting-started.md on next /doc-wiki:atlas run.",
    generous: "> Quickstart synced from wiki/getting-started.md on next /doc-wiki:atlas run.",
};
const FLAG_SPEC = {
    "--readme": "readme",
    "--block-file": "blockFile",
    "--depth": "depth",
};
function parseLocalFlags(argv) {
    const parsed = parseSharedFlags(argv, FLAG_SPEC);
    return {
        readme: typeof parsed.values.readme === "string" ? parsed.values.readme : undefined,
        blockFile: typeof parsed.values.blockFile === "string" ? parsed.values.blockFile : undefined,
        depth: typeof parsed.values.depth === "string" ? parsed.values.depth : undefined,
        help: parsed.help,
    };
}
function emitError(error_code, message, details) {
    process.stdout.write(JSON.stringify({ status: "error", error_code, message, ...(details ?? {}) }, null, 2) +
        "\n");
}
function cmdExtract(flags) {
    if (!flags.readme) {
        process.stderr.write("--readme is required\n");
        return 2;
    }
    if (!fs.existsSync(flags.readme)) {
        emitError("README_MISSING", `README not found: ${flags.readme}`);
        return 1;
    }
    const readme = fs.readFileSync(flags.readme, "utf-8");
    try {
        const out = extractMarkerBlock(readme);
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
        return 0;
    }
    catch (e) {
        if (e instanceof MarkersMissingError) {
            emitError("MARKERS_MISSING", e.message);
            return 1;
        }
        if (e instanceof MarkersCorruptError) {
            emitError("MARKERS_CORRUPT", e.message, {
                starts: e.starts,
                ends: e.ends,
            });
            return 1;
        }
        throw e;
    }
}
function cmdWrite(flags) {
    if (!flags.readme || !flags.blockFile) {
        process.stderr.write("--readme and --block-file are required\n");
        return 2;
    }
    if (!fs.existsSync(flags.readme)) {
        emitError("README_MISSING", `README not found: ${flags.readme}`);
        return 1;
    }
    if (!fs.existsSync(flags.blockFile)) {
        emitError("BLOCK_FILE_MISSING", `Block file not found: ${flags.blockFile}`);
        return 1;
    }
    const readme = fs.readFileSync(flags.readme, "utf-8");
    const block = fs.readFileSync(flags.blockFile, "utf-8").replace(/\n$/, "");
    try {
        const out = replaceMarkerBlock(readme, block);
        fs.writeFileSync(flags.readme, out);
        process.stdout.write(JSON.stringify({ status: "success", written: flags.readme }, null, 2) +
            "\n");
        return 0;
    }
    catch (e) {
        if (e instanceof MarkersMissingError) {
            emitError("MARKERS_MISSING", e.message);
            return 1;
        }
        if (e instanceof MarkersCorruptError) {
            emitError("MARKERS_CORRUPT", e.message, {
                starts: e.starts,
                ends: e.ends,
            });
            return 1;
        }
        throw e;
    }
}
function cmdInit(flags) {
    if (!flags.readme) {
        process.stderr.write("--readme is required\n");
        return 2;
    }
    const depth = flags.depth ?? "generous";
    if (!["minimal", "standard", "generous"].includes(depth)) {
        process.stderr.write(`invalid --depth: ${depth}\n`);
        return 2;
    }
    if (!fs.existsSync(flags.readme)) {
        emitError("README_MISSING", `README not found: ${flags.readme}`);
        return 1;
    }
    const readme = fs.readFileSync(flags.readme, "utf-8");
    // Idempotent — if markers exist, do nothing.
    try {
        extractMarkerBlock(readme);
        process.stdout.write(JSON.stringify({ status: "noop", reason: "markers already present" }, null, 2) +
            "\n");
        return 0;
    }
    catch (e) {
        if (!(e instanceof MarkersMissingError)) {
            // Corrupt markers — surface error rather than overwriting
            if (e instanceof MarkersCorruptError) {
                emitError("MARKERS_CORRUPT", e.message, {
                    starts: e.starts,
                    ends: e.ends,
                });
                return 1;
            }
            throw e;
        }
    }
    const out = insertMarkers(readme, PLACEHOLDERS[depth]);
    fs.writeFileSync(flags.readme, out);
    process.stdout.write(JSON.stringify({ status: "success", written: flags.readme, depth }, null, 2) +
        "\n");
    return 0;
}
export function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    const sub = argv[0];
    let flags;
    try {
        flags = parseLocalFlags(argv.slice(1));
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (flags.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    switch (sub) {
        case "extract":
            return cmdExtract(flags);
        case "write":
            return cmdWrite(flags);
        case "init":
            return cmdInit(flags);
        default:
            process.stderr.write(`unknown subcommand: ${sub}\n`);
            return 2;
    }
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
