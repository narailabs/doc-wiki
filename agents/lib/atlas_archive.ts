#!/usr/bin/env node
/**
 * atlas_archive.ts — sweep action for archiving deprecated atlas pages.
 *
 * Core operation: walk live wiki pages, identify atlas-tagged pages whose
 * source paths no longer exist on disk, and move them to wiki/_archive/.
 *
 * CLI:
 *   node atlas_archive.js sweep --wiki-root <p> --repo-root <p> --run-id <id>
 *                               [--autonomy conservative|balanced|autonomous|auto]
 *                               [--dry-run] [--threshold <n>]
 *   node atlas_archive.js unarchive --wiki-root <p> --page-or-slug <path-or-slug>
 *                                   [--target <rel-path>] [--inbound-links rewrite|drop|leave]
 *   node atlas_archive.js rebuild-index --wiki-root <p>  (Task 8 stub)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

import {
  walkLivePages,
  type WikiPage,
} from "../../skills/doc-wiki/scripts/_wiki_fs.js";
import { parseFrontmatter } from "../../skills/doc-wiki/scripts/_frontmatter.js";
import {
  sourceExistence,
  type SourceExistenceResult,
} from "../../skills/doc-wiki/scripts/atlas_validate.js";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { checkPathContainment } from "narai-primitives/toolkit";
import {
  parseConfig,
  ConfigFileNotFoundError,
  type ArchiveConfig,
} from "./parse_config.js";

// ── Public types ───────────────────────────────────────────────────────────────

export type Autonomy = "conservative" | "balanced" | "autonomous" | "auto";
export const AUTONOMY_MODES = [
  "conservative",
  "balanced",
  "autonomous",
  "auto",
] as const;

export const REWRITE_MODES = ["rewrite", "drop", "leave"] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];

export interface UnarchiveOptions {
  wikiRoot: string;
  pageOrSlug: string; // "wiki/_archive/billing/architecture.md" OR "architecture"
  target?: string; // override the archived_from value
  inboundLinks: RewriteMode;
}

export interface UnarchiveResult {
  from: string;
  to: string;
  linksReverted: number;
}

export interface UnarchiveEvent {
  ts: string;
  op: "unarchive";
  from: string; // wiki/_archive/<topic>/<page>.md
  to: string; // wiki/<topic>/<page>.md
}

export interface SweepOptions {
  wikiRoot: string;
  repoRoot: string;
  autonomy: Autonomy;
  runId: string;
  dryRun?: boolean;
  /** Fraction of missing sources to trigger archive. Default: 1.0 (all missing). */
  partialThreshold?: number;
  inboundLinks?: RewriteMode;
}

export interface ArchiveEvent {
  ts: string;
  op: "archive";
  atlas_run_id: string;
  from: string;
  to: string;
  reason: string;
  missing_sources: string[];
}

export interface CandidateReport {
  page: string;
  ratio: number;
  missing: string[];
}

export interface ErrorReport {
  page: string;
  error: string;
}

export interface PendingArchive {
  page: string;
  existence: SourceExistenceResult;
}

/** An archive candidate surfaced in conservative mode (report-only).
 *  The page was NOT moved; it is included here for visibility. */
export interface ReportedArchive {
  page: string;
  status: "orphan" | "candidate";
  reason: string;
  missing_sources: string[];
}

export interface SweepResult {
  archived: ArchiveEvent[];
  candidates: CandidateReport[];
  errors: ErrorReport[];
  pendingConfirmation: PendingArchive[];
  /** Populated in conservative mode: pages that would be archived/candidated
   *  if autonomy permitted. Empty in balanced/autonomous/auto modes. */
  reported: ReportedArchive[];
}

// ── Autonomy decision ──────────────────────────────────────────────────────────

type Decision = "auto" | "ask" | "report-only";

function decideAutonomy(autonomy: Autonomy, _kind: "orphan"): Decision {
  switch (autonomy) {
    case "conservative":
      return "report-only";
    case "balanced":
      return "ask";
    case "autonomous":
    case "auto":
      return "auto";
  }
}

// ── Atlas page filter ─────────────────────────────────────────────────────────

interface AtlasPage extends WikiPage {
  // narrowed: confirmed to have atlas_facet in frontmatter
}

function filterAtlasPages(pages: WikiPage[]): AtlasPage[] {
  const out: AtlasPage[] = [];
  for (const page of pages) {
    let raw: string;
    try {
      raw = fs.readFileSync(page.absPath, "utf-8");
    } catch {
      continue;
    }
    const { frontmatter } = parseFrontmatter(raw);
    if (
      frontmatter &&
      "atlas_facet" in frontmatter &&
      frontmatter["atlas_facet"] != null
    ) {
      out.push(page);
    }
  }
  return out;
}

// ── Archive path computation ───────────────────────────────────────────────────

