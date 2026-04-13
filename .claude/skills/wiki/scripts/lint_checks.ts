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
import { clusters, isolatedNodes, listEdges } from "./graph_ops.js";
import { lintPage as lintMermaidPage } from "./mermaid_lint.js";
import { parseFlags } from "./_cli_args.js";
import { parseFrontmatter as parseFrontmatterRaw } from "./_frontmatter.js";
import { wikiPages } from "./_wiki_fs.js";
import {
  loadAllProfiles,
  detectOrm,
  type OrmProfile,
} from "../../../agents/lib/wiki_orm/index.js";

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

/** Python: `re.compile(r"\[.*?\]\(([^)]+)\)")` */
const _LINK_RE = /\[.*?\]\(([^)]+)\)/g;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Thin adapter: lint only needs the frontmatter dict (not the body), and
 * collapses the `null`/missing case to `{}` to match the original Python
 * `_parse_frontmatter` return shape (`dict[str, Any]`, never None).
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  return parseFrontmatterRaw(content).frontmatter ?? {};
}

/** Shape of a single lint issue, matching the Python dict. */
export interface Issue {
  severity: string;
  category: string;
  page: string;
  detail: string;
}

function makeIssue(
  severity: string,
  category: string,
  page: string,
  detail: string,
): Issue {
  return { severity, category, page, detail };
}

/** Extract capture group 1 from every markdown link in `content`. */
function findLinks(content: string): string[] {
  const out: string[] = [];
  _LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
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
export function checkBrokenLinks(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
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
        issues.push(
          makeIssue("error", "broken_links", page, `Link to ${link} not found`),
        );
      }
    }
  }
  return issues;
}

/** Check all wiki pages for missing required frontmatter fields. */
export function checkFrontmatter(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  for (const page of wikiPages(wikiRoot)) {
    const content = fs.readFileSync(page, { encoding: "utf-8" });
    const fm = parseFrontmatter(content);
    if (Object.keys(fm).length === 0) {
      issues.push(
        makeIssue(
          "error",
          "missing_frontmatter",
          page,
          "No frontmatter found (missing --- delimiters)",
        ),
      );
      continue;
    }
    const present = new Set(Object.keys(fm));
    const missing: string[] = [];
    for (const field of REQUIRED_FIELDS) {
      if (!present.has(field)) {
        missing.push(field);
      }
    }
    missing.sort();
    for (const field of missing) {
      issues.push(
        makeIssue(
          "error",
          "missing_frontmatter",
          page,
          `Missing required frontmatter field: ${field}`,
        ),
      );
    }
  }
  return issues;
}

/** Find pages not linked from any other page. */
export function checkOrphans(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  const allPages = wikiPages(wikiRoot);

  // Build set of all linked-to filenames
  const linked = new Set<string>();
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
      issues.push(
        makeIssue(
          "warning",
          "orphan_page",
          page,
          "Page is not linked from any other page",
        ),
      );
    }
  }
  return issues;
}

/** Find pages with degree <= 1 in the knowledge graph. */
export function checkIsolatedNodes(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  const edgesPath = path.join(wikiRoot, "graph", "edges.jsonl");

  const allPages = wikiPages(wikiRoot);
  // Use relative paths matching edge format
  const pageRelPaths = allPages.map((p) => path.relative(wikiRoot, p));

  const isolated = isolatedNodes(edgesPath, pageRelPaths);
  for (const node of isolated) {
    issues.push(
      makeIssue(
        "warning",
        "isolated_node",
        node,
        "Node has degree <= 1 in the knowledge graph",
      ),
    );
  }
  return issues;
}

