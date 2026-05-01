#!/usr/bin/env node
/**
 * Validation cache + structural checks for `/doc-wiki:atlas` Phase 5.
 *
 * Three layers:
 *
 *  1. **Structural** — wraps `lint_checks.ts` so the orchestrator can spot-check
 *     a single atlas page and get a categorized list of findings.
 *  2. **Semantic cache** — stores `{ page-hash, source-hash } → result` records
 *     under `.wiki-cache/atlas-validate/`. The actual semantic LLM call lives
 *     in the SKILL.md orchestrator; this module owns persistence + lookup so
 *     unchanged page/source pairs cost zero on re-runs.
 *  3. **Combined-hash key** — `sha256(pageHash + ":" + sourceHash)` keeps the
 *     filename short and avoids ordering ambiguity between the two halves.
 *
 * Usage as a library:
 *     import { checkValidationCache, storeValidationCache } from "./atlas_validate.js";
 *     const hit = checkValidationCache(wikiRoot, pageHash, sourceHash);
 *
 * Usage as a script:
 *     node atlas_validate.js cache-check --wiki-root <p> --page-hash <h> --source-hash <h>
 *     node atlas_validate.js cache-store --wiki-root <p> --page-hash <h> --source-hash <h> --result '<json>'
 *     node atlas_validate.js cache-clear --wiki-root <p>
 *     node atlas_validate.js structural --wiki-root <p> --page <relpath>
 */
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFlags } from "./_cli_args.js";
import { parseFrontmatter } from "./_frontmatter.js";

// ── Constants ──────────────────────────────────────────────────────

export const VALIDATE_CACHE_SUBDIR = path.join(".wiki-cache", "atlas-validate");

/** Bumped when on-disk format changes; forces auto-invalidation. */
export const VALIDATE_CACHE_VERSION = "1";

// ── Types ──────────────────────────────────────────────────────────

export interface CachedValidation {
  pageHash: string;
  sourceHash: string;
  /** Free-form LLM result from the orchestrator (kept opaque on purpose). */
  result: unknown;
  /** ISO-8601 UTC timestamp of when the entry was stored. */
  timestamp: string;
  /** Cache-format version; entries with mismatching versions miss. */
  cache_version: string;
}

export interface StructuralFinding {
  category: string;
  message: string;
}

// ── Hash key ───────────────────────────────────────────────────────

/**
 * Combined cache key: `sha256(pageHash + ":" + sourceHash)`. The colon
 * delimiter prevents `("ab", "cd")` and `("a", "bcd")` from colliding.
 */
export function computeValidationKey(pageHash: string, sourceHash: string): string {
  return crypto
    .createHash("sha256")
    .update(`${pageHash}:${sourceHash}`, "utf8")
    .digest("hex");
}

// ── Path helpers ───────────────────────────────────────────────────

function _cacheDir(wikiRoot: string): string {
  return path.join(wikiRoot, VALIDATE_CACHE_SUBDIR);
}

function _entryPath(wikiRoot: string, key: string): string {
  return path.join(_cacheDir(wikiRoot), `${key}.json`);
}

// ── Cache CRUD ─────────────────────────────────────────────────────

/**
 * Look up a cached semantic-validation result. Returns `null` on miss,
 * malformed entry, or version mismatch.
 */
export function checkValidationCache(
  wikiRoot: string,
  pageHash: string,
  sourceHash: string,
): CachedValidation | null {
  const key = computeValidationKey(pageHash, sourceHash);
  const file = _entryPath(wikiRoot, key);
  if (!fs.existsSync(file)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (rec["cache_version"] !== VALIDATE_CACHE_VERSION) return null;
  if (rec["pageHash"] !== pageHash || rec["sourceHash"] !== sourceHash) {
    // Hash collision shouldn't be possible with SHA-256, but defend anyway.
    return null;
  }
  return {
    pageHash,
    sourceHash,
    result: rec["result"],
    timestamp: typeof rec["timestamp"] === "string" ? rec["timestamp"] : "",
    cache_version: VALIDATE_CACHE_VERSION,
  };
}

/**
 * Persist a semantic-validation result. Creates the cache directory if
 * absent. Overwrites any existing entry with the same key.
 */
export function storeValidationCache(
  wikiRoot: string,
  pageHash: string,
  sourceHash: string,
  result: unknown,
): void {
  const key = computeValidationKey(pageHash, sourceHash);
  const dir = _cacheDir(wikiRoot);
  fs.mkdirSync(dir, { recursive: true });
  const entry: CachedValidation = {
    pageHash,
    sourceHash,
    result,
    timestamp: new Date().toISOString(),
    cache_version: VALIDATE_CACHE_VERSION,
  };
  fs.writeFileSync(_entryPath(wikiRoot, key), JSON.stringify(entry));
}

/**
 * Remove every `.json` entry under the validate subdir. Returns the count
 * removed. Does NOT touch the parent `.wiki-cache/` (that's the
 * `cache_manager.ts` cache).
 */
export function clearValidationCache(wikiRoot: string): number {
  const dir = _cacheDir(wikiRoot);
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".json")) {
      try {
        fs.unlinkSync(path.join(dir, name));
        count++;
      } catch {
        // best-effort
      }
    }
  }
  return count;
}

