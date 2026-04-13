#!/usr/bin/env node
/**
 * Structural lint checks for the documentation wiki.
 *
 * Checks for broken links, missing frontmatter, orphan pages, isolated
 * graph nodes, code-reference drift, and provenance completeness.
 *
 * Usage as a library:
 *     import { lintWiki, checkBrokenLinks } from "./lint_checks.js";
 *     const result = lintWiki("/path/to/wiki");
 *     // {"issues": [...], "summary": {"error": 2, "warning": 5, "info": 1}}
 *
 * Usage as a script:
 *     node lint_checks.js --wiki-root /path/to/wiki
 *     node lint_checks.js --wiki-root /path --category broken_links
 *
 * This is a TypeScript port of lint_checks.py; behaviour and CLI output
 * match the Python reference byte-for-byte for the same inputs.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { pythonJsonDumps } from "./_json_py.js";
import { isolatedNodes, listEdges } from "./graph_ops.js";
import { parseFlags } from "./_cli_args.js";
// ── Constants ───────────────────────────────────────────────────────
const REQUIRED_FIELDS = new Set([
    "title",
    "type",
    "tags",
    "sources",
    "created",
    "updated",
    "quality",
    "summary",
]);
/** Python: `re.compile(r"\[.*?\]\(([^)]+)\)")` */
const _LINK_RE = /\[.*?\]\(([^)]+)\)/g;
// ── Helpers ─────────────────────────────────────────────────────────
/**
 * Parse YAML frontmatter from page content using Python's strict delimiter
 * rules: the content must start with `---\n` and a trailing `\n---\n` must
 * appear later. Anything else (malformed YAML, wrong delimiters) yields an
 * empty dict, matching lint_checks.py._parse_frontmatter.
 */