/** Check code references for content_hash mismatches. */
export function checkCodeRefDrift(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  for (const page of wikiPages(wikiRoot)) {
    const content = fs.readFileSync(page, { encoding: "utf-8" });
    const fm = parseFrontmatter(content);
    const refs = fm["references"];
    if (!Array.isArray(refs)) {
      continue;
    }

    for (const refEntry of refs) {
      if (
        refEntry === null ||
        typeof refEntry !== "object" ||
        Array.isArray(refEntry)
      ) {
        continue;
      }
      const ref = refEntry as Record<string, unknown>;
      const refPathVal = ref["path"];
      const storedHashVal = ref["content_hash"];
      const refPath = typeof refPathVal === "string" ? refPathVal : "";
      const storedHash =
        typeof storedHashVal === "string" ? storedHashVal : "";
      if (!refPath || !storedHash) {
        continue;
      }

      const target = path.join(wikiRoot, refPath);
      if (!fs.existsSync(target)) {
        issues.push(
          makeIssue(
            "warning",
            "code_ref_drift",
            page,
            `Referenced file ${refPath} not found`,
          ),
        );
        continue;
      }

      const actualHash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(target))
        .digest("hex");
      if (actualHash !== storedHash) {
        issues.push(
          makeIssue(
            "warning",
            "code_ref_drift",
            page,
            `content_hash mismatch for ${refPath}`,
          ),
        );
      }
    }
  }
  return issues;
}

/** Check that every edge in edges.jsonl has a provenance field. */
export function checkProvenanceCompleteness(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  const edgesPath = path.join(wikiRoot, "graph", "edges.jsonl");
  const edges = listEdges(edgesPath);

  edges.forEach((edge, i) => {
    if (!("provenance" in edge)) {
      const fromVal = edge["from"];
      const toVal = edge["to"];
      const fromStr = typeof fromVal === "string" ? fromVal : "?";
      const toStr = typeof toVal === "string" ? toVal : "?";
      issues.push(
        makeIssue(
          "error",
          "missing_provenance",
          `edge #${i + 1}: ${fromStr} -> ${toStr}`,
          "Edge is missing required 'provenance' field",
        ),
      );
    }
  });
  return issues;
}

/** Warn if > 20% of edges have AMBIGUOUS provenance. */
export function checkHighAmbiguityRate(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
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
    issues.push(
      makeIssue(
        "warning",
        "high_ambiguity_rate",
        "graph/edges.jsonl",
        `Ambiguity rate is ${pct}% (${ambiguousCount}/${edges.length} edges are AMBIGUOUS)`,
      ),
    );
  }
  return issues;
}

/**
 * Render `rate` as an integer percentage using Python's "round half to even"
 * rule (matching `format(rate, ".0%")`). Values like 0.75 -> 75, 0.2 -> 20.
 */
function pyRoundPercent(rate: number): number {
  const scaled = rate * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // Exactly .5 — banker's rounding: nearest even.
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Run mermaid_lint's per-page validator across the wiki and return lint issues. */
export function checkMermaidSyntax(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  for (const page of wikiPages(wikiRoot)) {
    const results = lintMermaidPage(page);
    for (const mi of results) {
      for (const err of mi.errors) {
        issues.push(
          makeIssue(
            "warning",
            "mermaid_syntax",
            page,
            `line ${mi.line}: ${err}`,
          ),
        );
      }
    }
  }
  return issues;
}

/** Never-treat-as-regular-page names, matching checkOrphans. */
const _NEVER_INDEXED: ReadonlySet<string> = new Set([
  "index.md",
  "summaries.md",
  "overview.md",
]);

/**
 * Every `.md` under `wiki/` (except the three scaffolding pages) must appear
 * as a markdown link target in `wiki/index.md`. Missing entries are errors.
 */
export function checkIndexCoverage(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  const indexPath = path.join(wikiRoot, "wiki", "index.md");
  if (!fs.existsSync(indexPath)) {
    return issues;
  }
  const indexContent = fs.readFileSync(indexPath, { encoding: "utf-8" });
  const linked = new Set<string>();
  for (const link of findLinks(indexContent)) {
    if (link.startsWith("http") || link.startsWith("#") || !link.endsWith(".md")) {
      continue;
    }
    // Normalize to path relative to wiki/ so we can compare with rel paths.
    const resolved = path.resolve(path.dirname(indexPath), link);
    linked.add(resolved);
  }

  const wikiDir = path.join(wikiRoot, "wiki");
  for (const page of wikiPages(wikiRoot)) {
    const base = path.basename(page);
    if (_NEVER_INDEXED.has(base)) {
      continue;
    }
    if (!linked.has(page)) {
      const rel = path.relative(wikiDir, page);
      issues.push(
        makeIssue(
          "error",
          "index_coverage",
          page,
          `Page '${rel}' is not linked from wiki/index.md`,
        ),
      );
    }
  }
  return issues;
}

/**
 * Parse `wiki/summaries.md` for entries shaped like:
 *   - [title](rel/path.md) `hash`: summary...
 * Returns a map of absolute page path -> stored hash.
 */
function parseSummariesIndex(
  wikiRoot: string,
): { entries: Map<string, string>; path: string; exists: boolean } {
  const summariesPath = path.join(wikiRoot, "wiki", "summaries.md");
  const entries = new Map<string, string>();
  if (!fs.existsSync(summariesPath)) {
    return { entries, path: summariesPath, exists: false };
  }
  const content = fs.readFileSync(summariesPath, { encoding: "utf-8" });
  // Each entry line pairs a markdown link with a hash in backticks. Hash
  // format is permissive — any non-whitespace, non-backtick run — so tests
  // and real summaries may use full sha256 hex, short hashes, or placeholders.
  const entryRe = /\[[^\]]*\]\(([^)]+\.md)\)\s*`([^`\s]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(content)) !== null) {
    const rel = m[1];
    const hash = m[2];
    if (!rel || !hash) continue;
    const abs = path.resolve(path.dirname(summariesPath), rel);
    entries.set(abs, hash);
  }
  return { entries, path: summariesPath, exists: true };
}

