#!/usr/bin/env node
/**
 * Gitlog drift detection for `/doc-wiki:atlas`.
 *
 * Walks `git log --since=<duration> --name-only --pretty=format:` and
 * classifies each changed path against the wiki's atlas-tagged pages and
 * the current run's topic list:
 *
 *   - **stale**     — path matches a `sources:` entry on an existing atlas
 *                     page; the page may need refresh.
 *   - **uncovered** — path matches no atlas page but falls under one of the
 *                     current-run topics; ingestion candidate.
 *   - **unrelated** — path matches nothing relevant; logged but ignored.
 *
 * Usage as a library:
 *     import { getChangedFilesSince, classifyChanges } from "./atlas_gitlog.js";
 *     const files = getChangedFilesSince(repoRoot, "30d");
 *
 * Usage as a script:
 *     node atlas_gitlog.js classify \
 *         --wiki-root <path> [--repo-root <path>] [--since <duration>] \
 *         [--topics <csv>]
 *
 * `--since` accepts any `git log --since` form (`30d`, `2 weeks ago`,
 * `2026-01-01`). When omitted, the script reads `log/events.jsonl` for the
 * last `op: atlas` event and uses its timestamp; if no prior atlas run
 * exists, runs git log with no `--since` (full history).
 *
 * Output is a single JSON line on stdout:
 *   {
 *     "since": "<resolved value or null>",
 *     "changed_files": ["..."],
 *     "stale_pages": [{ "page": "wiki/auth/architecture.md", "sources": ["src/auth/index.ts"] }],
 *     "uncovered_files": [{ "path": "src/billing/new.ts", "topic": "billing" }],
 *     "unrelated_files": ["docs/notes.md"]
 *   }
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./_cli_args.js";
import { parseFrontmatter } from "./_frontmatter.js";
// ── Last atlas run ─────────────────────────────────────────────────
/**
 * Return the timestamp of the most recent `op: atlas` event in
 * `<wikiRoot>/log/events.jsonl`, or `null` if none exists or the log is
 * unreadable. Timestamps follow the convention `event_logger.ts` writes
 * (`pythonIsoformatUtc` — ISO 8601 with `+00:00` offset).
 */
export function getLastAtlasTimestamp(wikiRoot) {
    const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
    if (!fs.existsSync(eventsPath))
        return null;
    let raw;
    try {
        raw = fs.readFileSync(eventsPath, "utf-8");
    }
    catch {
        return null;
    }
    // Walk backwards — most recent atlas event wins.
    // ⚡ Bolt: Iterate backwards using lastIndexOf and substring to avoid
    // massive synchronous array allocation from .split('\n') on large log files
    let pos = raw.length;
    while (pos > 0) {
        const prevPos = raw.lastIndexOf("\n", pos - 1);
        const line = raw.substring(prevPos + 1, pos);
        pos = prevPos;
        if (!line)
            continue;
        // Fast-path: skip JSON parse overhead if this line cannot be an atlas event
        if (!line.includes('"atlas"'))
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const rec = parsed;
            if (rec["op"] === "atlas" && typeof rec["timestamp"] === "string") {
                return rec["timestamp"];
            }
        }
    }
    return null;
}
// ── Git log ─────────────────────────────────────────────────────────
/**
 * Return the deduplicated sorted list of paths touched by `git log` with the
 * given `--since` clause (or no `--since` when null). All paths are
 * repo-relative (forward slashes; Git's native form on every OS).
 *
 * Throws if `git` is not on PATH or the repo root is invalid; callers should
 * catch and treat as "no changes" if they want graceful degradation.
 */
export function getChangedFilesSince(repoRoot, since) {
    const args = ["-C", repoRoot, "log", "--name-only", "--pretty=format:"];
    if (since !== null && since.trim().length > 0) {
        args.push(`--since=${since}`);
    }
    const out = execFileSync("git", args, {
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
    });
    const set = new Set();
    for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0)
            set.add(trimmed);
    }
    return [...set].sort();
}
/**
 * Walk `<wikiRoot>/wiki/` recursively, parse frontmatter on every `.md`
 * page, and return the entries that carry an `atlas_run_id` field. Pages
 * that lack the field (manual `/doc-wiki:ingest` results, or pre-atlas
 * pages) are skipped — only atlas-generated pages are validated.
 */