function parseFrontmatter(content) {
    if (!content.startsWith("---\n")) {
        return {};
    }
    const end = content.indexOf("\n---\n", 4);
    if (end === -1) {
        return {};
    }
    let parsed;
    try {
        parsed = yaml.load(content.slice(4, end));
    }
    catch {
        return {};
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    return parsed;
}
/** List every `.md` file under `<wikiRoot>/wiki/`, sorted lexicographically
 *  to match Python's `sorted(Path.rglob("*.md"))`. */
function wikiPages(wikiRoot) {
    const wikiDir = path.join(wikiRoot, "wiki");
    if (!fs.existsSync(wikiDir)) {
        return [];
    }
    const out = [];
    const stack = [wikiDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        if (dir === undefined)
            continue;
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
                stack.push(full);
            }
            else if (entry.isFile() && full.endsWith(".md")) {
                out.push(full);
            }
        }
    }
    out.sort();
    return out;
}
function makeIssue(severity, category, page, detail) {
    return { severity, category, page, detail };
}
/** Extract capture group 1 from every markdown link in `content`. */
function findLinks(content) {
    const out = [];
    _LINK_RE.lastIndex = 0;
    let m;
    while ((m = _LINK_RE.exec(content)) !== null) {
        const captured = m[1];
        if (captured !== undefined) {
            out.push(captured);
        }
    }
    return out;
}
// ── Check functions ─────────────────────────────────────────────────
/** Find markdown links pointing to non-existent wiki pages. */
export function checkBrokenLinks(wikiRoot) {
    const issues = [];
    for (const page of wikiPages(wikiRoot)) {
        const content = fs.readFileSync(page, { encoding: "utf-8" });
        const links = findLinks(content);
        for (const link of links) {
            // Skip external URLs, anchors, and non-.md links
            if (link.startsWith("http") || link.startsWith("#") || !link.endsWith(".md")) {
                continue;
            }
            // Resolve relative to the page's directory. Python uses Path.resolve()
            // which normalizes `..` segments; path.resolve does the same.
            const target = path.resolve(path.dirname(page), link);
            if (!fs.existsSync(target)) {
                issues.push(makeIssue("error", "broken_links", page, `Link to ${link} not found`));
            }
        }
    }
    return issues;
}
/** Check all wiki pages for missing required frontmatter fields. */
export function checkFrontmatter(wikiRoot) {
    const issues = [];
    for (const page of wikiPages(wikiRoot)) {
        const content = fs.readFileSync(page, { encoding: "utf-8" });
        const fm = parseFrontmatter(content);
        if (Object.keys(fm).length === 0) {
            issues.push(makeIssue("error", "missing_frontmatter", page, "No frontmatter found (missing --- delimiters)"));
            continue;
        }
        const present = new Set(Object.keys(fm));
        const missing = [];
        for (const field of REQUIRED_FIELDS) {
            if (!present.has(field)) {
                missing.push(field);
            }
        }
        missing.sort();
        for (const field of missing) {
            issues.push(makeIssue("error", "missing_frontmatter", page, `Missing required frontmatter field: ${field}`));
        }
    }
    return issues;
}
/** Find pages not linked from any other page. */
export function checkOrphans(wikiRoot) {
    const issues = [];
    const allPages = wikiPages(wikiRoot);
    // Build set of all linked-to filenames
    const linked = new Set();
    for (const page of allPages) {
        const content = fs.readFileSync(page, { encoding: "utf-8" });
        const links = findLinks(content);
        for (const link of links) {
            if (link.startsWith("http") || link.startsWith("#")) {
                continue;
            }
            // Match Python's `Path(link).name` — the final path component.
            linked.add(path.basename(link));
        }
    }
    const neverOrphan = new Set(["index.md", "summaries.md", "overview.md"]);
    for (const page of allPages) {
        const pageName = path.basename(page);
        if (neverOrphan.has(pageName)) {
            continue;
        }
        if (!linked.has(pageName)) {
            issues.push(makeIssue("warning", "orphan_page", page, "Page is not linked from any other page"));
        }
    }
    return issues;
}
/** Find pages with degree <= 1 in the knowledge graph. */
export function checkIsolatedNodes(wikiRoot) {
    const issues = [];
    const edgesPath = path.join(wikiRoot, "graph", "edges.jsonl");
    const allPages = wikiPages(wikiRoot);
    // Use relative paths matching edge format
    const pageRelPaths = allPages.map((p) => path.relative(wikiRoot, p));
    const isolated = isolatedNodes(edgesPath, pageRelPaths);
    for (const node of isolated) {
        issues.push(makeIssue("warning", "isolated_node", node, "Node has degree <= 1 in the knowledge graph"));
    }
    return issues;
}
/** Check code references for content_hash mismatches. */
export function checkCodeRefDrift(wikiRoot) {
    const issues = [];
    for (const page of wikiPages(wikiRoot)) {
        const content = fs.readFileSync(page, { encoding: "utf-8" });
        const fm = parseFrontmatter(content);
        const refs = fm["references"];
        if (!Array.isArray(refs)) {
            continue;
        }
        for (const refEntry of refs) {
            if (refEntry === null ||
                typeof refEntry !== "object" ||
                Array.isArray(refEntry)) {
                continue;
            }
            const ref = refEntry;
            const refPathVal = ref["path"];
            const storedHashVal = ref["content_hash"];
            const refPath = typeof refPathVal === "string" ? refPathVal : "";
            const storedHash = typeof storedHashVal === "string" ? storedHashVal : "";
            if (!refPath || !storedHash) {
                continue;
            }
            const target = path.join(wikiRoot, refPath);
            if (!fs.existsSync(target)) {
                issues.push(makeIssue("warning", "code_ref_drift", page, `Referenced file ${refPath} not found`));
                continue;
            }
            const actualHash = crypto
                .createHash("sha256")
                .update(fs.readFileSync(target))
                .digest("hex");
            if (actualHash !== storedHash) {
                issues.push(makeIssue("warning", "code_ref_drift", page, `content_hash mismatch for ${refPath}`));
            }
        }
    }
    return issues;
}
/** Check that every edge in edges.jsonl has a provenance field. */
export function checkProvenanceCompleteness(wikiRoot) {
    const issues = [];
    const edgesPath = path.join(wikiRoot, "graph", "edges.jsonl");
    const edges = listEdges(edgesPath);
    edges.forEach((edge, i) => {
        if (!("provenance" in edge)) {
            const fromVal = edge["from"];
            const toVal = edge["to"];
            const fromStr = typeof fromVal === "string" ? fromVal : "?";
            const toStr = typeof toVal === "string" ? toVal : "?";
            issues.push(makeIssue("error", "missing_provenance", `edge #${i + 1}: ${fromStr} -> ${toStr}`, "Edge is missing required 'provenance' field"));
        }
    });
    return issues;
}
/** Warn if > 20% of edges have AMBIGUOUS provenance. */
export function checkHighAmbiguityRate(wikiRoot) {
    const issues = [];
    const edgesPath = path.join(wikiRoot, "graph", "edges.jsonl");
    const edges = listEdges(edgesPath);
    if (edges.length === 0) {
        return issues;
    }
    const ambiguousCount = edges.filter((e) => e["provenance"] === "AMBIGUOUS")
        .length;
    const rate = ambiguousCount / edges.length;
    if (rate > 0.2) {
        // Python's `f"{rate:.0%}"` multiplies by 100, rounds half-to-even, and
        // appends `%`. `Math.round(rate * 100)` uses half-away-from-zero, which
        // diverges only on .5 boundaries; neither of our test inputs sits there.
        // Matching Python's banker's rounding requires a tiny helper.
        const pct = pyRoundPercent(rate);
        issues.push(makeIssue("warning", "high_ambiguity_rate", "graph/edges.jsonl", `Ambiguity rate is ${pct}% (${ambiguousCount}/${edges.length} edges are AMBIGUOUS)`));
    }
    return issues;
}
/**
 * Render `rate` as an integer percentage using Python's "round half to even"
 * rule (matching `format(rate, ".0%")`). Values like 0.75 -> 75, 0.2 -> 20.
 */