/**
 * Every wiki page must have a summaries.md entry whose stored hash matches
 * the page's frontmatter `summary_hash`. Missing entries or mismatches are
 * errors; pages without a `summary_hash` field in frontmatter are skipped.
 */
export function checkSummariesSync(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  const { entries, path: summariesPath, exists } = parseSummariesIndex(wikiRoot);
  if (!exists) {
    return issues;
  }
  for (const page of wikiPages(wikiRoot)) {
    const base = path.basename(page);
    if (_NEVER_INDEXED.has(base)) {
      continue;
    }
    const content = fs.readFileSync(page, { encoding: "utf-8" });
    const fm = parseFrontmatter(content);
    const hashVal = fm["summary_hash"];
    const pageHash = typeof hashVal === "string" ? hashVal : "";
    if (!pageHash) {
      continue;
    }
    const storedHash = entries.get(page);
    if (storedHash === undefined) {
      issues.push(
        makeIssue(
          "error",
          "summaries_sync",
          page,
          `Page is missing from ${path.relative(wikiRoot, summariesPath)}`,
        ),
      );
      continue;
    }
    if (storedHash !== pageHash) {
      issues.push(
        makeIssue(
          "warning",
          "summaries_sync",
          page,
          `summary_hash mismatch: page has ${pageHash}, summaries.md has ${storedHash}`,
        ),
      );
    }
  }
  return issues;
}

/**
 * Resolve the active ORM profile for `wikiRoot`. Order of preference:
 *   1. `ecosystem.orm.profile` name in wiki.config.yaml → matched by profile name.
 *   2. Substring-detection via `detectOrm` over a sample of project files.
 * Returns null when no profile can be resolved.
 */
function resolveActiveOrmProfile(wikiRoot: string): OrmProfile | null {
  const profiles = loadAllProfiles();
  if (profiles.length === 0) return null;

  const configPath = path.join(wikiRoot, "wiki.config.yaml");
  if (fs.existsSync(configPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(configPath, { encoding: "utf-8" }));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const cfg = parsed as Record<string, unknown>;
        const eco = cfg["ecosystem"];
        const ormSection =
          eco && typeof eco === "object" && !Array.isArray(eco)
            ? (eco as Record<string, unknown>)["orm"]
            : undefined;
        const profileName =
          ormSection &&
          typeof ormSection === "object" &&
          !Array.isArray(ormSection)
            ? (ormSection as Record<string, unknown>)["profile"]
            : undefined;
        if (typeof profileName === "string" && profileName) {
          const match = profiles.find((p) => p.name === profileName);
          if (match) return match;
        }
      }
    } catch {
      // Fall through to detection.
    }
  }

  // Sample up to a few representative files near the project root for
  // substring-based detection. `wikiRoot` may sit at a `wiki-root/` child so
  // also probe the parent directory.
  const probeRoots = [wikiRoot, path.dirname(wikiRoot)];
  const samples: Record<string, string> = {};
  for (const root of probeRoots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(root, entry.name);
      try {
        const stat = fs.statSync(full);
        if (stat.size > 65536) continue;
        samples[full] = fs.readFileSync(full, { encoding: "utf-8" });
      } catch {
        continue;
      }
      if (Object.keys(samples).length >= 30) break;
    }
    if (Object.keys(samples).length >= 30) break;
  }
  const detected = detectOrm(samples, profiles);
  return detected[0] ?? null;
}

