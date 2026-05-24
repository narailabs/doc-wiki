#!/usr/bin/env node
/**
 * summaries_rebuild.ts — regenerate wiki/summaries.md deterministically.
 *
 * Per v2 design §20 + diag Path A step 11, `summaries.md` is the
 * progressive-disclosure index that `/doc-wiki:query` loads FIRST so the
 * orchestrator can rank pages without loading any of them. Keeping it
 * in sync with the pages on disk is a step of every write op (ingest,
 * promote, refresh, lint). The v2 report calls this a deterministic
 * rebuild; before this module it was left to LLM judgment.
 *
 * Behaviour:
 *   - Walks `<wikiRoot>/wiki/**\/*.md` via `_wiki_fs.walkLivePages`.
 *   - Skips the index (`wiki/index.md`) and summaries (`wiki/summaries.md`)
 *     themselves so we don't recurse / self-reference.
 *   - Emits one bulleted line per page:
 *         - [Title](relPath) — truncated summary _(tags: a, b)_
 *   - Splices the Anti-repetition Memory section from `banlist.ts` at the
 *     end of the managed block when there are any deprecated claims.
 *   - Content OUTSIDE the `<!-- wiki-managed: summaries start/end -->`
 *     markers is preserved byte-for-byte — users can keep a hand-written
 *     preamble or footer.
 *
 * Usage as a library:
 *     import { rebuildSummaries } from "./summaries_rebuild.js";
 *     rebuildSummaries(wikiRoot);
 *
 * Usage as a CLI:
 *     node summaries_rebuild.js --wiki-root /path/to/wiki
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./_cli_args.js";
import { parseFrontmatter } from "./_frontmatter.js";
import { walkLivePages } from "./_wiki_fs.js";
import { buildBanlistSection } from "./banlist.js";

export const START_MARKER = "<!-- wiki-managed: summaries start -->";
export const END_MARKER = "<!-- wiki-managed: summaries end -->";

/** Rule of thumb: ~50 tokens ≈ ~200 characters of English prose. */
const DEFAULT_SUMMARY_CHARS = 200;

interface PageSummary {
  relPath: string;
  title: string;
  summary: string;
  tags: string[];
}

/** Collapse whitespace, trim, and truncate to `maxChars` with an ellipsis. */
function truncateSummary(raw: string, maxChars: number): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return collapsed.slice(0, maxChars - 1).trimEnd() + "\u2026";
}

function readPage(wikiRoot: string, absPath: string): PageSummary | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, { encoding: "utf-8" });
  } catch {
    return null;
  }
  // Relative to <wikiRoot>/wiki/ so summaries.md can link to siblings as
  // `./topic/page.md` rather than `wiki/topic/page.md`.
  const wikiDir = path.join(wikiRoot, "wiki");
  const relPosix = path.relative(wikiDir, absPath).split(path.sep).join("/");
  if (relPosix === "summaries.md" || relPosix === "index.md") {
    return null;
  }
  const fm = parseFrontmatter(content).frontmatter;
  // Per compilation.md, every wiki page MUST have frontmatter. Pages
  // without any are either still being drafted or are navigation
  // placeholders (e.g. the init-scaffold's empty overview.md). Skip
  // them rather than emitting a filename-with-no-summary bullet.
  if (fm === null) {
    return null;
  }
  const title =
    typeof fm["title"] === "string" && fm["title"].trim() !== ""
      ? fm["title"].trim()
      : path.basename(absPath, ".md");
  const summary =
    typeof fm["summary"] === "string" && fm["summary"].trim() !== ""
      ? fm["summary"].trim()
      : "(no summary)";
  const tags = Array.isArray(fm["tags"])
    ? fm["tags"].filter((t): t is string => typeof t === "string")
    : [];
  return { relPath: relPosix, title, summary, tags };
}

