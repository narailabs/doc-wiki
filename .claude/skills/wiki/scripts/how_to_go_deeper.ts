#!/usr/bin/env node
/**
 * how_to_go_deeper.ts — auto-generated "How to Go Deeper" section.
 *
 * Per v2 design §20 + compilation.md §"How to Go Deeper", every wiki
 * page compiled from EXTERNAL sources (Jira, Confluence, GitHub,
 * Notion, GCP, AWS, a database, or a code file) gets a trailing
 * section that tells future readers / agents exactly which command to
 * run to pull the latest state of the source system.
 *
 * Source-to-agent matching is driven by the source_registry — agents
 * are discovered from AGENT.md frontmatter rather than hardcoded.
 * Custom agents registered in wiki.config.yaml are supported
 * automatically.
 *
 * Usage as a library:
 *     import { buildHowToGoDeeper } from "./how_to_go_deeper.js";
 *     const section = buildHowToGoDeeper(sources, { enabledAgents });
 *
 * Usage as a CLI:
 *     node how_to_go_deeper.js \
 *       --sources '["jira://AUTH-1","src/auth.py:1-20"]' \
 *       --enabled jira,github
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./_cli_args.js";
import {
  lookupBySource,
  initRegistry,
  listAgents,
  type AgentManifest,
} from "../../../agents/lib/source_registry.js";

/**
 * Agent identifier — now a plain string so custom agents work without
 * modifying a union type. Backwards-compatible: existing call sites
 * that pass `"jira"` or `Set<AgentId>(["github"])` still work.
 */
export type AgentId = string;

/** One bullet before we flatten to markdown. Kept exported for tests. */
export interface DeepEntry {
  label: string;
  hint: string;
  /** Short agent ID (e.g. "jira", "db"), omitted for local bullets. */
  agent?: AgentId;
  /** The original frontmatter string — useful for attribution in tests. */
  source: string;
}

const LOCAL_RAW_PREFIX = "raw/";
const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".kt", ".go", ".rs",
  ".cs", ".rb", ".c", ".h", ".cc", ".cpp", ".hpp", ".swift", ".php",
  ".sql", ".sh",
]);

// ── Registry initialization ──────────────────────────────────────────

let _initialized = false;

function ensureRegistry(): void {
  if (_initialized) return;
  _initialized = true;
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const agentsDir = path.resolve(thisDir, "../../../agents");
  try {
    initRegistry({ agentsDir });
  } catch {
    // Non-fatal: fall through to no-match for all sources
  }
}

/** Reset registry state (test helper). */
export function _resetRegistry(): void {
  _initialized = false;
}

// ── Short ID extraction ──────────────────────────────────────────────

/** Extract short agent ID from manifest name: "wiki-jira-agent" → "jira". */
function shortId(manifest: AgentManifest): string {
  return manifest.name.replace(/^wiki-/, "").replace(/-agent$/, "");
}

// ── Hint builders (per-agent, for exact output compatibility) ─────────

/**
 * Build a DeepEntry from a matched agent manifest and source string.
 *
 * Builtin agents have specific hint formats that must remain stable
 * (tested, documented, and consumed by downstream tooling). Custom
 * agents use a generic template.
 */
function buildAgentEntry(manifest: AgentManifest, source: string): DeepEntry {
  const id = shortId(manifest);
  const label = manifest.invocation_template.label;

  // Determine if this is a URL or scheme match
  const isUrl = /^https?:\/\//i.test(source);

  if (isUrl) {
    return buildUrlHint(id, label, source);
  }

  // Scheme-based: extract the rest after scheme://
  const schemeMatch = /^[a-z]+:\/\/(.+)$/i.exec(source);
  const rest = schemeMatch?.[1] ?? source;

  return buildSchemeHint(id, label, source, rest);
}

function buildUrlHint(id: string, label: string, source: string): DeepEntry {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return { agent: id, label, hint: `Open <${source}>`, source };
  }

  switch (id) {
    case "jira": {
      const key = url.pathname.replace(/^\/browse\//, "").split("?")[0] ?? "";
      const query = key ? `key = ${key}` : "<JQL>";
      return { agent: id, label, hint: `wiki agent jira --query "${query}"`, source };
    }
    case "confluence":
      return { agent: id, label, hint: `wiki agent confluence --url "${source}"`, source };
    case "github": {
      const trimmed = url.pathname.replace(/^\/+/, "");
      return { agent: id, label, hint: `wiki agent github --path "${trimmed}"`, source };
    }
    case "notion":
      return { agent: id, label, hint: `wiki agent notion --url "${source}"`, source };
    case "gcp":
      return { agent: id, label, hint: `wiki agent gcp --resource "${source}"`, source };
    case "aws":
      return { agent: id, label, hint: `wiki agent aws --resource "${source}"`, source };
    default:
      // Custom agent — generic hint
      return { agent: id, label, hint: `wiki agent ${id} --source "${source}"`, source };
  }
}