/**
 * Walk `searchRoot` recursively and collect files whose basename matches any
 * of `filePatterns` (glob-style with `*` wildcard). Skips common vendor dirs.
 */
function findOrmSourceFiles(
  searchRoot: string,
  filePatterns: readonly string[],
): string[] {
  if (!fs.existsSync(searchRoot)) return [];
  const out: string[] = [];
  const skip = new Set([
    "node_modules",
    ".git",
    "wiki-root",
    "wiki",
    "raw",
    "graph",
    ".wiki-cache",
    "log",
    "outputs",
    "dist",
    "build",
    "__pycache__",
  ]);
  const regexes = filePatterns.map((p) => globToRegex(p));
  const stack: string[] = [searchRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        stack.push(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (regexes.some((re) => re.test(entry.name))) {
          out.push(path.join(dir, entry.name));
        }
      }
    }
  }
  return out;
}

/**
 * Convert a simple glob (`**`, `*`, `?`, literal chars) to a regex anchored
 * at both ends and applied to a basename. Leading `**\/` and path segments
 * are stripped so `**\/*.py` reduces to `*.py`.
 */
function globToRegex(glob: string): RegExp {
  const base = glob.split("/").pop() ?? glob;
  let body = "";
  for (const ch of base) {
    if (ch === "*") body += ".*";
    else if (ch === "?") body += ".";
    else body += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + body + "$");
}

/**
 * If `wiki/database-mapping.md` exists, compare its frontmatter `generated_at`
 * against the newest mtime of any ORM source file. Newer source → warning.
 */
export function checkOrmMappingFreshness(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  const mappingPath = path.join(wikiRoot, "wiki", "database-mapping.md");
  if (!fs.existsSync(mappingPath)) {
    return issues;
  }
  const content = fs.readFileSync(mappingPath, { encoding: "utf-8" });
  const fm = parseFrontmatter(content);
  const generatedAtVal = fm["generated_at"];
  if (typeof generatedAtVal !== "string" || !generatedAtVal) {
    issues.push(
      makeIssue(
        "warning",
        "orm_mapping_freshness",
        mappingPath,
        "database-mapping.md is missing frontmatter 'generated_at' field",
      ),
    );
    return issues;
  }
  const generatedMs = Date.parse(generatedAtVal);
  if (Number.isNaN(generatedMs)) {
    issues.push(
      makeIssue(
        "warning",
        "orm_mapping_freshness",
        mappingPath,
        `Cannot parse 'generated_at' timestamp: ${generatedAtVal}`,
      ),
    );
    return issues;
  }

  const profile = resolveActiveOrmProfile(wikiRoot);
  if (profile === null || profile.file_patterns.length === 0) {
    return issues;
  }

  // Search both the wiki root and its parent — a project repo typically hosts
  // the wiki as a subdirectory, so ORM sources usually live one level up.
  // Take the max mtime across the UNION of both roots: a stray file inside
  // the wiki root must not shadow the real project sources one level up.
  const searchRoots = [wikiRoot, path.dirname(wikiRoot)];
  const seen = new Set<string>();
  let newestMs = 0;
  let newestFile = "";
  for (const root of searchRoots) {
    for (const f of findOrmSourceFiles(root, profile.file_patterns)) {
      if (seen.has(f)) continue;
      seen.add(f);
      try {
        const stat = fs.statSync(f);
        const mtime = stat.mtimeMs;
        if (mtime > newestMs) {
          newestMs = mtime;
          newestFile = f;
        }
      } catch {
        continue;
      }
    }
  }

  if (newestMs > 0 && newestMs > generatedMs) {
    issues.push(
      makeIssue(
        "warning",
        "orm_mapping_freshness",
        mappingPath,
        `ORM source ${path.relative(wikiRoot, newestFile)} is newer than generated_at (${generatedAtVal})`,
      ),
    );
  }
  return issues;
}

