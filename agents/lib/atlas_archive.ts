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
 *   node atlas_archive.js unarchive ...   (Task 7 stub)
 *   node atlas_archive.js rebuild-index --wiki-root <p>  (Task 8 stub)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

import { walkLivePages, type WikiPage } from "../../skills/doc-wiki/scripts/_wiki_fs.js";
import { parseFrontmatter } from "../../skills/doc-wiki/scripts/_frontmatter.js";
import {
  sourceExistence,
  type SourceExistenceResult,
} from "../../skills/doc-wiki/scripts/atlas_validate.js";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";

// ── Public types ───────────────────────────────────────────────────────────────

export type Autonomy = "conservative" | "balanced" | "autonomous" | "auto";

export interface SweepOptions {
  wikiRoot: string;
  repoRoot: string;
  autonomy: Autonomy;
  runId: string;
  dryRun?: boolean;
  /** Fraction of missing sources to trigger archive. Default: 1.0 (all missing). */
  partialThreshold?: number;
  inboundLinks?: "rewrite" | "drop" | "leave";
}

export interface ArchiveEvent {
  ts: string;
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

export interface SweepResult {
  archived: ArchiveEvent[];
  candidates: CandidateReport[];
  errors: ErrorReport[];
  pendingConfirmation: PendingArchive[];
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
    if (frontmatter && "atlas_facet" in frontmatter && frontmatter["atlas_facet"] != null) {
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
  fields: { archived_from: string; archived_at: string; archive_reason: string },
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
  return {
    ts,
    atlas_run_id: opts.runId,
    from: page.relPath,
    to: archRelPath,
    reason: `all sources removed (${existence.missing.join(", ")})`,
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

  // Stamp frontmatter on the source file first, then move.
  stampFrontmatter(page.absPath, {
    archived_from: page.relPath,
    archived_at: isoDate(ts),
    archive_reason: `all sources removed (${existence.missing.join(", ")})`,
  });

  fs.renameSync(page.absPath, archAbsPath);
}

// ── History journal ────────────────────────────────────────────────────────────

async function appendHistory(wikiRoot: string, events: ArchiveEvent[]): Promise<void> {
  if (events.length === 0) return;
  const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(journalPath, lines, "utf-8");
}

// ── Archive index rebuild ─────────────────────────────────────────────────────

export async function rebuildArchiveIndex(wikiRoot: string): Promise<void> {
  const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
  let events: ArchiveEvent[] = [];

  if (fs.existsSync(journalPath)) {
    const lines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as ArchiveEvent);
      } catch {
        // skip malformed lines
      }
    }
  }

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
  for (const month of sortedMonths) {
    lines.push(`## ${month}`);
    lines.push("");
    for (const e of groups.get(month)!) {
      const archRelPath = e.to; // e.g. "wiki/_archive/billing/architecture.md"
      const linkTarget = archRelPath.replace(/^wiki\/_archive\//, "");
      const dateStr = isoDate(e.ts);
      lines.push(`- [${linkTarget}](${linkTarget}) — archived ${dateStr}, ${e.reason}`);
    }
    lines.push("");
  }

  const indexDir = path.join(wikiRoot, "wiki", "_archive");
  fs.mkdirSync(indexDir, { recursive: true });
  fs.writeFileSync(path.join(indexDir, "index.md"), lines.join("\n"), "utf-8");
}

// ── Main sweep ────────────────────────────────────────────────────────────────

export async function sweep(opts: SweepOptions): Promise<SweepResult> {
  const partialThreshold = opts.partialThreshold ?? 1.0;
  const resolvedOpts: SweepOptions = { inboundLinks: "rewrite", ...opts, partialThreshold };

  const livePages = walkLivePages(opts.wikiRoot);
  const atlasPages = filterAtlasPages(livePages);

  const archived: ArchiveEvent[] = [];
  const candidates: CandidateReport[] = [];
  const errors: ErrorReport[] = [];
  const pendingConfirmation: PendingArchive[] = [];

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
      const event = buildEvent(page, existence, resolvedOpts, ts);
      if (decision === "auto") {
        if (!opts.dryRun) {
          await applyArchive(page, existence, resolvedOpts, ts);
        }
        archived.push(event);
      } else if (decision === "ask") {
        pendingConfirmation.push({ page: page.relPath, existence });
      }
      // "report-only" → no action, not added to archived
    } else if (existence.ratio >= partialThreshold) {
      // Partial removal exceeds threshold → treat as archive-eligible.
      const decision = decideAutonomy(opts.autonomy, "orphan");
      const event = buildEvent(page, existence, resolvedOpts, ts);
      if (decision === "auto") {
        if (!opts.dryRun) {
          await applyArchive(page, existence, resolvedOpts, ts);
        }
        archived.push(event);
      } else if (decision === "ask") {
        pendingConfirmation.push({ page: page.relPath, existence });
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
    // Inbound link rewrite: Task 8 placeholder
  }

  return { archived, candidates, errors, pendingConfirmation };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--repo-root": "repoRoot",
  "--run-id": "runId",
  "--autonomy": "autonomy",
  "--threshold": "threshold",
  "--dry-run": "dryRun",
} as const;

function usage(): void {
  process.stdout.write(
    `usage: atlas_archive.js {sweep,unarchive,rebuild-index} [...]

Subcommands:
  sweep          --wiki-root <p> --repo-root <p> --run-id <id>
                 [--autonomy conservative|balanced|autonomous|auto]
                 [--threshold <n>] [--dry-run]
                 Archive deprecated atlas pages. Stdout: JSON SweepResult.
  unarchive      (Task 7 — not yet implemented)
  rebuild-index  --wiki-root <p>
                 Regenerate wiki/_archive/index.md from _archive_history.jsonl.
`,
  );
}

async function main(): Promise<number> {
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
      typeof wikiRoot !== "string" || wikiRoot.length === 0 ||
      typeof repoRoot !== "string" || repoRoot.length === 0 ||
      typeof runId !== "string" || runId.length === 0
    ) {
      process.stderr.write("--wiki-root, --repo-root, and --run-id are required\n");
      return 2;
    }
    const autonomyRaw = parsed.values["autonomy"] ?? "autonomous";
    const autonomy = (typeof autonomyRaw === "string" ? autonomyRaw : "autonomous") as Autonomy;
    const thresholdRaw = parsed.values["threshold"];
    const partialThreshold =
      typeof thresholdRaw === "string" && thresholdRaw.length > 0
        ? Number(thresholdRaw)
        : undefined;
    const dryRun = "dryRun" in parsed.values;
    const result = await sweep({ wikiRoot, repoRoot, runId, autonomy, partialThreshold, dryRun });
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  }

  if (sub === "unarchive") {
    // Task 7 stub
    process.stderr.write("unarchive: not yet implemented (Task 7)\n");
    return 1;
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

  process.stderr.write(`unknown subcommand: ${sub}\n`);
  usage();
  return 2;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().then(process.exit).catch((e) => {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  });
}