function buildSchemeHint(id: string, label: string, source: string, rest: string): DeepEntry {
  switch (id) {
    case "jira":
      return { agent: id, label, hint: `wiki agent jira --query "key = ${rest}"`, source };
    case "confluence":
      return { agent: id, label, hint: `wiki agent confluence --path "${rest}"`, source };
    case "github":
      return { agent: id, label, hint: `wiki agent github --path "${rest}"`, source };
    case "notion":
      return { agent: id, label, hint: `wiki agent notion --id "${rest}"`, source };
    case "gcp":
      return { agent: id, label, hint: `wiki agent gcp --resource "${rest}"`, source };
    case "aws":
      return { agent: id, label, hint: `wiki agent aws --resource "${rest}"`, source };
    case "db": {
      const [env = "dev", ...tail] = rest.split("/");
      const target = tail.join("/") || "<table>";
      return { agent: id, label, hint: `wiki agent db-query ${env} "DESCRIBE ${target}"`, source };
    }
    default:
      // Custom agent — generic hint using rest
      return { agent: id, label, hint: `wiki agent ${id} --source "${source}"`, source };
  }
}

// ── Local source classification (non-agent) ──────────────────────────

function classifyLocal(source: string): DeepEntry | null {
  if (source.startsWith(LOCAL_RAW_PREFIX)) return null;

  const codeMatch = /^([^:]+\.[A-Za-z0-9]+)(?::(\d+(?:-\d+)?))?$/.exec(source);
  if (codeMatch !== null) {
    const file = codeMatch[1] ?? "";
    const ext = path.extname(file).toLowerCase();
    if (CODE_EXTS.has(ext)) {
      return { label: "Live code", hint: `Read \`${source}\``, source };
    }
  }
  return null;
}

// ── Main classifier ──────────────────────────────────────────────────

/** Classify one source string into a bullet, or `null` when we skip it. */
export function classifySource(source: string): DeepEntry | null {
  const trimmed = source.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith(LOCAL_RAW_PREFIX)) return null;

  ensureRegistry();

  // Try URL matching first
  if (/^https?:\/\//i.test(trimmed)) {
    const manifest = lookupBySource(trimmed);
    if (manifest !== null) {
      return buildAgentEntry(manifest, trimmed);
    }
    // Unmatched URL — generic external link
    return { label: "External link", hint: `Open <${trimmed}>`, source: trimmed };
  }

  // Try scheme matching
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    const manifest = lookupBySource(trimmed);
    if (manifest !== null) {
      return buildAgentEntry(manifest, trimmed);
    }
  }

  // Local classification (code refs, file paths)
  const local = classifyLocal(trimmed);
  if (local !== null) return local;

  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.includes("/")) {
    return { label: "Source file", hint: `Read \`${trimmed}\``, source: trimmed };
  }
  return null;
}

// ── Section builder ──────────────────────────────────────────────────

/**
 * Build the "How to Go Deeper" section for a page. Returns `""` when
 * the page has no external sources worth calling out.
 */
export function buildHowToGoDeeper(
  sources: readonly string[],
  options: { enabledAgents?: ReadonlySet<AgentId> } = {},
): string {
  const enabled = options.enabledAgents;
  const bullets: DeepEntry[] = [];
  const seen = new Set<string>();

  for (const s of sources) {
    const entry = classifySource(s);
    if (entry === null) continue;
    if (entry.agent && enabled !== undefined && !enabled.has(entry.agent)) {
      bullets.push({
        label: entry.label,
        hint: `${entry.source} — enable the \`wiki-${entry.agent}-agent\` to query this live`,
        source: entry.source,
      });
      continue;
    }
    if (seen.has(entry.source)) continue;
    seen.add(entry.source);
    bullets.push(entry);
  }

  if (bullets.length === 0) return "";

  const lines: string[] = [];
  lines.push("## How to Go Deeper");
  lines.push("");
  for (const b of bullets) {
    lines.push(`- **${b.label}:** ${b.hint}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--sources": "sources",
  "--enabled": "enabled",
} as const;

const HELP_TEXT = `usage: how_to_go_deeper.js --sources JSON_ARRAY [--enabled csv]

Emit the "How to Go Deeper" markdown section for a page's sources.

arguments:
  --sources JSON_ARRAY  JSON array of source strings (the frontmatter
                        \`sources:\` field, JSON-encoded)
  --enabled csv         Comma-separated list of enabled source agents
                        (e.g. jira,github,db). When omitted, all hints
                        are rendered.
options:
  -h, --help            show this help message and exit
`;

function parseEnabled(csv: string): Set<string> {
  const out = new Set<string>();
  for (const tok of csv.split(",")) {
    const trimmed = tok.trim().toLowerCase();
    if (trimmed !== "") out.add(trimmed);
  }
  return out;
}

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
  const sourcesRaw = parsed.values["sources"];
  if (typeof sourcesRaw !== "string" || sourcesRaw === "") {
    process.stderr.write("the following arguments are required: --sources\n");
    return 2;
  }
  let sources: unknown;
  try {
    sources = JSON.parse(sourcesRaw);
  } catch (e) {
    process.stderr.write(`--sources is not valid JSON: ${(e as Error).message}\n`);
    return 2;
  }
  if (!Array.isArray(sources) || !sources.every((s) => typeof s === "string")) {
    process.stderr.write("--sources must be a JSON array of strings\n");
    return 2;
  }
  let enabled: Set<string> | undefined;
  const enabledRaw = parsed.values["enabled"];
  if (typeof enabledRaw === "string" && enabledRaw !== "") {
    enabled = parseEnabled(enabledRaw);
  }
  const out = buildHowToGoDeeper(sources as string[], {
    enabledAgents: enabled,
  });
  process.stdout.write(out);
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