/** Report graph clusters with fewer than 3 pages. */
export function checkThinClusters(wikiRoot: string): Issue[] {
  const issues: Issue[] = [];
  const edgesPath = path.join(wikiRoot, "graph", "edges.jsonl");
  if (!fs.existsSync(edgesPath)) {
    return issues;
  }
  const cs = clusters(edgesPath);
  cs.forEach((cluster, idx) => {
    if (cluster.length < 3) {
      issues.push(
        makeIssue(
          "warning",
          "thin_clusters",
          `cluster #${idx + 1}`,
          `Cluster has ${cluster.length} page(s) (min 3): ${cluster.join(", ")}`,
        ),
      );
    }
  });
  return issues;
}

// ── Main lint function ──────────────────────────────────────────────

/** Registry of check functions, matching the Python dict insertion order. */
const CHECK_FUNCTIONS: ReadonlyArray<
  [string, (wikiRoot: string) => Issue[]]
> = [
  ["broken_links", checkBrokenLinks],
  ["frontmatter", checkFrontmatter],
  ["orphans", checkOrphans],
  ["isolated_nodes", checkIsolatedNodes],
  ["code_ref_drift", checkCodeRefDrift],
  ["provenance", checkProvenanceCompleteness],
  ["ambiguity_rate", checkHighAmbiguityRate],
  ["mermaid_syntax", checkMermaidSyntax],
  ["index_coverage", checkIndexCoverage],
  ["summaries_sync", checkSummariesSync],
  ["orm_mapping_freshness", checkOrmMappingFreshness],
  ["thin_clusters", checkThinClusters],
];

const VALID_CATEGORIES: ReadonlySet<string> = new Set(
  CHECK_FUNCTIONS.map(([k]) => k),
);

export interface LintResult {
  issues: Issue[];
  summary: { error: number; warning: number; info: number };
}

/**
 * Run all lint checks (or a single category) and return results.
 */
export function lintWiki(
  wikiRoot: string,
  category: string | null = null,
): LintResult {
  let issues: Issue[] = [];
  if (category) {
    const found = CHECK_FUNCTIONS.find(([k]) => k === category);
    if (found) {
      issues = found[1](wikiRoot);
    }
  } else {
    for (const [, fn] of CHECK_FUNCTIONS) {
      issues.push(...fn(wikiRoot));
    }
  }

  const summary = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    const sev = issue.severity;
    if (sev === "error") summary.error += 1;
    else if (sev === "warning") summary.warning += 1;
    else if (sev === "info") summary.info += 1;
  }

  return { issues, summary };
}

// ── CLI ─────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--category": "category",
} as const;

const HELP_TEXT = `usage: lint_checks.js [-h] --wiki-root WIKI_ROOT [--category CATEGORY]

Wiki structural lint checks.

options:
  -h, --help            show this help message and exit
  --wiki-root WIKI_ROOT Wiki root path
  --category CATEGORY   Run only a specific check category
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

  const wikiRoot = parsed.values["wikiRoot"];
  if (typeof wikiRoot !== "string" || wikiRoot === "") {
    process.stderr.write("the following arguments are required: --wiki-root\n");
    return 2;
  }

  const categoryRaw = parsed.values["category"];
  const category =
    typeof categoryRaw === "string" && categoryRaw ? categoryRaw : null;
  if (category !== null && !VALID_CATEGORIES.has(category)) {
    const allowed = [...VALID_CATEGORIES].join(", ");
    process.stderr.write(
      `unrecognized --category '${category}'. Allowed: ${allowed}\n`,
    );
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
