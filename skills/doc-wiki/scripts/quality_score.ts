#!/usr/bin/env node
/**
 * Quality scoring for wiki pages (0.0-1.0).
 *
 * Computes a combined quality score from content-level signals (word count,
 * frontmatter completeness, links, tags) and structural signals (graph
 * degree, Mermaid diagrams). Score is clamped to [0.0, 1.0].
 *
 * Usage as a library:
 *     import { scorePage, scoreWiki } from "./quality_score.js";
 *     const result = scorePage("wiki/auth/session.md", "graph/edges.jsonl");
 *     // {"quality": 0.85, "signals": [{"signal": "word_count", "delta": 0.8}, ...]}
 *
 * Usage as a script:
 *     node quality_score.js --page wiki/auth/session.md --edges graph/edges.jsonl
 *     node quality_score.js --wiki-root /path/to/wiki
 *
 * This is a TypeScript port of quality_score.py; CLI output and scoring
 * match the Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDegrees } from "./graph_ops.js";
import { parseFlags } from "./_cli_args.js";
import { parseFrontmatter } from "./_frontmatter.js";
import { wikiPages } from "./_wiki_fs.js";

// ── Constants ───────────────────────────────────────────────────────

const REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "type",
  "tags",
  "sources",
  "created",
  "updated",
  "quality",
  "summary",
]);

/** Tags that suggest a page should have a Mermaid diagram. */
const MERMAID_EXPECTED_TAGS: ReadonlySet<string> = new Set([
  "database",
  "schema",
  "architecture",
  "service",
  "infrastructure",
  "erd",
  "topology",
]);