function renderManagedBlock(
  summaries: readonly PageSummary[],
  banlistSection: string,
  maxSummaryChars: number,
): string {
  const lines: string[] = [];
  lines.push(START_MARKER);
  lines.push("");
  lines.push("## Pages");
  lines.push("");
  if (summaries.length === 0) {
    lines.push("_No pages yet._");
    lines.push("");
  } else {
    for (const p of summaries) {
      const summary = truncateSummary(p.summary, maxSummaryChars);
      const tagStr = p.tags.length > 0 ? ` _(tags: ${p.tags.join(", ")})_` : "";
      lines.push(`- [${p.title}](${p.relPath}) — ${summary}${tagStr}`);
    }
    lines.push("");
  }
  if (banlistSection !== "") {
    lines.push(banlistSection.replace(/\n+$/, ""));
    lines.push("");
  }
  lines.push(END_MARKER);
  return lines.join("\n");
}

/**
 * Splice the managed block into `existing`. Content above / below the
 * markers is preserved. When no markers are present the block is
 * appended, separated from existing content by a blank line.
 */
function spliceManagedBlock(existing: string, managed: string): string {
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).replace(/\n+$/, "");
    const after = existing
      .slice(endIdx + END_MARKER.length)
      .replace(/^\n+/, "");
    const head = before === "" ? "" : before + "\n\n";
    const tail = after === "" ? "\n" : "\n\n" + after;
    return head + managed + tail;
  }
  const trimmed = existing.replace(/\n+$/, "");
  const head = trimmed === "" ? "" : trimmed + "\n\n";
  return head + managed + "\n";
}

/**
 * Rebuild `<wikiRoot>/wiki/summaries.md` from the current set of pages
 * and deprecated claims. Returns the absolute path to the rewritten
 * file. Creates the file if it doesn't exist. Idempotent: running twice
 * with unchanged pages produces the same byte-for-byte file.
 */
export function rebuildSummaries(
  wikiRoot: string,
  options: { maxSummaryChars?: number } = {},
): string {
  const maxSummaryChars = options.maxSummaryChars ?? DEFAULT_SUMMARY_CHARS;

  const summaries: PageSummary[] = [];
  for (const p of walkLivePages(wikiRoot)) {
    const s = readPage(wikiRoot, p.absPath);
    if (s !== null) summaries.push(s);
  }
  // walkLivePages is sorted lexicographically; summaries inherit that order.

  const banlist = buildBanlistSection(wikiRoot);
  const managed = renderManagedBlock(summaries, banlist, maxSummaryChars);

  const summariesPath = path.join(wikiRoot, "wiki", "summaries.md");
  let existing = "";
  try {
    existing = fs.readFileSync(summariesPath, { encoding: "utf-8" });
  } catch {
    existing = "";
  }
  const next = spliceManagedBlock(existing, managed);
  fs.mkdirSync(path.dirname(summariesPath), { recursive: true });
  fs.writeFileSync(summariesPath, next);
  return summariesPath;
}

// ── CLI ────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--max-summary-chars": "maxSummaryChars",
} as const;

const HELP_TEXT = `usage: summaries_rebuild.js --wiki-root WIKI_ROOT [--max-summary-chars N]

Regenerate <wikiRoot>/wiki/summaries.md from the current pages on disk.
Content outside the <!-- wiki-managed: summaries start/end --> markers
is preserved.

options:
  -h, --help                   show this help message and exit
  --wiki-root WIKI_ROOT        Wiki root path
  --max-summary-chars N        Max summary length in chars (default ${DEFAULT_SUMMARY_CHARS})
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(argv, FLAG_SPEC);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const wikiRoot = parsed.values["wikiRoot"];
  if (typeof wikiRoot !== "string" || wikiRoot === "") {
    process.stderr.write(
      "the following arguments are required: --wiki-root\n",
    );
    return 2;
  }
  let maxChars: number | undefined;
  const raw = parsed.values["maxSummaryChars"];
  if (typeof raw === "string" && raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 10) {
      process.stderr.write(
        `--max-summary-chars must be an integer >= 10, got '${raw}'\n`,
      );
      return 2;
    }
    maxChars = n;
  }
  const out = rebuildSummaries(wikiRoot, { maxSummaryChars: maxChars });
  process.stdout.write(`wrote ${out}\n`);
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