/**
 * Map a live page relPath (e.g. "wiki/billing/architecture.md") to the
 * corresponding archive relPath ("wiki/_archive/billing/architecture.md").
 * Input must start with "wiki/".
 */
function toArchiveRelPath(relPath: string): string {
  if (!relPath.startsWith("wiki/")) {
    throw new Error(`unexpected relPath without wiki/ prefix: ${relPath}`);
  }
  return "wiki/_archive/" + relPath.slice("wiki/".length);
}

// ── Frontmatter stamping ───────────────────────────────────────────────────────

/** ISO-8601 date string YYYY-MM-DD from an ISO timestamp. */
function isoDate(isoTs: string): string {
  return isoTs.slice(0, 10);
}

/**
 * Read the file at `absPath`, inject archive frontmatter fields, write it
 * back in place. Returns the modified content.
 */
function stampFrontmatter(
  absPath: string,
  fields: {
    archived_from: string;
    archived_at: string;
    archive_reason: string;
  },
): void {
  const raw = fs.readFileSync(absPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const fm: Record<string, unknown> = frontmatter ? { ...frontmatter } : {};
  fm["status"] = "deprecated";
  fm["archived_from"] = fields.archived_from;
  fm["archived_at"] = fields.archived_at;
  fm["archive_reason"] = fields.archive_reason;
  const newContent = `---\n${yaml.dump(fm)}---\n${body}`;
  fs.writeFileSync(absPath, newContent, "utf-8");
}

// ── ArchiveEvent builder ───────────────────────────────────────────────────────

function buildEvent(
  page: WikiPage,
  existence: SourceExistenceResult,
  opts: SweepOptions,
  ts: string,
): ArchiveEvent {
  const archRelPath = toArchiveRelPath(page.relPath);
  const reason =
    existence.ratio === 1.0
      ? `all sources removed (${existence.missing.join(", ")})`
      : `${existence.missing.length} of ${existence.total} sources removed (${existence.missing.join(", ")})`;
  return {
    ts,
    op: "archive",
    atlas_run_id: opts.runId,
    from: page.relPath,
    to: archRelPath,
    reason,
    missing_sources: [...existence.missing],
  };
}

// ── applyArchive ───────────────────────────────────────────────────────────────

async function applyArchive(
  page: WikiPage,
  existence: SourceExistenceResult,
  opts: SweepOptions,
  ts: string,
): Promise<void> {
  const archRelPath = toArchiveRelPath(page.relPath);
  const archAbsPath = path.join(opts.wikiRoot, archRelPath);
  fs.mkdirSync(path.dirname(archAbsPath), { recursive: true });

  // Rename first — if this fails, the live file is untouched.
  // If stamp fails after rename, the file is at the archive path with original
  // frontmatter; the next sweep won't see it (outside walkLivePages).
  fs.renameSync(page.absPath, archAbsPath);
  const archiveReason =
    existence.ratio === 1.0
      ? `all sources removed (${existence.missing.join(", ")})`
      : `${existence.missing.length} of ${existence.total} sources removed (${existence.missing.join(", ")})`;
  stampFrontmatter(archAbsPath, {
    archived_from: page.relPath,
    archived_at: isoDate(ts),
    archive_reason: archiveReason,
  });
}

// ── History journal ────────────────────────────────────────────────────────────

async function appendHistory(
  wikiRoot: string,
  events: Array<ArchiveEvent | UnarchiveEvent>,
): Promise<void> {
  if (events.length === 0) return;
  const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(journalPath, lines, "utf-8");
}

// ── Archive index rebuild ─────────────────────────────────────────────────────

export async function rebuildArchiveIndex(wikiRoot: string): Promise<void> {
  const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
  let allEvents: Array<ArchiveEvent | UnarchiveEvent> = [];

  if (fs.existsSync(journalPath)) {
    const fileStr = fs.readFileSync(journalPath, "utf-8");
    let pos = 0;
    while (pos < fileStr.length) {
      const nextPos = fileStr.indexOf("\n", pos);
      const line =
        nextPos === -1
          ? fileStr.substring(pos)
          : fileStr.substring(pos, nextPos);
      pos = nextPos === -1 ? fileStr.length : nextPos + 1;
      if (!line) continue;
      try {
        allEvents.push(JSON.parse(line) as ArchiveEvent | UnarchiveEvent);
      } catch {
        // skip malformed lines
      }
    }
  }

  // Only keep archive events (op !== "unarchive") whose archived file still exists.
  const events: ArchiveEvent[] = allEvents.filter((e): e is ArchiveEvent => {
    if (e.op === "unarchive") return false;
    const archAbsPath = path.join(wikiRoot, e.to);
    return fs.existsSync(archAbsPath);
  });

  // Sort newest-first by ts
  events.sort((a, b) => (a.ts > b.ts ? -1 : a.ts < b.ts ? 1 : 0));

  // Group by YYYY-MM
  const groups = new Map<string, ArchiveEvent[]>();
  for (const e of events) {
    const month = e.ts.slice(0, 7); // "YYYY-MM"
    let group = groups.get(month);
    if (!group) {
      group = [];
      groups.set(month, group);
    }
    group.push(e);
  }

  const lines: string[] = [
    "# Archived Pages",
    "",
    "This index lists pages atlas has archived. Pages here are preserved for historical",
    "reference but excluded from the main wiki indexes, summaries, search, and synthesis.",
    "",
    "**To restore an archived page:** run `/doc-wiki:unarchive <path>` — the command moves",
    "the file back, strips deprecation frontmatter, and rewrites inbound `(archived)` links.",
    "No manual git or frontmatter edits.",
    "",
  ];

  const sortedMonths = [...groups.keys()].sort((a, b) => (a > b ? -1 : 1));

  if (sortedMonths.length === 0) {
    lines.push("No pages currently archived.");
    lines.push("");
  }

  for (const month of sortedMonths) {
    lines.push(`## ${month}`);
    lines.push("");
    for (const e of groups.get(month)!) {
      const archRelPath = e.to; // e.g. "wiki/_archive/billing/architecture.md"
      const linkTarget = archRelPath.replace(/^wiki\/_archive\//, "");
      const dateStr = isoDate(e.ts);
      lines.push(
        `- [${linkTarget}](${linkTarget}) — archived ${dateStr}, ${e.reason}`,
      );
    }
    lines.push("");
  }

  const indexDir = path.join(wikiRoot, "wiki", "_archive");
  fs.mkdirSync(indexDir, { recursive: true });
  fs.writeFileSync(path.join(indexDir, "index.md"), lines.join("\n"), "utf-8");
}

// ── resolveArchivePath ────────────────────────────────────────────────────────

interface ResolvedArchivePath {
  absPath: string;
  relPath: string; // relative to wikiRoot
}

/**
 * Resolve pageOrSlug to the absolute path of an archived page.
 *
 * If pageOrSlug looks like a path under wiki/_archive/ (relative or absolute),
 * use it directly. Otherwise, substring-match against all *.md files under
 * wiki/_archive/ — throwing on ambiguous or no-match.
 */
async function resolveArchivePath(
  wikiRoot: string,
  pageOrSlug: string,
): Promise<ResolvedArchivePath> {
  const archiveRoot = path.join(wikiRoot, "wiki", "_archive");

  // Direct path check: strip wikiRoot prefix if absolute, then test existence.
  const candidateRel = path.isAbsolute(pageOrSlug)
    ? path.relative(wikiRoot, pageOrSlug)
    : pageOrSlug;
  const candidateRelRaw = candidateRel.replace(/\\/g, "/");
  const candidateRelPosix = path.posix.normalize(candidateRelRaw);

  // If the raw input looked like a direct wiki/_archive/ path but normalization
  // resolved ".." segments that escape the archive root, it is a traversal attempt.
  if (
    candidateRelRaw.startsWith("wiki/_archive/") &&
    !candidateRelPosix.startsWith("wiki/_archive/")
  ) {
    throw new Error(
      `path traversal detected: "${pageOrSlug}" resolves outside wiki/_archive/`,
    );
  }

  if (candidateRelPosix.startsWith("wiki/_archive/")) {
    const absPath = path.resolve(wikiRoot, candidateRelPosix);
    if (
      !checkPathContainment(absPath, path.join(wikiRoot, "wiki", "_archive"))
    ) {
      throw new Error(
        `path traversal detected: "${pageOrSlug}" resolves outside wiki/_archive/`,
      );
    }
    if (fs.existsSync(absPath)) {
      return { absPath, relPath: candidateRelPosix };
    }
  }

  // Substring slug match: collect all *.md under wiki/_archive/
  if (!fs.existsSync(archiveRoot)) {
    throw new Error(
      `no archived page matching "${pageOrSlug}" — archive directory does not exist`,
    );
  }

  const matches: ResolvedArchivePath[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== "index.md"
      ) {
        const relPath = path.relative(wikiRoot, abs).replace(/\\/g, "/");
        if (relPath.includes(pageOrSlug)) {
          matches.push({ absPath: abs, relPath });
        }
      }
    }
  }
  walk(archiveRoot);

  if (matches.length === 0) {
    throw new Error(`no archived page matching "${pageOrSlug}"`);
  }
  if (matches.length > 1) {
    const paths = matches.map((m) => m.relPath).join(", ");
    throw new Error(`ambiguous slug "${pageOrSlug}" matches: ${paths}`);
  }
  return matches[0]!;
}