// ── Structural check ───────────────────────────────────────────────

/**
 * Spot-check a single page by invoking `lint_checks.js` with `--page-only`
 * filtering, parsing the JSON output, and returning a categorized findings
 * list. The orchestrator uses this for Phase 5 sub-check 1 to avoid
 * re-implementing the structural rules.
 *
 * Returns an empty array when the page is clean. Returns a non-empty array
 * with at least one finding when issues are present. Throws if `lint_checks`
 * is missing or returns malformed output.
 */
export function validateStructural(
  wikiRoot: string,
  pageRelPath: string,
): StructuralFinding[] {
  const scriptPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "lint_checks.js",
  );
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`lint_checks.js not found at ${scriptPath}`);
  }
  let raw: string;
  try {
    raw = execFileSync(
      "node",
      [scriptPath, "--wiki-root", wikiRoot, "--page", pageRelPath, "--json"],
      { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (e) {
    // lint_checks may exit non-zero when findings exist. Recover stdout from
    // the spawn error if present (Node attaches it as `e.stdout`).
    const errAny = e as { stdout?: Buffer | string };
    if (typeof errAny.stdout === "string") raw = errAny.stdout;
    else if (errAny.stdout instanceof Buffer) raw = errAny.stdout.toString("utf-8");
    else throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const rec = parsed as Record<string, unknown>;
  const findings = rec["findings"];
  if (!Array.isArray(findings)) return [];
  const out: StructuralFinding[] = [];
  for (const f of findings) {
    if (f && typeof f === "object" && !Array.isArray(f)) {
      const r = f as Record<string, unknown>;
      out.push({
        category: typeof r["category"] === "string" ? r["category"] : "unknown",
        message: typeof r["message"] === "string" ? r["message"] : "",
      });
    }
  }
  return out;
}

// ── Cross-doc ownership ────────────────────────────────────────────

/**
 * Title of a Mermaid block on an atlas page. Extracted from the
 * `<!-- wiki-mermaid: <title> start -->` marker that `mermaid_inject.ts`
 * wraps every spliced diagram in. The trailing ` start` token is stripped.
 */
const _MERMAID_TITLE_RE = /<!--\s*wiki-mermaid:\s*(.*?)\s+start\s*-->/g;

/** Pair of atlas pages flagged as covering overlapping ground. */
export interface DuplicateDiagramFinding {
  /** Wiki-relative paths of the two pages, sorted lexicographically. */
  pages: [string, string];
  /** Source paths both pages declare in their `sources:` frontmatter. */
  sharedSources: string[];
  /** Mermaid block titles present on both pages (case-insensitive match). */
  sharedDiagramTitles: string[];
}

interface _ArchPageScan {
  page: string;
  sources: Set<string>;
  diagramTitles: Set<string>;
}

function _scanArchPages(wikiRoot: string): _ArchPageScan[] {
  const wikiContent = path.join(wikiRoot, "wiki");
  if (!fs.existsSync(wikiContent)) return [];
  const out: _ArchPageScan[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile() || !full.endsWith(".md")) continue;
      let body: string;
      try {
        body = fs.readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const { frontmatter, body: pageBody } = parseFrontmatter(body);
      if (!frontmatter) continue;
      if (frontmatter["atlas_facet"] !== "architecture") continue;
      const sources = new Set<string>();
      const sourcesRaw = frontmatter["sources"];
      if (Array.isArray(sourcesRaw)) {
        for (const s of sourcesRaw) {
          if (typeof s === "string" && s.length > 0) sources.add(s);
        }
      }
      const diagramTitles = new Set<string>();
      _MERMAID_TITLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = _MERMAID_TITLE_RE.exec(pageBody)) !== null) {
        const title = (m[1] ?? "").trim().toLowerCase();
        if (title.length > 0) diagramTitles.add(title);
      }
      out.push({
        page: path.relative(wikiRoot, full).split(path.sep).join("/"),
        sources,
        diagramTitles,
      });
    }
  };
  walk(wikiContent);
  out.sort((a, b) => a.page.localeCompare(b.page));
  return out;
}