/** Python: `re.compile(r"\[.*?\]\((?!http|#)(.*?\.md)\)")` — global. */
const _LINK_RE = /\[.*?\]\((?!http|#)(.*?\.md)\)/g;
/** Python: `re.compile(r"```mermaid\s*\n.*?```", re.DOTALL)`. */
const _MERMAID_RE = /```mermaid\s*\n[\s\S]*?```/;

// ── Library API ─────────────────────────────────────────────────────

/**
 * Adapter for the shared parser: quality_score historically returned
 * `[{}, content]` on failure (the original content as the body). We re-apply
 * that contract on top of the shared helper, which exposes the parsed dict
 * as `null` and keeps the original content as the body in the same case.
 */
function parseFrontmatterWithBody(
  content: string,
): [Record<string, unknown>, string] {
  const r = parseFrontmatter(content);
  return [r.frontmatter ?? {}, r.body];
}

/** A single scoring signal, mirroring the Python dict shape. */
export interface Signal {
  signal: string;
  delta: number;
}

/** Shape returned by scorePage(). */
export interface PageScore {
  quality: number;
  signals: Signal[];
}

/** Match Python's `len(body.split())` — whitespace-split, drop empties. */
function wordCount(body: string): number {
  const parts = body.split(/\s+/);
  let n = 0;
  for (const p of parts) {
    if (p.length > 0) n++;
  }
  return n;
}

/** Match Python's `re.findall(_LINK_RE, body)`. Returns an array of the
 *  single capture group (the link target) per match. */
function findCrossrefLinks(body: string): string[] {
  const out: string[] = [];
  _LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = _LINK_RE.exec(body)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/** Python `math.ceil(n * 0.1)` — but `max(1, ...)`. */
function thresholdIndex(totalDegrees: number): number {
  return Math.max(1, Math.ceil(totalDegrees * 0.1));
}

/**
 * Compute quality score for a single wiki page.
 *
 * The score is the sum of all signal deltas, clamped to [0.0, 1.0] and
 * rounded to 4 decimal places. Returns both the final score (wrapped with
 * and the list of individual signals.
 *
 * A3 — "Why did /doc-wiki:fix's quality go down?":
 *   The signals are all *content-shape* signals — word count, frontmatter
 *   completeness, link density, tags, mermaid presence, structural degree.
 *   None of them care about *correctness* (HS256 vs RS256), about *recency*
 *   (a fresh `updated:` is neutral), or about whether the change was a fix
 *   versus a rewrite. The function is pure and idempotent: the same page
 *   always produces the same score.
 *
 *   So if `/doc-wiki:fix` recomputes a score that's lower than the page's
 *   author-set frontmatter `quality:` field, that means the original value
 *   was higher than the algorithm would assign — typically because it was
 *   hand-set to an aspirational value (a 117-word page hand-tagged as 0.85
 *   gets recomputed to 0.4, which is what the algorithm has always said
 *   such a page is worth). The drop is *not* a regression caused by the
 *   fix; it's the recompute correcting a stale or aspirational metadata
 *   value. Recording both `quality_score` (recomputed) and `prev_quality`
 *   (read from frontmatter) in the events.jsonl entry, as the /doc-wiki:fix
 *   skill does, is the documented way to expose the delta. Reviewers can
 *   then decide whether to add words, tags, or links — the things the
 *   scorer actually rewards — to bring the score up.
 *
 *   Do NOT add a "this update was an edit, not a rewrite" bonus here. That
 *   would let any /doc-wiki:fix call inflate quality without changing the page
 *   in a way readers care about, and would couple this scorer to the
 *   skill that invokes it (currently a clean separation: scorer is pure,
 *   skill is procedural).
 */
export function scorePage(
  pagePath: string,
  edgesPath: string | null = null,
): PageScore {
  const content = fs.readFileSync(pagePath, { encoding: "utf-8" });
  const [fm, body] = parseFrontmatterWithBody(content);
  const signals: Signal[] = [];

  // ── Word count base score ───────────────────────────────────
  const wc = wordCount(body);
  let base: number;
  if (wc < 50) base = 0.1;
  else if (wc < 150) base = 0.3;
  else if (wc < 500) base = 0.6;
  else base = 0.8;
  signals.push({ signal: "word_count", delta: base });

  // ── Frontmatter completeness ────────────────────────────────
  const presentFields = new Set(
    Object.keys(fm).filter((k) => REQUIRED_FIELDS.has(k)),
  );
  let allRequired = true;
  for (const r of REQUIRED_FIELDS) {
    if (!presentFields.has(r)) {
      allRequired = false;
      break;
    }
  }
  if (allRequired) {
    signals.push({ signal: "complete_frontmatter", delta: 0.1 });
  }

  // ── Missing title penalty ───────────────────────────────────
  if (!("title" in fm)) {
    signals.push({ signal: "missing_title", delta: -0.3 });
  }

  // ── No sources penalty (Python: `if not sources`) ───────────
  // Matches None, [], missing, and empty string.
  const sources = fm["sources"];
  const sourcesTruthy =
    sources !== undefined &&
    sources !== null &&
    !(Array.isArray(sources) && sources.length === 0) &&
    !(typeof sources === "string" && sources === "") &&
    sources !== 0 &&
    sources !== false;
  if (!sourcesTruthy) {
    signals.push({ signal: "no_sources", delta: -0.2 });
  }

  // ── No summary penalty ──────────────────────────────────────
  if (!("summary" in fm)) {
    signals.push({ signal: "no_summary", delta: -0.1 });
  }

  // ── Cross-reference links bonus ─────────────────────────────
  const links = findCrossrefLinks(body);
  if (links.length >= 3) {
    signals.push({ signal: "crossref_links", delta: 0.1 });
  }

  // ── Concept tags bonus ──────────────────────────────────────
  const tagsVal = fm["tags"];
  if (Array.isArray(tagsVal) && tagsVal.length >= 4) {
    signals.push({ signal: "concept_tags", delta: 0.05 });
  }

  // ── Claim-specific signals ──────────────────────────────────
  const pageType = typeof fm["type"] === "string" ? fm["type"] : "";
  if (pageType === "claim") {
    const evidence = fm["evidence"];
    if (Array.isArray(evidence) && evidence.length > 0) {
      signals.push({ signal: "claim_has_evidence", delta: 0.1 });
    }

    const status = typeof fm["status"] === "string" ? fm["status"] : "";
    if (status === "deprecated") {
      const failureReason =
        typeof fm["failure_reason"] === "string" ? fm["failure_reason"] : "";
      if (!failureReason) {
        signals.push({ signal: "deprecated_no_reason", delta: -0.2 });
      }
    }
  }

  // ── Structural signals (from edges.jsonl) ───────────────────
  if (edgesPath !== null && edgesPath !== "") {
    const degrees = computeDegrees(edgesPath);
    // Normalize page path for matching
    const pageName = pagePath;
    // Try to find a matching key in degrees; Python uses
    // `page_name.endswith(key) or key.endswith(Path(page_name).name)`.
    const basename = path.basename(pageName);
    let pageDegree = 0;
    for (const key of Object.keys(degrees)) {
      if (pageName.endsWith(key) || key.endsWith(basename)) {
        pageDegree = degrees[key] ?? 0;
        break;
      }
    }

    const keys = Object.keys(degrees);
    if (keys.length > 0) {
      // God-node: top 10% by degree
      const allDegrees = keys
        .map((k) => degrees[k] ?? 0)
        .sort((a, b) => b - a);
      const idx = thresholdIndex(allDegrees.length);
      const threshold = allDegrees.length > 0 ? (allDegrees[idx - 1] ?? 0) : 0;
      if (pageDegree >= threshold && pageDegree > 1) {
        signals.push({ signal: "god_node", delta: 0.1 });
      }

      // Isolated node: degree <= 1
      if (pageDegree <= 1) {
        signals.push({ signal: "isolated_node", delta: -0.2 });
      }
    }
  }

  // ── Mermaid diagram signals ─────────────────────────────────
  const hasMermaid = _MERMAID_RE.test(body);
  if (hasMermaid) {
    signals.push({ signal: "has_mermaid", delta: 0.05 });
  } else {
    // Penalty only for pages that should have diagrams
    const tagsLower = new Set<string>();
    if (Array.isArray(tagsVal)) {
      for (const t of tagsVal) {
        if (typeof t === "string") tagsLower.add(t.toLowerCase());
      }
    }
    let anyExpected = false;
    for (const t of tagsLower) {
      if (MERMAID_EXPECTED_TAGS.has(t)) {
        anyExpected = true;
        break;
      }
    }
    if (anyExpected) {
      signals.push({ signal: "missing_mermaid", delta: -0.1 });
    }
  }

  // ── Compute final score ─────────────────────────────────────
  let total = 0;
  for (const s of signals) total += s.delta;
  // Python: max(0.0, min(1.0, total))
  const clamped = Math.max(0, Math.min(1, total));
  // Python: round(quality, 4). JS: round to 4 decimal places using the same
  // banker's-rounding approximation (half to even) only matters for ties; our
  // signal deltas don't produce .5e-4 ties in practice.
  const quality = Math.round(clamped * 10000) / 10000;

  return { quality: quality, signals };
}

/** Shape returned by scoreWiki() for each page. */
export interface WikiScore {
  page: string;
  quality: number;
  signals: Signal[];
}

/**
 * Score every `.md` page under `<wikiRoot>/wiki/`.
 *
 * Returns a list sorted by quality descending. Each entry has page (relative
 * to wiki root), quality, and signals array. If
 * `edges.jsonl` exists under `<wikiRoot>/graph/`, structural signals are
 * included.
 */
export function scoreWiki(wikiRoot: string): WikiScore[] {
  const wikiDir = path.join(wikiRoot, "wiki");
  const edgesPath = path.join(wikiRoot, "graph", "edges.jsonl");
  const ep = fs.existsSync(edgesPath) ? edgesPath : null;

  const results: WikiScore[] = [];
  if (!fs.existsSync(wikiDir)) {
    return results;
  }

  for (const page of wikiPages(wikiRoot)) {
    const result = scorePage(page, ep);
    const relPath = path.relative(wikiRoot, page);
    results.push({
      page: relPath,
      quality: result.quality,
      signals: result.signals,
    });
  }

  // Stable sort by quality descending (V8 Array.sort is stable).
  results.sort((a, b) => b.quality - a.quality);
  return results;
}

// ── CLI ─────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--page": "page",
  "--edges": "edges",
  "--wiki-root": "wikiRoot",
} as const;

const HELP_TEXT = `usage: quality_score.js [-h] [--page PAGE] [--edges EDGES] [--wiki-root WIKI_ROOT]

Wiki page quality scorer.

options:
  -h, --help            show this help message and exit
  --page PAGE           Score a single page
  --edges EDGES         Path to edges.jsonl
  --wiki-root WIKI_ROOT Score all pages in wiki/
`;

export function main(
  argv: readonly string[] = process.argv.slice(2),
): number {
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

  const wikiRootVal = parsed.values["wikiRoot"];
  const pageVal = parsed.values["page"];
  const edgesVal = parsed.values["edges"];

  const wikiRoot =
    typeof wikiRootVal === "string" && wikiRootVal ? wikiRootVal : null;
  const page = typeof pageVal === "string" && pageVal ? pageVal : null;
  const edges = typeof edgesVal === "string" && edgesVal ? edgesVal : null;

  if (wikiRoot !== null) {
    const results = scoreWiki(wikiRoot);
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return 0;
  }
  if (page !== null) {
    const result = scorePage(page, edges);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(HELP_TEXT);
  return 0;
}

// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