// ── stripArchiveFrontmatter ───────────────────────────────────────────────────

const ARCHIVE_FM_KEYS = new Set([
  "status",
  "archived_at",
  "archive_reason",
  "archived_from",
]);

/**
 * Read the file at absPath, remove the four deprecation frontmatter fields,
 * preserve everything else, write it back in place.
 */
async function stripArchiveFrontmatter(absPath: string): Promise<void> {
  const raw = await fs.promises.readFile(absPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const fm: Record<string, unknown> = {};
  if (frontmatter) {
    for (const [k, v] of Object.entries(frontmatter)) {
      if (!ARCHIVE_FM_KEYS.has(k)) {
        fm[k] = v;
      }
    }
  }
  const newContent =
    Object.keys(fm).length === 0 ? body : `---\n${yaml.dump(fm)}---\n${body}`;
  await fs.promises.writeFile(absPath, newContent, "utf-8");
}

// ── Link-rewrite public types ──────────────────────────────────────────────────

export interface RewriteArchiveLinksOptions {
  wikiRoot: string;
  events: ArchiveEvent[];
  mode: RewriteMode;
}

export interface RewriteUnarchiveLinksOptions {
  wikiRoot: string;
  event: UnarchiveEvent;
}

// ── Code-block-aware text rewriter ────────────────────────────────────────────

/**
 * Split body text into alternating [non-code, code, non-code, ...] segments.
 * Fenced code blocks (triple backtick) are "code" segments; everything else is
 * "non-code".  Returns an array of { text, isCode } records.
 */
function splitOnFencedBlocks(
  body: string,
): Array<{ text: string; isCode: boolean }> {
  const segments: Array<{ text: string; isCode: boolean }> = [];
  const fenceRe = /^```/m;
  let remaining = body;
  let inCode = false;

  while (remaining.length > 0) {
    const match = fenceRe.exec(remaining);
    if (match === null) {
      segments.push({ text: remaining, isCode: inCode });
      break;
    }
    // Text before the fence delimiter (including the delimiter line itself)
    const fenceLineEnd = remaining.indexOf("\n", match.index);
    const splitAt = fenceLineEnd === -1 ? remaining.length : fenceLineEnd + 1;

    const before = remaining.slice(0, splitAt);
    segments.push({ text: before, isCode: inCode });
    remaining = remaining.slice(splitAt);
    inCode = !inCode;
  }

  return segments;
}

// ── rewriteInboundLinks ────────────────────────────────────────────────────────

/**
 * Walk all live wiki pages and update links that point to any of the just-archived
 * pages, according to `mode`.
 *
 * Returns the total number of link substitutions made.
 */
export async function rewriteInboundLinks(
  opts: RewriteArchiveLinksOptions,
): Promise<number> {
  if (!(REWRITE_MODES as readonly string[]).includes(opts.mode)) {
    throw new Error(
      `invalid mode '${opts.mode}'; expected one of: ${REWRITE_MODES.join(", ")}`,
    );
  }
  if (opts.mode === "leave" || opts.events.length === 0) return 0;

  // Build a lookup: wiki-relative from-path → to-path (archive destination)
  const eventMap = new Map<string, string>();
  for (const e of opts.events) {
    eventMap.set(e.from, e.to);
  }

  const livePages = walkLivePages(opts.wikiRoot);
  let totalRewrites = 0;

  const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const page of livePages) {
    const raw = await fs.promises.readFile(page.absPath, "utf-8");
    const segments = splitOnFencedBlocks(raw);

    let changed = false;
    const rewritten = segments.map(({ text, isCode }) => {
      if (isCode) return text;

      let m: RegExpExecArray | null;
      const re = new RegExp(LINK_RE.source, "g");
      let lastIndex = 0;
      const out: string[] = [];

      while ((m = re.exec(text)) !== null) {
        const [whole, label, rawTarget] = m as RegExpExecArray &
          [string, string, string];

        // Skip already-rewritten links
        if (label.endsWith(" (archived)") && rawTarget.includes("_archive/")) {
          out.push(text.slice(lastIndex, m.index + whole.length));
          lastIndex = m.index + whole.length;
          continue;
        }

        // Split off fragment/query so resolution works on the bare path
        const fragIdx = rawTarget.search(/[#?]/);
        const pathPart =
          fragIdx === -1 ? rawTarget : rawTarget.slice(0, fragIdx);
        const suffix = fragIdx === -1 ? "" : rawTarget.slice(fragIdx);

        // Resolve target to wiki-relative path
        const pageDir = path.dirname(page.absPath);
        const resolvedAbs = path.resolve(pageDir, pathPart);
        const resolvedRel = path
          .relative(opts.wikiRoot, resolvedAbs)
          .replace(/\\/g, "/");

        const archiveTo = eventMap.get(resolvedRel);
        if (!archiveTo) {
          out.push(text.slice(lastIndex, m.index + whole.length));
          lastIndex = m.index + whole.length;
          continue;
        }

        out.push(text.slice(lastIndex, m.index));
        if (opts.mode === "rewrite") {
          const archAbsPath = path.join(opts.wikiRoot, archiveTo);
          const newRelTarget = path
            .relative(pageDir, archAbsPath)
            .replace(/\\/g, "/");
          out.push(`[${label} (archived)](${newRelTarget}${suffix})`);
        } else {
          // drop mode: replace [label](target) with plain label text
          out.push(label);
        }
        totalRewrites++;
        changed = true;
        lastIndex = m.index + whole.length;
      }

      out.push(text.slice(lastIndex));
      return out.join("");
    });

    if (changed) {
      await fs.promises.writeFile(page.absPath, rewritten.join(""), "utf-8");
    }
  }

  return totalRewrites;
}

// ── rewriteInboundLinksForUnarchive ───────────────────────────────────────────

/**
 * Walk all live wiki pages and revert any links that were rewritten when the page
 * was archived: `[label (archived)](…/_archive/…)` → `[label](…/original/…)`.
 *
 * Returns the number of link reversions made.
 */
export async function rewriteInboundLinksForUnarchive(
  opts: RewriteUnarchiveLinksOptions,
): Promise<number> {
  const { event, wikiRoot } = opts;

  // The archived path and the restored (live) path, both wiki-relative.
  const archiveRelPath = event.from; // "wiki/_archive/billing/architecture.md"
  const liveRelPath = event.to; // "wiki/billing/architecture.md"

  const livePages = walkLivePages(wikiRoot);
  let totalReverted = 0;

  const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const page of livePages) {
    const raw = await fs.promises.readFile(page.absPath, "utf-8");
    const segments = splitOnFencedBlocks(raw);

    let changed = false;
    const rewritten = segments.map(({ text, isCode }) => {
      if (isCode) return text;

      let m: RegExpExecArray | null;
      const re = new RegExp(LINK_RE.source, "g");
      let lastIndex = 0;
      const out: string[] = [];

      while ((m = re.exec(text)) !== null) {
        const [whole, label, rawTarget] = m as RegExpExecArray &
          [string, string, string];

        // Only process links that look like rewritten archive links:
        // label must end with " (archived)" AND path must be under _archive/.
        if (
          !label.endsWith(" (archived)") ||
          !rawTarget.includes("_archive/")
        ) {
          out.push(text.slice(lastIndex, m.index + whole.length));
          lastIndex = m.index + whole.length;
          continue;
        }

        // Split off fragment/query so resolution works on the bare path
        const fragIdx = rawTarget.search(/[#?]/);
        const pathPart =
          fragIdx === -1 ? rawTarget : rawTarget.slice(0, fragIdx);
        const suffix = fragIdx === -1 ? "" : rawTarget.slice(fragIdx);

        // Resolve to wiki-relative to check it matches the archive path
        const pageDir = path.dirname(page.absPath);
        const resolvedAbs = path.resolve(pageDir, pathPart);
        const resolvedRel = path
          .relative(wikiRoot, resolvedAbs)
          .replace(/\\/g, "/");

        if (resolvedRel !== archiveRelPath) {
          out.push(text.slice(lastIndex, m.index + whole.length));
          lastIndex = m.index + whole.length;
          continue;
        }

        // Strip " (archived)" suffix and repoint to the live path
        const originalLabel = label.slice(0, -" (archived)".length);
        const liveAbsPath = path.join(wikiRoot, liveRelPath);
        const newRelTarget = path
          .relative(pageDir, liveAbsPath)
          .replace(/\\/g, "/");

        out.push(text.slice(lastIndex, m.index));
        out.push(`[${originalLabel}](${newRelTarget}${suffix})`);
        totalReverted++;
        changed = true;
        lastIndex = m.index + whole.length;
      }

      out.push(text.slice(lastIndex));
      return out.join("");
    });

    if (changed) {
      await fs.promises.writeFile(page.absPath, rewritten.join(""), "utf-8");
    }
  }

  return totalReverted;
}

// ── unarchive ─────────────────────────────────────────────────────────────────

export async function unarchive(
  opts: UnarchiveOptions,
): Promise<UnarchiveResult> {
  const resolved = await resolveArchivePath(opts.wikiRoot, opts.pageOrSlug);

  const raw = await fs.promises.readFile(resolved.absPath, "utf-8");
  const { frontmatter } = parseFrontmatter(raw);
  const archivedFrom =
    opts.target ??
    ((frontmatter as Record<string, unknown> | null)?.["archived_from"] as
      | string
      | undefined);

  if (!archivedFrom) {
    throw new Error(
      `page ${resolved.relPath} lacks archived_from frontmatter; pass --target to specify restore path`,
    );
  }

  const targetRel = opts.target ?? archivedFrom;
  const targetAbs = path.resolve(opts.wikiRoot, targetRel);

  const wikiSubtreeRoot = path.join(opts.wikiRoot, "wiki");
  if (!checkPathContainment(targetAbs, wikiSubtreeRoot)) {
    throw new Error(
      `path containment violation: restore target "${targetRel}" resolves outside wiki/ subtree`,
    );
  }

  // Relative paths must start with "wiki/" (catches e.g. "wiki.config.yaml" or
  // an absolute path that somehow passed containment but is not in wiki/).
  const targetRelPosix = targetRel.replace(/\\/g, "/");
  if (!path.isAbsolute(targetRel) && !targetRelPosix.startsWith("wiki/")) {
    throw new Error(
      `path containment violation: restore target "${targetRel}" is not inside wiki/ subtree`,
    );
  }

  if (fs.existsSync(targetAbs)) {
    throw new Error(
      `target ${targetRel} already exists; pass --target to restore elsewhere`,
    );
  }

  // rename-first ordering for partial-failure safety
  await fs.promises.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.promises.rename(resolved.absPath, targetAbs);
  await stripArchiveFrontmatter(targetAbs);

  const event: UnarchiveEvent = {
    ts: new Date().toISOString(),
    op: "unarchive",
    from: resolved.relPath,
    to: targetRel,
  };

  await appendHistory(opts.wikiRoot, [event]);
  await rebuildArchiveIndex(opts.wikiRoot);

  // "drop" was forward-only (drop links to a page being archived); on unarchive
  // there are no archive-style links to drop, so treat it as "leave".
  const effectiveMode =
    opts.inboundLinks === "drop" ? "leave" : opts.inboundLinks;
  const linksReverted =
    effectiveMode === "rewrite"
      ? await rewriteInboundLinksForUnarchive({
          wikiRoot: opts.wikiRoot,
          event,
        })
      : 0;
  return { from: event.from, to: event.to, linksReverted };
}

// ── Main sweep ────────────────────────────────────────────────────────────────

export async function sweep(opts: SweepOptions): Promise<SweepResult> {
  if (!(AUTONOMY_MODES as readonly string[]).includes(opts.autonomy)) {
    throw new Error(
      `invalid autonomy '${opts.autonomy}'; expected one of: ${AUTONOMY_MODES.join(", ")}`,
    );
  }
  const partialThreshold = opts.partialThreshold ?? 1.0;
  const resolvedOpts: SweepOptions = {
    inboundLinks: "rewrite",
    ...opts,
    partialThreshold,
  };

  const livePages = walkLivePages(opts.wikiRoot);
  const atlasPages = filterAtlasPages(livePages);

  const archived: ArchiveEvent[] = [];
  const candidates: CandidateReport[] = [];
  const errors: ErrorReport[] = [];
  const pendingConfirmation: PendingArchive[] = [];
  const reported: ReportedArchive[] = [];

  const ts = new Date().toISOString();

  for (const page of atlasPages) {
    let existence: SourceExistenceResult;
    try {
      // Call without a threshold so we always get the raw ratio/missing from
      // sourceExistence.  We apply the sweep's own partialThreshold below to
      // decide whether a partial-removal page is archived or just reported.
      existence = sourceExistence({
        wikiRoot: opts.wikiRoot,
        repoRoot: opts.repoRoot,
        page: page.absPath,
      });
    } catch (e) {
      errors.push({ page: page.relPath, error: String(e) });
      continue;
    }

    if (existence.missing.length === 0) {
      // All sources present — live, nothing to do.
      continue;
    }

    if (existence.ratio === 1.0) {
      // All sources missing → orphan.
      const decision = decideAutonomy(opts.autonomy, "orphan");
      if (decision === "auto") {
        try {
          if (!opts.dryRun)
            await applyArchive(page, existence, resolvedOpts, ts);
          const event = buildEvent(page, existence, resolvedOpts, ts);
          archived.push(event);
        } catch (e) {
          errors.push({ page: page.relPath, error: String(e) });
          continue;
        }
      } else if (decision === "ask") {
        pendingConfirmation.push({ page: page.relPath, existence });
      } else {
        // "report-only" (conservative) → surface in reported[]
        reported.push({
          page: page.relPath,
          status: "orphan",
          reason: `All sources missing: ${existence.missing.join(", ")}`,
          missing_sources: [...existence.missing],
        });
      }
    } else if (existence.ratio >= partialThreshold) {
      // Partial removal exceeds threshold → treat as archive-eligible.
      const decision = decideAutonomy(opts.autonomy, "orphan");
      if (decision === "auto") {
        try {
          if (!opts.dryRun)
            await applyArchive(page, existence, resolvedOpts, ts);
          const event = buildEvent(page, existence, resolvedOpts, ts);
          archived.push(event);
        } catch (e) {
          errors.push({ page: page.relPath, error: String(e) });
          continue;
        }
      } else if (decision === "ask") {
        pendingConfirmation.push({ page: page.relPath, existence });
      } else {
        // "report-only" (conservative) → surface in reported[]
        reported.push({
          page: page.relPath,
          status: "candidate",
          reason: `${Math.round(existence.ratio * 100)}% of sources missing: ${existence.missing.join(", ")}`,
          missing_sources: [...existence.missing],
        });
      }
    } else {
      // Partial removal below threshold → candidate (reported, not archived).
      candidates.push({
        page: page.relPath,
        ratio: existence.ratio,
        missing: [...existence.missing],
      });
    }
  }

  if (!opts.dryRun && archived.length > 0) {
    await appendHistory(opts.wikiRoot, archived);
    await rebuildArchiveIndex(opts.wikiRoot);
    await rewriteInboundLinks({
      wikiRoot: opts.wikiRoot,
      events: archived,
      mode: resolvedOpts.inboundLinks ?? "rewrite",
    });
  }

  return { archived, candidates, errors, pendingConfirmation, reported };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--repo-root": "repoRoot",
  "--run-id": "runId",
  "--autonomy": "autonomy",
  "--threshold": "threshold",
  "--dry-run": "dryRun",
  "--page-or-slug": "pageOrSlug",
  "--target": "target",
  "--inbound-links": "inboundLinks",
  "--events-file": "eventsFile",
  "--mode": "mode",
  "--event-file": "eventFile",
} as const;

function usage(): void {
  process.stdout.write(
    `usage: atlas_archive.js {sweep,unarchive,rebuild-index,rewrite-inbound-links,rewrite-inbound-links-unarchive} [...]

Subcommands:
  sweep          --wiki-root <p> --repo-root <p> --run-id <id>
                 [--autonomy conservative|balanced|autonomous|auto]
                 [--threshold <n>] [--dry-run]
                 [--inbound-links rewrite|drop|leave]
                 Archive deprecated atlas pages. Stdout: JSON SweepResult.
                 --inbound-links overrides ecosystem.archive.inbound_links from wiki.config.yaml.
  unarchive      --wiki-root <p> --page-or-slug <path-or-slug>
                 [--target <rel-path>] [--inbound-links rewrite|drop|leave]
                 Restore an archived page to the live wiki.
  rebuild-index  --wiki-root <p>
                 Regenerate wiki/_archive/index.md from _archive_history.jsonl.
  rewrite-inbound-links
                 --wiki-root <p> --events-file <path> --mode rewrite|drop|leave
                 Rewrite links pointing to pages listed in events-file (JSON array).
  rewrite-inbound-links-unarchive
                 --wiki-root <p> --event-file <path>
                 Revert (archived) links for a single UnarchiveEvent (JSON object).
`,
  );
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    usage();
    return 0;
  }
  const sub = argv[0]!;

  if (sub === "sweep") {
    let parsed;
    try {
      parsed = parseFlags(argv.slice(1), FLAG_SPEC);
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 2;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    const repoRoot = parsed.values["repoRoot"];
    const runId = parsed.values["runId"];
    if (
      typeof wikiRoot !== "string" ||
      wikiRoot.length === 0 ||
      typeof repoRoot !== "string" ||
      repoRoot.length === 0 ||
      typeof runId !== "string" ||
      runId.length === 0
    ) {
      process.stderr.write(
        "--wiki-root, --repo-root, and --run-id are required\n",
      );
      return 2;
    }
    const autonomyRaw = parsed.values["autonomy"] ?? "autonomous";
    if (
      typeof autonomyRaw !== "string" ||
      !(AUTONOMY_MODES as readonly string[]).includes(autonomyRaw)
    ) {
      process.stderr.write(
        `error: invalid --autonomy value '${autonomyRaw}'; expected one of: ${AUTONOMY_MODES.join(", ")}\n`,
      );
      return 2;
    }
    const autonomy = autonomyRaw as Autonomy;
    const thresholdRaw = parsed.values["threshold"];
    let partialThreshold: number | undefined;
    if (typeof thresholdRaw === "string" && thresholdRaw.length > 0) {
      const n = Number(thresholdRaw);
      if (isNaN(n) || n < 0.0 || n > 1.0) {
        process.stderr.write(
          `error: --partial-threshold must be a number in [0.0, 1.0]; got '${thresholdRaw}'\n`,
        );
        return 2;
      }
      partialThreshold = n;
    }
    const dryRun = "dryRun" in parsed.values;

    // Resolve inboundLinks: CLI flag overrides config; config defaults to "rewrite".
    let configInboundLinks: RewriteMode = "rewrite";
    const configPath = path.join(wikiRoot, "wiki.config.yaml");
    try {
      const cfg = parseConfig(configPath);
      const archiveCfg = (
        cfg["ecosystem"] as Record<string, unknown> | undefined
      )?.["archive"] as ArchiveConfig | undefined;
      if (archiveCfg?.inbound_links) {
        configInboundLinks = archiveCfg.inbound_links;
      }
    } catch {
      // Config missing or invalid — fall back to default "rewrite".
    }

    const inboundLinksRaw = parsed.values["inboundLinks"];
    let inboundLinks: RewriteMode;
    if (typeof inboundLinksRaw === "string" && inboundLinksRaw.length > 0) {
      if (!(REWRITE_MODES as readonly string[]).includes(inboundLinksRaw)) {
        process.stderr.write(
          `error: invalid --inbound-links value '${inboundLinksRaw}'; expected one of: ${REWRITE_MODES.join(", ")}\n`,
        );
        return 2;
      }
      inboundLinks = inboundLinksRaw as RewriteMode;
    } else {
      inboundLinks = configInboundLinks;
    }

    const result = await sweep({
      wikiRoot,
      repoRoot,
      runId,
      autonomy,
      partialThreshold,
      dryRun,
      inboundLinks,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  }

  if (sub === "unarchive") {
    let parsed;
    try {
      parsed = parseFlags(argv.slice(1), FLAG_SPEC);
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 2;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    const pageOrSlug = parsed.values["pageOrSlug"];
    if (
      typeof wikiRoot !== "string" ||
      wikiRoot.length === 0 ||
      typeof pageOrSlug !== "string" ||
      pageOrSlug.length === 0
    ) {
      process.stderr.write("--wiki-root and --page-or-slug are required\n");
      return 2;
    }
    const target =
      typeof parsed.values["target"] === "string" &&
      parsed.values["target"].length > 0
        ? parsed.values["target"]
        : undefined;
    const inboundLinksRaw = parsed.values["inboundLinks"] ?? "rewrite";
    if (
      typeof inboundLinksRaw !== "string" ||
      !(REWRITE_MODES as readonly string[]).includes(inboundLinksRaw)
    ) {
      process.stderr.write(
        `error: invalid --inbound-links value '${inboundLinksRaw}'; expected one of: ${REWRITE_MODES.join(", ")}\n`,
      );
      return 2;
    }
    const inboundLinks = inboundLinksRaw as RewriteMode;
    try {
      const result = await unarchive({
        wikiRoot,
        pageOrSlug,
        target,
        inboundLinks,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
      return 0;
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 1;
    }
  }

  if (sub === "rebuild-index") {
    let parsed;
    try {
      parsed = parseFlags(argv.slice(1), FLAG_SPEC);
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 2;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
      process.stderr.write("--wiki-root is required\n");
      return 2;
    }
    await rebuildArchiveIndex(wikiRoot);
    process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    return 0;
  }

  if (sub === "rewrite-inbound-links") {
    let parsed;
    try {
      parsed = parseFlags(argv.slice(1), FLAG_SPEC);
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 2;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    const eventsFile = parsed.values["eventsFile"];
    const modeRaw = parsed.values["mode"] ?? "rewrite";
    if (
      typeof wikiRoot !== "string" ||
      wikiRoot.length === 0 ||
      typeof eventsFile !== "string" ||
      eventsFile.length === 0
    ) {
      process.stderr.write("--wiki-root and --events-file are required\n");
      return 2;
    }
    if (
      typeof modeRaw !== "string" ||
      !(REWRITE_MODES as readonly string[]).includes(modeRaw)
    ) {
      process.stderr.write(
        `error: invalid --mode value '${modeRaw}'; expected one of: ${REWRITE_MODES.join(", ")}\n`,
      );
      return 2;
    }
    const mode = modeRaw as RewriteMode;
    const events = JSON.parse(
      fs.readFileSync(eventsFile, "utf-8"),
    ) as ArchiveEvent[];
    const count = await rewriteInboundLinks({ wikiRoot, events, mode });
    process.stdout.write(JSON.stringify({ rewrites: count }) + "\n");
    return 0;
  }

  if (sub === "rewrite-inbound-links-unarchive") {
    let parsed;
    try {
      parsed = parseFlags(argv.slice(1), FLAG_SPEC);
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 2;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    const eventFile = parsed.values["eventFile"];
    if (
      typeof wikiRoot !== "string" ||
      wikiRoot.length === 0 ||
      typeof eventFile !== "string" ||
      eventFile.length === 0
    ) {
      process.stderr.write("--wiki-root and --event-file are required\n");
      return 2;
    }
    const event = JSON.parse(
      fs.readFileSync(eventFile, "utf-8"),
    ) as UnarchiveEvent;
    const count = await rewriteInboundLinksForUnarchive({ wikiRoot, event });
    process.stdout.write(JSON.stringify({ reverted: count }) + "\n");
    return 0;
  }

  process.stderr.write(`unknown subcommand: ${sub}\n`);
  usage();
  return 2;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main()
    .then(process.exit)
    .catch((e) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    });
}
