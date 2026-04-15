#!/usr/bin/env node
/**
 * how_to_go_deeper.ts — auto-generated "How to Go Deeper" section.
 *
 * Per v2 design §20 + compilation.md §"How to Go Deeper", every wiki
 * page compiled from EXTERNAL sources (Jira, Confluence, GitHub,
 * Notion, GCP, AWS, a database, or a code file) gets a trailing
 * section that tells future readers / agents exactly which command to
 * run to pull the latest state of the source system. This keeps wiki
 * pages useful as entry points rather than dead snapshots.
 *
 * Before this module the section was LLM judgment and only emitted by
 * wiki-orm-agent's own output path. This implementation makes it
 * generic + deterministic: classify each `sources:` frontmatter entry
 * and render a one-line bullet per source type.
 *
 * Input: array of source strings, typically from a page's
 * `sources:` frontmatter. Examples:
 *   "jira://AUTH-123"
 *   "https://company.atlassian.net/browse/AUTH-123"
 *   "confluence://spaces/ARCH/pages/Session+Flow"
 *   "gh://org/repo/issues/42"
 *   "https://github.com/org/repo/pull/42"
 *   "notion://abc123-deadbeef"
 *   "gcp://projects/p1/services/api"
 *   "aws://arn:aws:lambda:us-east-1:123:function:ingest"
 *   "db://dev/users"
 *   "raw/auth/overview.md"
 *   "src/auth/session.py:42-58"
 *
 * Rules:
 *   - An `enabledAgents` set filters which external-source commands we
 *     recommend (skip Jira-flavoured hints when Jira isn't configured).
 *   - When sources is empty OR contains only LOCAL entries under
 *     `raw/` (already ingested into the wiki), the section is empty —
 *     a reader has nothing external to go deeper into.
 *   - Unknown schemes fall through to a plain "Read <source>" bullet.
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

/** Agent identifier. Kept as strings so callers don't need a shared enum. */
export type AgentId =
  | "jira"
  | "confluence"
  | "github"
  | "notion"
  | "gcp"
  | "aws"
  | "db";

/** One bullet before we flatten to markdown. Kept exported for tests. */
export interface DeepEntry {
  label: string;
  hint: string;
  /** Which source agent produced this hint (omitted for local bullets). */
  agent?: AgentId;
  /** The original frontmatter string — useful for attribution in tests. */
  source: string;
}

const LOCAL_RAW_PREFIX = "raw/";
const CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".java",
  ".kt",
  ".go",
  ".rs",
  ".cs",
  ".rb",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".swift",
  ".php",
  ".sql",
  ".sh",
]);

/** Detect Atlassian-hosted Jira vs Confluence URLs. */
function isJiraUrl(url: URL): boolean {
  return url.pathname.startsWith("/browse/");
}
function isConfluenceUrl(url: URL): boolean {
  return url.pathname.startsWith("/wiki/") || url.pathname.includes("/spaces/");
}
function isGithubUrl(url: URL): boolean {
  return url.hostname === "github.com" || url.hostname.endsWith(".github.com");
}
function isNotionUrl(url: URL): boolean {
  return url.hostname === "notion.so" || url.hostname.endsWith(".notion.site");
}
function isGcpUrl(url: URL): boolean {
  return (
    url.hostname.endsWith("cloud.google.com") ||
    url.hostname.endsWith(".googleapis.com")
  );
}
function isAwsUrl(url: URL): boolean {
  return url.hostname.endsWith("amazonaws.com") || url.hostname.endsWith(".aws.amazon.com");
}