function pyRoundPercent(rate) {
    const scaled = rate * 100;
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    if (diff < 0.5)
        return floor;
    if (diff > 0.5)
        return floor + 1;
    // Exactly .5 — banker's rounding: nearest even.
    return floor % 2 === 0 ? floor : floor + 1;
}
// ── Main lint function ──────────────────────────────────────────────
/** Registry of check functions, matching the Python dict insertion order. */
const CHECK_FUNCTIONS = [
    ["broken_links", checkBrokenLinks],
    ["frontmatter", checkFrontmatter],
    ["orphans", checkOrphans],
    ["isolated_nodes", checkIsolatedNodes],
    ["code_ref_drift", checkCodeRefDrift],
    ["provenance", checkProvenanceCompleteness],
    ["ambiguity_rate", checkHighAmbiguityRate],
];
const VALID_CATEGORIES = new Set(CHECK_FUNCTIONS.map(([k]) => k));
/**
 * Run all lint checks (or a single category) and return results.
 */
export function lintWiki(wikiRoot, category = null) {
    let issues = [];
    if (category) {
        const found = CHECK_FUNCTIONS.find(([k]) => k === category);
        if (found) {
            issues = found[1](wikiRoot);
        }
    }
    else {
        for (const [, fn] of CHECK_FUNCTIONS) {
            issues.push(...fn(wikiRoot));
        }
    }
    const summary = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) {
        const sev = issue.severity;
        if (sev === "error")
            summary.error += 1;
        else if (sev === "warning")
            summary.warning += 1;
        else if (sev === "info")
            summary.info += 1;
    }
    return { issues, summary };
}
// ── CLI ─────────────────────────────────────────────────────────────
const FLAG_SPEC = {
    "--wiki-root": "wikiRoot",
    "--category": "category",
};
const HELP_TEXT = `usage: lint_checks.js [-h] --wiki-root WIKI_ROOT [--category CATEGORY]

Wiki structural lint checks.

options:
  -h, --help            show this help message and exit
  --wiki-root WIKI_ROOT Wiki root path
  --category CATEGORY   Run only a specific check category
`;
export function main(argv = process.argv.slice(2)) {
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
    const wikiRoot = parsed.values["wikiRoot"];
    if (typeof wikiRoot !== "string" || wikiRoot === "") {
        process.stderr.write("the following arguments are required: --wiki-root\n");
        return 2;
    }
    const categoryRaw = parsed.values["category"];
    const category = typeof categoryRaw === "string" && categoryRaw ? categoryRaw : null;
    if (category !== null && !VALID_CATEGORIES.has(category)) {
        const allowed = [...VALID_CATEGORIES].join(", ");
        process.stderr.write(`unrecognized --category '${category}'. Allowed: ${allowed}\n`);
        return 2;
    }
    const result = lintWiki(wikiRoot, category);
    process.stdout.write(pythonJsonDumps(result, 2) + "\n");
    return 0;
}
// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
