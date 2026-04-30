#!/usr/bin/env node
/**
 * banlist.ts — anti-repetition memory harvester (v2 design §14 + diag §15).
 *
 * Walks `<wikiRoot>/wiki/claims/**\/*.md`, collects claims whose
 * frontmatter has `status: deprecated` and a non-empty `failure_reason`,
 * and emits a markdown bullet list suitable for splicing into
 * `summaries.md` under an `## Anti-repetition Memory` heading.
 *
 * Rationale: deprecated claims record WHY a direction was abandoned so
 * future ingests and queries can avoid re-exploring dead ends. Keeping
 * those reasons only on the individual claim pages isn't enough — they
 * need to be aggregated where Claude scans first.
 *
 * Usage as a library:
 *     import { buildBanlistSection } from "./banlist.js";
 *     const section = buildBanlistSection(wikiRoot);
 *     // "" when nothing is deprecated, else a markdown section body.
 *
 * Usage as a CLI:
 *     node banlist.js build --wiki-root /path/to/wiki [--max 50]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./_cli_args.js";
import { parseFrontmatter } from "./_frontmatter.js";

/** Default cap on entries in the section. */
const MAX_ENTRIES_DEFAULT = 50;

/** One aggregated banlist entry, used internally for sorting + render. */
interface BanlistEntry {
  title: string;
  relPath: string;
  failure_reason: string;
  updated: string;
}

/** Recursively collect absolute paths to every `.md` under `dir`. */
function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const d = stack.pop();
    if (d === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && full.endsWith(".md")) out.push(full);
    }
  }
  return out;
}

/**
 * Harvest deprecated claims and render the "Anti-repetition Memory"
 * markdown section. Returns `""` when there are no deprecated claims
 * so callers can conditionally splice.
 *
 * Entries are sorted by `updated` descending (freshest deprecation
 * first) and capped at `maxEntries` (default 50).
 */
export function buildBanlistSection(
  wikiRoot: string,
  maxEntries: number = MAX_ENTRIES_DEFAULT,
): string {
  const claimsDir = path.join(wikiRoot, "wiki", "claims");
  const entries: BanlistEntry[] = [];

  for (const file of walkMarkdown(claimsDir)) {
    let content: string;
    try {
      content = fs.readFileSync(file, { encoding: "utf-8" });
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content).frontmatter ?? {};
    if (fm["status"] !== "deprecated") continue;
    const reason = fm["failure_reason"];
    if (typeof reason !== "string" || reason.trim() === "") continue;

    const title =
      typeof fm["title"] === "string" && fm["title"].trim() !== ""
        ? fm["title"]
        : path.basename(file, ".md");

    const rawUpdated = fm["updated"];
    const updated =
      rawUpdated instanceof Date
        ? rawUpdated.toISOString().slice(0, 10)
        : typeof rawUpdated === "string"
          ? rawUpdated
          : "";

    entries.push({
      title,
      relPath: path.relative(wikiRoot, file),
      failure_reason: reason.trim(),
      updated,
    });
  }

  if (entries.length === 0) return "";

  entries.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  const capped = entries.slice(0, maxEntries);

  const lines: string[] = [];
  lines.push("## Anti-repetition Memory");
  lines.push("");
  lines.push(
    "Deprecated claims and the reasons they failed. Future ingests and " +
      "queries should avoid re-exploring these dead ends unless new " +
      "evidence overturns the failure reason.",
  );
  lines.push("");
  for (const e of capped) {
    // Escape pipe characters in failure_reason just in case a reason
    // contains them — avoids accidentally breaking downstream markdown
    // tables that wrap this section.
    const reason = e.failure_reason.replace(/\|/g, "\\|");
    lines.push(`- [${e.title}](${e.relPath}) — ${reason}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--max": "max",
} as const;

const HELP_TEXT = `usage: banlist.js build --wiki-root WIKI_ROOT [--max N]

Emit the Anti-repetition Memory section for splicing into summaries.md.

options:
  -h, --help            show this help message and exit
  --wiki-root WIKI_ROOT Wiki root path
  --max N               Max entries to include (default ${MAX_ENTRIES_DEFAULT})
`;

export function main(
  argv: readonly string[] = process.argv.slice(2),
): number {
  const subcommand = argv[0];
  if (subcommand === "-h" || subcommand === "--help" || subcommand === undefined) {
    process.stdout.write(HELP_TEXT);
    return subcommand === undefined ? 2 : 0;
  }
  if (subcommand !== "build") {
    process.stderr.write(`unknown subcommand '${subcommand}'. Use 'build'.\n`);
    return 2;
  }

  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(argv.slice(1), FLAG_SPEC);
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
    process.stderr.write("the following arguments are required: --wiki-root\n");
    return 2;
  }
  const maxRaw = parsed.values["max"];
  const max =
    typeof maxRaw === "string" && maxRaw !== ""
      ? Number.parseInt(maxRaw, 10)
      : MAX_ENTRIES_DEFAULT;
  if (!Number.isFinite(max) || max < 0) {
    process.stderr.write(`--max must be a non-negative integer, got '${maxRaw}'\n`);
    return 2;
  }

  process.stdout.write(buildBanlistSection(wikiRoot, max));
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