function classifyUrl(url: URL, source: string): DeepEntry | null {
  if (isJiraUrl(url)) {
    const key = url.pathname.replace(/^\/browse\//, "").split("?")[0] ?? "";
    const query = key ? `key = ${key}` : "<JQL>";
    return {
      agent: "jira",
      label: "Jira",
      hint: `wiki agent jira --query "${query}"`,
      source,
    };
  }
  if (isConfluenceUrl(url)) {
    return {
      agent: "confluence",
      label: "Confluence",
      hint: `wiki agent confluence --url "${source}"`,
      source,
    };
  }
  if (isGithubUrl(url)) {
    const trimmed = url.pathname.replace(/^\/+/, "");
    return {
      agent: "github",
      label: "GitHub",
      hint: `wiki agent github --path "${trimmed}"`,
      source,
    };
  }
  if (isNotionUrl(url)) {
    return {
      agent: "notion",
      label: "Notion",
      hint: `wiki agent notion --url "${source}"`,
      source,
    };
  }
  if (isGcpUrl(url)) {
    return {
      agent: "gcp",
      label: "GCP",
      hint: `wiki agent gcp --resource "${source}"`,
      source,
    };
  }
  if (isAwsUrl(url)) {
    return {
      agent: "aws",
      label: "AWS",
      hint: `wiki agent aws --resource "${source}"`,
      source,
    };
  }
  return null;
}

function classifyScheme(source: string): DeepEntry | null {
  const m = /^([a-z]+):\/\/(.+)$/i.exec(source);
  if (m === null) return null;
  const scheme = (m[1] ?? "").toLowerCase();
  const rest = m[2] ?? "";
  switch (scheme) {
    case "jira":
      return {
        agent: "jira",
        label: "Jira",
        hint: `wiki agent jira --query "key = ${rest}"`,
        source,
      };
    case "confluence":
      return {
        agent: "confluence",
        label: "Confluence",
        hint: `wiki agent confluence --path "${rest}"`,
        source,
      };
    case "gh":
    case "github":
      return {
        agent: "github",
        label: "GitHub",
        hint: `wiki agent github --path "${rest}"`,
        source,
      };
    case "notion":
      return {
        agent: "notion",
        label: "Notion",
        hint: `wiki agent notion --id "${rest}"`,
        source,
      };
    case "gcp":
      return {
        agent: "gcp",
        label: "GCP",
        hint: `wiki agent gcp --resource "${rest}"`,
        source,
      };
    case "aws":
      return {
        agent: "aws",
        label: "AWS",
        hint: `wiki agent aws --resource "${rest}"`,
        source,
      };
    case "db": {
      // Expect `db://<env>/<target>` where target is a table or a query hint.
      const [env = "dev", ...tail] = rest.split("/");
      const target = tail.join("/") || "<table>";
      return {
        agent: "db",
        label: "Database",
        hint: `wiki agent db-query ${env} "DESCRIBE ${target}"`,
        source,
      };
    }
  }
  return null;
}

function classifyLocal(source: string): DeepEntry | null {
  // Local `raw/...` sources are already ingested into the wiki body; a
  // reader doesn't need a "go deeper" link for them.
  if (source.startsWith(LOCAL_RAW_PREFIX)) return null;

  // Recognise "path:lines" code references (e.g. src/auth.py:42-58).
  const codeMatch = /^([^:]+\.[A-Za-z0-9]+)(?::(\d+(?:-\d+)?))?$/.exec(source);
  if (codeMatch !== null) {
    const file = codeMatch[1] ?? "";
    const ext = path.extname(file).toLowerCase();
    if (CODE_EXTS.has(ext)) {
      return {
        label: "Live code",
        hint: `Read \`${source}\``,
        source,
      };
    }
  }
  return null;
}

/** Classify one source string into a bullet, or `null` when we skip it. */
export function classifySource(source: string): DeepEntry | null {
  const trimmed = source.trim();
  if (trimmed === "") return null;
  // Local `raw/...` sources are already ingested into the wiki body; a
  // reader doesn't need a "go deeper" link for them — short-circuit
  // before any other classifier fires (URL, scheme, code-ref, fallback).
  if (trimmed.startsWith(LOCAL_RAW_PREFIX)) return null;

  // Try URL parsing first — falls through when it's not a URL.
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { label: "External link", hint: `Open <${trimmed}>`, source: trimmed };
    }
    const classified = classifyUrl(url, trimmed);
    if (classified !== null) return classified;
    return { label: "External link", hint: `Open <${trimmed}>`, source: trimmed };
  }

  const schemed = classifyScheme(trimmed);
  if (schemed !== null) return schemed;

  const local = classifyLocal(trimmed);
  if (local !== null) return local;

  // Absolute-ish filesystem paths without a known code extension — leave
  // a bare Read hint so readers know where to look.
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.includes("/")) {
    return { label: "Source file", hint: `Read \`${trimmed}\``, source: trimmed };
  }
  return null;
}

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
      // Agent is configured-off for this wiki; surface a subdued bullet
      // instead of a command the reader can't run yet.
      bullets.push({
        label: entry.label,
        hint: `${entry.source} — enable the \`wiki-${entry.agent}-agent\` to query this live`,
        source: entry.source,
      });
      continue;
    }
    // Deduplicate on source text so repeated listings in frontmatter
    // don't yield duplicate bullets.
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

// ── CLI ────────────────────────────────────────────────────────────

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
                        (jira, confluence, github, notion, gcp, aws,
                        db). When omitted, all hints are rendered.
options:
  -h, --help            show this help message and exit
`;

const KNOWN_AGENTS: ReadonlySet<AgentId> = new Set([
  "jira",
  "confluence",
  "github",
  "notion",
  "gcp",
  "aws",
  "db",
]);

function parseEnabled(csv: string): Set<AgentId> {
  const out = new Set<AgentId>();
  for (const tok of csv.split(",")) {
    const trimmed = tok.trim().toLowerCase();
    if (trimmed === "") continue;
    if (KNOWN_AGENTS.has(trimmed as AgentId)) {
      out.add(trimmed as AgentId);
    }
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
  let enabled: Set<AgentId> | undefined;
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