export function indexAtlasPages(wikiRoot) {
    const wikiContent = path.join(wikiRoot, "wiki");
    if (!fs.existsSync(wikiContent))
        return [];
    const out = [];
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
            const { frontmatter } = parseFrontmatter(body);
            if (!frontmatter)
                continue;
            const runId = frontmatter["atlas_run_id"];
            if (typeof runId !== "string" || runId.length === 0)
                continue;
            const sourcesRaw = frontmatter["sources"];
            const sources = Array.isArray(sourcesRaw)
                ? sourcesRaw.filter((x) => typeof x === "string")
                : [];
            out.push({
                page: path.relative(wikiRoot, full).split(path.sep).join("/"),
                sources,
                atlas_run_id: runId,
            });
        }
    };
    walk(wikiContent);
    return out;
}
// ── Classification ─────────────────────────────────────────────────
/**
 * Match a single changed `filePath` against the atlas-page index, choosing
 * the FIRST page whose `sources:` array contains the path either as an exact
 * string or as a directory prefix. Returns `null` on no match.
 *
 * Directory-prefix matching matters because atlas pages often source
 * directories (`src/auth/`), and a changed file under that directory should
 * mark the page stale.
 */
function _matchPage(filePath, index) {
    for (const entry of index) {
        for (const src of entry.sources) {
            if (src === filePath)
                return entry;
            const dirSrc = src.endsWith("/") ? src : `${src}/`;
            if (filePath.startsWith(dirSrc))
                return entry;
        }
    }
    return null;
}
/**
 * Match a changed `filePath` against the topic list. Returns the topic name
 * if the file lives under a `<topic>/`-shaped path component (`src/<topic>/`,
 * `app/<topic>/`, `services/<topic>/`, or just `<topic>/...` at the repo root)
 * otherwise `null`.
 */
function _matchTopic(filePath, topics) {
    const parts = filePath.split("/");
    for (const topic of topics) {
        if (parts.includes(topic))
            return topic;
    }
    return null;
}
/**
 * Take a changed-files list and produce the three buckets that drive Phase 5
 * of the atlas pipeline (stale / uncovered / unrelated).
 *
 * Stale wins over uncovered: a file referenced by an atlas page is always
 * "stale" even if it also matches a current-run topic.
 */
export function classifyChanges(changedFiles, pageIndex, topics) {
    const staleByPage = new Map();
    const uncovered = [];
    const unrelated = [];
    for (const file of changedFiles) {
        const matchedPage = _matchPage(file, pageIndex);
        if (matchedPage !== null) {
            const existing = staleByPage.get(matchedPage.page) ?? new Set();
            existing.add(file);
            staleByPage.set(matchedPage.page, existing);
            continue;
        }
        const topic = _matchTopic(file, topics);
        if (topic !== null) {
            uncovered.push({ path: file, topic });
            continue;
        }
        unrelated.push(file);
    }
    const stale_pages = [];
    for (const [page, sources] of [...staleByPage.entries()].sort()) {
        stale_pages.push({ page, sources: [...sources].sort() });
    }
    return {
        stale_pages,
        uncovered_files: uncovered,
        unrelated_files: unrelated,
    };
}
// ── CLI ────────────────────────────────────────────────────────────
const FLAG_SPEC = {
    "--wiki-root": "wikiRoot",
    "--repo-root": "repoRoot",
    "--since": "since",
    "--topics": "topics",
};
const HELP_TEXT = `usage: atlas_gitlog.js classify [-h] --wiki-root <path>
                                [--repo-root <path>] [--since <duration>]
                                [--topics <csv>]

Classify gitlog-changed files against atlas pages and current topic list.

If --since is omitted, uses the timestamp of the last \`op: atlas\` event in
log/events.jsonl. If no atlas event exists, runs git log without --since
(full history).

Output: one JSON object on stdout with keys
  since, changed_files, stale_pages, uncovered_files, unrelated_files.
`;
export function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (argv[0] !== "classify") {
        process.stderr.write(`unknown subcommand: ${argv[0]}\n`);
        return 2;
    }
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
    const repoRoot = typeof parsed.values["repoRoot"] === "string" &&
        parsed.values["repoRoot"].length > 0
        ? parsed.values["repoRoot"]
        : process.cwd();
    let since = null;
    if (typeof parsed.values["since"] === "string" &&
        parsed.values["since"].length > 0) {
        since = parsed.values["since"];
    }
    else {
        const last = getLastAtlasTimestamp(wikiRoot);
        if (last !== null)
            since = last;
    }
    const topicsCsv = typeof parsed.values["topics"] === "string" ? parsed.values["topics"] : "";
    const topics = topicsCsv
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    let changed;
    try {
        changed = getChangedFilesSince(repoRoot, since);
    }
    catch (e) {
        process.stderr.write(`git log failed: ${e.message}\n`);
        return 1;
    }
    const index = indexAtlasPages(wikiRoot);
    const buckets = classifyChanges(changed, index, topics);
    const result = {
        since,
        changed_files: changed,
        ...buckets,
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