/**
 * Find pairs of architecture-facet atlas pages that likely duplicate each
 * other's coverage. The heuristic: two pages are flagged when they share
 * at least one source path AND at least one Mermaid diagram title. Either
 * signal alone is too noisy (shared-source happens for thin slices that
 * legitimately overlap; same-title happens for boilerplate "Service
 * Topology" labels). Both together is a strong signal one page should
 * own the topic and the other should `[link](../path/to/owner.md)`.
 *
 * Mirrors the "Cross-doc concerns" registry pattern from `docs/README.md`.
 */
export function findDuplicateDiagrams(wikiRoot: string): DuplicateDiagramFinding[] {
  const arch = _scanArchPages(wikiRoot);
  const findings: DuplicateDiagramFinding[] = [];
  for (let i = 0; i < arch.length; i++) {
    const a = arch[i];
    if (!a) continue;
    for (let j = i + 1; j < arch.length; j++) {
      const b = arch[j];
      if (!b) continue;
      const sharedSources: string[] = [];
      for (const s of a.sources) if (b.sources.has(s)) sharedSources.push(s);
      const sharedTitles: string[] = [];
      for (const t of a.diagramTitles) if (b.diagramTitles.has(t)) sharedTitles.push(t);
      if (sharedSources.length === 0 || sharedTitles.length === 0) continue;
      sharedSources.sort();
      sharedTitles.sort();
      findings.push({
        pages: [a.page, b.page],
        sharedSources,
        sharedDiagramTitles: sharedTitles,
      });
    }
  }
  return findings;
}

// ── CLI ────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--page-hash": "pageHash",
  "--source-hash": "sourceHash",
  "--result": "result",
  "--page": "page",
} as const;

const HELP_TEXT = `usage: atlas_validate.js {cache-check,cache-store,cache-clear,structural,cross-doc} [...]

Validation cache and structural checks for /doc-wiki:atlas Phase 5.

Subcommands:
  cache-check    --wiki-root <p> --page-hash <h> --source-hash <h>
                 Lookup a cached validation result. Stdout: {hit, entry?}.
  cache-store    --wiki-root <p> --page-hash <h> --source-hash <h> --result '<json>'
                 Persist an LLM-derived validation result.
  cache-clear    --wiki-root <p>
                 Remove every cached validation entry. Stdout: {removed: N}.
  structural     --wiki-root <p> --page <relpath>
                 Run lint_checks on one page. Stdout: {findings: [...]}.
  cross-doc      --wiki-root <p>
                 Find architecture pages with overlapping diagrams + sources.
                 Stdout: {findings: [{pages, sharedSources, sharedDiagramTitles}]}.
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const sub = argv[0];
  let parsed;
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
  if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
    process.stderr.write("--wiki-root is required\n");
    return 2;
  }

  if (sub === "cache-check") {
    const pageHash = parsed.values["pageHash"];
    const sourceHash = parsed.values["sourceHash"];
    if (typeof pageHash !== "string" || typeof sourceHash !== "string") {
      process.stderr.write("--page-hash and --source-hash are required\n");
      return 2;
    }
    const hit = checkValidationCache(wikiRoot, pageHash, sourceHash);
    process.stdout.write(
      JSON.stringify(hit === null ? { hit: false } : { hit: true, entry: hit }) + "\n",
    );
    return 0;
  }

  if (sub === "cache-store") {
    const pageHash = parsed.values["pageHash"];
    const sourceHash = parsed.values["sourceHash"];
    const resultRaw = parsed.values["result"];
    if (
      typeof pageHash !== "string" ||
      typeof sourceHash !== "string" ||
      typeof resultRaw !== "string"
    ) {
      process.stderr.write("--page-hash, --source-hash, and --result are required\n");
      return 2;
    }
    let result: unknown;
    try {
      result = JSON.parse(resultRaw);
    } catch {
      // Allow non-JSON --result strings; store the raw text.
      result = resultRaw;
    }
    storeValidationCache(wikiRoot, pageHash, sourceHash, result);
    process.stdout.write(JSON.stringify({ stored: true }) + "\n");
    return 0;
  }

  if (sub === "cache-clear") {
    const removed = clearValidationCache(wikiRoot);
    process.stdout.write(JSON.stringify({ removed }) + "\n");
    return 0;
  }

  if (sub === "structural") {
    const page = parsed.values["page"];
    if (typeof page !== "string" || page.length === 0) {
      process.stderr.write("--page is required\n");
      return 2;
    }
    let findings: StructuralFinding[];
    try {
      findings = validateStructural(wikiRoot, page);
    } catch (e) {
      process.stderr.write(`structural check failed: ${(e as Error).message}\n`);
      return 1;
    }
    process.stdout.write(JSON.stringify({ findings }) + "\n");
    return 0;
  }

  if (sub === "cross-doc") {
    const findings = findDuplicateDiagrams(wikiRoot);
    process.stdout.write(JSON.stringify({ findings }) + "\n");
    return 0;
  }

  process.stderr.write(`unknown subcommand: ${sub}\n`);
  return 2;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
