#!/usr/bin/env node
/**
 * source_registry.ts — Source-to-connector matching registry.
 *
 * Given a source string (URL or scheme), returns the connector that
 * handles it. The wiki uses this to classify external sources for the
 * "How to Go Deeper" section and to emit `/doc-wiki:ingest` hints targeted
 * at the right connector.
 *
 * Builtin patterns are static — one entry per @narai/*-agent-connector
 * the wiki knows about. Custom patterns can be registered via
 * `wiki.config.yaml`'s `ecosystem.agents.custom` block (e.g. an
 * internal kb:// scheme).
 *
 * Usage as a library:
 *   import { initRegistryFromConfig, lookupBySource } from "./source_registry.js";
 *   initRegistryFromConfig();   // builtins + ecosystem.agents.custom
 *   const agent = lookupBySource("db://dev/users");
 *
 * Usage as a CLI:
 *   node source_registry.js list
 *   node source_registry.js lookup --source "jira://AUTH-1"
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { parseConfig, type WikiConfig } from "./parse_config.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface UrlPattern {
  /** Hostname to match. Supports leading `*` glob, e.g. `*.atlassian.net`. */
  hostname: string;
  /** Optional path prefix for disambiguation (e.g. `/browse/` for Jira). */
  path_prefix?: string;
  /** Optional path substring match (e.g. `/spaces/` for Confluence). */
  path_contains?: string;
}

export interface InvocationTemplate {
  subagent_type: string;
  default_model: string;
  /** Human-readable label for display, e.g. "Jira", "Database". */
  label: string;
}

export interface AgentManifest {
  name: string;
  description: string;
  type: "source" | "database" | "mapper" | "maintenance";
  autonomy_level: "supervised" | "autonomous";
  model: string;
  tools: string[];
  color?: string;
  version: string;
  repository?: string;
  /** URI schemes this agent handles, e.g. ["db://", "database://"]. */
  source_schemes: string[];
  /** URL patterns (hostname + optional path) this agent matches. */
  source_url_patterns: UrlPattern[];
  invocation_template: InvocationTemplate;
  /** Path of origin (empty for builtins; populated for custom configs). */
  agent_dir: string;
  /** How this agent was registered. */
  origin: "builtin" | "plugin" | "custom";
}

/** Config-level custom agent declaration (from `ecosystem.agents.custom`). */
export interface CustomAgentConfig {
  name: string;
  description?: string;
  type?: string;
  model?: string;
  source_schemes?: string[];
  source_url_patterns?: UrlPattern[];
  invocation_template?: Partial<InvocationTemplate>;
}

// ── Builtin connector patterns ────────────────────────────────────────
//
// One entry per @narai/<id>-agent-connector that doc-wiki knows about.
// Adding a new builtin connector = one new entry here. Custom connectors
// (out-of-tree) ship via wiki.config.yaml's `ecosystem.agents.custom`.

interface BuiltinPattern {
  /** Short connector ID (e.g. "jira"). Forms the registered name `wiki-{id}-agent`. */
  id: string;
  source_schemes: string[];
  source_url_patterns: UrlPattern[];
  label: string;
  /** Logical type. "database" reserved for db; everything else is "source". */
  type: AgentManifest["type"];
}

const BUILTIN_PATTERNS: readonly BuiltinPattern[] = [
  {
    id: "jira",
    type: "source",
    source_schemes: ["jira://"],
    source_url_patterns: [
      { hostname: "*.atlassian.net", path_prefix: "/browse/" },
    ],
    label: "Jira",
  },
  {
    id: "confluence",
    type: "source",
    source_schemes: ["confluence://"],
    source_url_patterns: [
      { hostname: "*.atlassian.net", path_prefix: "/wiki/" },
      { hostname: "*.atlassian.net", path_contains: "/spaces/" },
    ],
    label: "Confluence",
  },
  {
    id: "github",
    type: "source",
    source_schemes: ["gh://", "github://"],
    source_url_patterns: [
      { hostname: "github.com" },
      { hostname: "*.github.com" },
    ],
    label: "GitHub",
  },
  {
    id: "notion",
    type: "source",
    source_schemes: ["notion://"],
    source_url_patterns: [
      { hostname: "notion.so" },
      { hostname: "*.notion.site" },
    ],
    label: "Notion",
  },
  {
    id: "gcp",
    type: "source",
    source_schemes: ["gcp://"],
    source_url_patterns: [
      { hostname: "*.cloud.google.com" },
      { hostname: "*.googleapis.com" },
    ],
    label: "GCP",
  },
  {
    id: "aws",
    type: "source",
    source_schemes: ["aws://"],
    source_url_patterns: [
      { hostname: "*.amazonaws.com" },
      { hostname: "*.aws.amazon.com" },
    ],
    label: "AWS",
  },
  {
    id: "gitlab",
    type: "source",
    source_schemes: ["gitlab://"],
    source_url_patterns: [
      { hostname: "gitlab.com" },
      { hostname: "*.gitlab.com" },
    ],
    label: "GitLab",
  },
  {
    id: "linear",
    type: "source",
    source_schemes: ["linear://"],
    source_url_patterns: [{ hostname: "linear.app" }],
    label: "Linear",
  },
  {
    id: "db",
    type: "database",
    source_schemes: ["db://"],
    source_url_patterns: [],
    label: "Database",
  },
];

/**
 * Builtin connector short IDs (e.g. "jira", "confluence", "github").
 * Read-only view over `BUILTIN_PATTERNS` — does NOT mutate the global
 * registry. Use this when you only need the connector names (atlas
 * integration-keyword detection, doc generation), not full manifests.
 */
export function builtinConnectorIds(): string[] {
  return BUILTIN_PATTERNS.map((p) => p.id);
}

function patternToManifest(p: BuiltinPattern): AgentManifest {
  const name = `wiki-${p.id}-agent`;
  return {
    name,
    description: "",
    type: p.type,
    autonomy_level: "supervised",
    model: "haiku",
    tools: [],
    version: "1.0.0",
    source_schemes: [...p.source_schemes],
    source_url_patterns: p.source_url_patterns.map((u) => ({ ...u })),
    invocation_template: {
      subagent_type: name,
      default_model: "haiku",
      label: p.label,
    },
    agent_dir: "",
    origin: "builtin",
  };
}

// ── Registry state ────────────────────────────────────────────────────

const _agents: Map<string, AgentManifest> = new Map();

// ── Registration ──────────────────────────────────────────────────────

export function registerAgent(manifest: AgentManifest): void {
  // Case-fold both matchable fields here rather than at each call site, because
  // this is the only door into `_agents`. Both comparisons downstream are
  // case-sensitive against an already-lowercased subject, so a mixed-case
  // manifest registers cleanly and then never matches anything — the silent
  // no-op `validateCustomAgentEntry` exists to prevent. It accepts mixed case
  // in both fields, so a config file is a real path to that state.
  //
  //  - source_schemes: `lookupBySource` lowercases the scheme it parses out of
  //    a source, then compares with `includes()`. Schemes are case-insensitive
  //    per RFC 3986 §3.1.
  //  - source_url_patterns[].hostname: `matchHostname` compares with `===` and
  //    `endsWith` against `new URL(source).hostname`, which the URL parser has
  //    already lowercased. Hostnames are case-insensitive per RFC 4343.
  // Store the manifest as-is when it is already folded, so callers keep
  // reference identity through registration (an existing contract).
  const schemes = manifest.source_schemes;
  const patterns = manifest.source_url_patterns;
  const needsFold =
    schemes.some((s) => s !== s.toLowerCase()) ||
    patterns.some((p) => p.hostname !== p.hostname.toLowerCase());
  _agents.set(
    manifest.name,
    needsFold
      ? {
          ...manifest,
          source_schemes: schemes.map((s) => s.toLowerCase()),
          source_url_patterns: patterns.map((p) => ({
            ...p,
            hostname: p.hostname.toLowerCase(),
          })),
        }
      : manifest,
  );
}

export function unregisterAgent(name: string): boolean {
  return _agents.delete(name);
}

export function clearRegistry(): void {
  _agents.clear();
}

// ── Lookup ────────────────────────────────────────────────────────────

/** Check if a hostname matches a pattern (supports leading `*` glob). */
export function matchHostname(pattern: string, hostname: string): boolean {
  if (pattern === hostname) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".atlassian.net"
    return hostname.endsWith(suffix) || hostname === pattern.slice(2);
  }
  return false;
}

/**
 * Given a source string, find the agent that handles it.
 *
 * Matching order:
 *  1. URL sources (https://): match against source_url_patterns
 *     - Patterns with path_prefix/path_contains are checked first (more specific)
 *  2. Scheme sources (jira://, db://): match against source_schemes
 *  3. Returns null if no match
 */
export function lookupBySource(source: string): AgentManifest | null {
  const trimmed = source.trim();
  if (trimmed === "") return null;

  // URL-based matching
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }

    // First pass: patterns with path constraints (more specific)
    for (const agent of _agents.values()) {
      for (const p of agent.source_url_patterns) {
        if (!matchHostname(p.hostname, url.hostname)) continue;
        if (p.path_prefix && url.pathname.startsWith(p.path_prefix)) return agent;
        if (p.path_contains && url.pathname.includes(p.path_contains)) return agent;
      }
    }
    // Second pass: hostname-only patterns
    for (const agent of _agents.values()) {
      for (const p of agent.source_url_patterns) {
        if (p.path_prefix || p.path_contains) continue; // already checked
        if (matchHostname(p.hostname, url.hostname)) return agent;
      }
    }
    return null;
  }

  // Scheme-based matching. Scheme grammar per RFC 3986:
  // ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) — so `s3://`, `kb-v2://` count.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (schemeMatch !== null) {
    const scheme = `${(schemeMatch[1] ?? "").toLowerCase()}://`;
    for (const agent of _agents.values()) {
      if (agent.source_schemes.includes(scheme)) return agent;
    }
  }

  return null;
}

/** Direct lookup by agent name. */
export function lookupByName(name: string): AgentManifest | null {
  return _agents.get(name) ?? null;
}

/** List all registered agents, optionally filtered. */
export function listAgents(filter?: {
  type?: string;
  origin?: string;
}): AgentManifest[] {
  let agents = [..._agents.values()];
  if (filter?.type) agents = agents.filter((a) => a.type === filter.type);
  if (filter?.origin) agents = agents.filter((a) => a.origin === filter.origin);
  return agents;
}

/**
 * The `wiki-<id>-agent` naming convention every builtin manifest follows.
 * BOTH affixes are required, with something between them: `my-agent` and
 * `wiki-search` are ordinary names that merely resemble it.
 */
const _WIKI_AGENT_NAME_RE = /^wiki-(.+)-agent$/;

/**
 * Derive the connector ID a manifest is addressed by.
 *
 * The unwrap keys off the NAME CONVENTION, not `origin`. Keying it on origin
 * looks right — builtins are the ones named `wiki-<id>-agent` — but it breaks
 * the builtin override documented in `docs/connectors.md`: reusing a builtin's
 * name under `ecosystem.agents.custom` is how a self-hosted GitLab or GitHub
 * Enterprise host gets classified, and `registerAgent` is a `Map.set` keyed on
 * name, so that entry REPLACES the builtin while carrying origin "custom".
 * Under an origin rule it derived `wiki-gitlab-agent`, and an already-enabled
 * `gitlab` stopped matching.
 *
 * A name that does not follow the convention is the connector ID itself, so it
 * is returned as-is. `my-agent` has the suffix but not the prefix; unwrapping
 * it reported `my`, and then neither an `--enabled my-agent` token nor a
 * `.connectors/config.yaml` key spelled `my-agent` matched.
 *
 * The result is always lowercased. Consumers canonicalize to lower case —
 * `how_to_go_deeper.parseEnabled` lowercases each `--enabled` token, and
 * `.connectors/config.yaml` IDs are lowercase — while the validator accepts a
 * mixed-case `name`, so a literal `Stripe` matched neither. Builtin names are
 * already lowercase, so this is a no-op for them.
 *
 * This is the single derivation site. `external_sources.classifySource` and
 * `how_to_go_deeper.shortId` both route through it; three private copies of
 * the regex pair is how the mismatches above went unnoticed.
 */
export function agentShortId(manifest: AgentManifest): string {
  const conventional = _WIKI_AGENT_NAME_RE.exec(manifest.name);
  return (conventional?.[1] ?? manifest.name).toLowerCase();
}

/** Return the set of all registered agent short IDs (for enabledAgents filtering). */
export function registeredAgentIds(): Set<string> {
  const ids = new Set<string>();
  for (const agent of _agents.values()) {
    ids.add(agentShortId(agent));
  }
  return ids;
}

// ── Initialization ────────────────────────────────────────────────────

export interface InitOptions {
  customAgents?: CustomAgentConfig[];
}

/**
 * Bootstrap the registry from the static builtin pattern list + custom
 * agents from config. Idempotent — clears any prior state first.
 *
 * Order: builtins → custom (custom wins on name collision, allowing a
 * user to override a builtin pattern).
 */
export function initRegistry(options: InitOptions = {}): void {
  clearRegistry();

  // 1. Builtins from the static pattern list
  for (const p of BUILTIN_PATTERNS) {
    registerAgent(patternToManifest(p));
  }

  // 2. Custom agents from wiki.config.yaml
  if (options.customAgents) {
    for (const cfg of options.customAgents) {
      registerAgent(customConfigToManifest(cfg));
    }
  }
}

function customConfigToManifest(cfg: CustomAgentConfig): AgentManifest {
  const label = cfg.name.replace(/^wiki-/, "").replace(/-agent$/, "");
  return {
    name: cfg.name,
    description: cfg.description ?? "",
    type: (cfg.type as AgentManifest["type"]) ?? "source",
    autonomy_level: "supervised",
    model: cfg.model ?? "haiku",
    tools: [],
    version: "0.0.0",
    source_schemes: cfg.source_schemes ?? [],
    source_url_patterns: cfg.source_url_patterns ?? [],
    invocation_template: {
      subagent_type: cfg.invocation_template?.subagent_type ?? cfg.name,
      default_model: cfg.invocation_template?.default_model ?? cfg.model ?? "haiku",
      label: cfg.invocation_template?.label ?? label,
    },
    agent_dir: "",
    origin: "custom",
  };
}

// ── Custom agents from wiki.config.yaml ───────────────────────────────

/**
 * Probe a wiki root for its wiki.config.yaml: `<root>/wiki.config.yaml`
 * then `<root>/wiki/wiki.config.yaml` — the same locations
 * `atlas_inventory.ts` probes. Defaults to cwd for callers (like the
 * classification CLIs) invoked without an explicit wiki root. Returns
 * null when no config exists.
 */
export function resolveWikiConfigPath(root: string = process.cwd()): string | null {
  const candidates = [
    path.join(root, "wiki.config.yaml"),
    path.join(root, "wiki", "wiki.config.yaml"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function warnCustomAgents(msg: string): void {
  process.stderr.write(`[source_registry] ${msg}\n`);
}

/**
 * Validate one `ecosystem.agents.custom` entry. Returns null (after a
 * stderr warning) when the entry is malformed — a bad entry is skipped,
 * never fatal, so one typo can't take down an ingest run.
 */
/**
 * A string fit to store verbatim: non-empty, and free of surrounding
 * whitespace. Every config field guarded by this is one that is compared
 * literally later — `matchHostname` against `URL.hostname`, `startsWith`
 * against `URL.pathname`, a label straight into markdown — and none of those
 * comparisons ever sees padding, so a padded value passes validation and then
 * silently matches nothing. Blank values additionally defeat the `??`
 * defaults in `customConfigToManifest`.
 *
 * Rejecting rather than trimming, so the user is told what is wrong instead
 * of having their config quietly rewritten.
 */
function isTidyString(value: string): boolean {
  return value !== "" && value === value.trim();
}

function validateCustomAgentEntry(
  entry: unknown,
  index: number,
  configPath: string,
): CustomAgentConfig | null {
  const where = `ecosystem.agents.custom[${index}] in ${configPath}`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    warnCustomAgents(`skipping ${where}: expected a mapping, got ${JSON.stringify(entry)}`);
    return null;
  }
  const e = entry as Record<string, unknown>;
  const name = e["name"];
  if (typeof name !== "string" || name.trim() === "") {
    warnCustomAgents(`skipping ${where}: "name" (non-empty string) is required`);
    return null;
  }
  // A quoted `name: " stripe "` survives the non-empty check but is stored
  // verbatim, so every ID derivation yields `" stripe "` and no enabled-agent
  // set or credentials key spelled `stripe` matches it. Reject rather than
  // trim, to match how this validator treats every other malformed field.
  if (!isTidyString(name)) {
    warnCustomAgents(
      `skipping ${where}: "name" must not have leading or trailing whitespace`,
    );
    return null;
  }
  const schemes = e["source_schemes"];
  if (
    schemes !== undefined &&
    (!Array.isArray(schemes) || !schemes.every((s) => typeof s === "string"))
  ) {
    warnCustomAgents(`skipping ${where}: "source_schemes" must be a list of strings`);
    return null;
  }
  // Each scheme must be a valid URI scheme (RFC 3986) ending in "://" so that
  // `lookupBySource`'s matcher can actually route it. Reject e.g. "kb" (no
  // "://") or "my_kb://" (underscore is not a scheme char) rather than
  // silently registering a connector that can never match.
  if (
    Array.isArray(schemes) &&
    !(schemes as string[]).every((s) => /^[a-z][a-z0-9+.-]*:\/\/$/i.test(s))
  ) {
    warnCustomAgents(
      `skipping ${where}: every "source_schemes" entry must be a URI scheme ending in "://" (e.g. "s3://")`,
    );
    return null;
  }
  // `http://` and `https://` are well-formed but unroutable here: every
  // `http(s)://` source takes `lookupBySource`'s URL-pattern branch, which
  // returns from inside itself, so the scheme matcher below it is unreachable
  // for exactly these two. An entry declaring them registers a connector that
  // can never fire — the same silent dead end the checks above prevent.
  //
  // Rejected rather than routed through as a fallback: a scheme entry matches
  // on prefix alone, so an `https://` entry would claim EVERY unmatched https
  // URL and shadow the builtins by registry insertion order. Hostname
  // matching is what `source_url_patterns` is for.
  if (
    Array.isArray(schemes) &&
    (schemes as string[]).some((s) => /^https?:\/\/$/i.test(s))
  ) {
    warnCustomAgents(
      `skipping ${where}: "http://" and "https://" are not routable as "source_schemes" — use "source_url_patterns" with a hostname instead`,
    );
    return null;
  }
  const urlPatterns = e["source_url_patterns"];
  // `path_prefix` / `path_contains` must be NON-EMPTY strings when present,
  // not merely absent-or-anything. `lookupBySource` gates on their
  // truthiness: a `path_prefix: false` — or an equally falsy `path_prefix:
  // ""` — is skipped by the path-constrained first pass, and then the second
  // pass's `if (p.path_prefix || p.path_contains) continue` does not skip it
  // either — so the entry silently widens from "hostname plus path
  // constraint" to a hostname-wide match and can capture unrelated URLs.
  // Rejecting the entry is what this validator promises for malformed input.
  const isValidUrlPattern = (p: unknown): boolean => {
    if (p === null || typeof p !== "object" || Array.isArray(p)) return false;
    const rec = p as Record<string, unknown>;
    // A blank hostname is not merely useless, it is invisible: `matchHostname`
    // compares against `URL.hostname`, which is never blank for an http(s)
    // URL, so the pattern silently matches nothing and the user gets no
    // warning that their entry is dead. Whitespace-only is as dead as empty.
    if (typeof rec["hostname"] !== "string" || !isTidyString(rec["hostname"])) return false;
    for (const key of ["path_prefix", "path_contains"] as const) {
      if (rec[key] === undefined) continue;
      if (typeof rec[key] !== "string" || !isTidyString(rec[key] as string)) return false;
    }
    return true;
  };
  if (
    urlPatterns !== undefined &&
    (!Array.isArray(urlPatterns) || !urlPatterns.every(isValidUrlPattern))
  ) {
    warnCustomAgents(
      `skipping ${where}: every "source_url_patterns" entry needs a "hostname" string, with ` +
        `optional "path_prefix" / "path_contains" strings — none empty or whitespace-padded`,
    );
    return null;
  }
  const invocation = e["invocation_template"];
  if (
    invocation !== undefined &&
    (invocation === null || typeof invocation !== "object" || Array.isArray(invocation))
  ) {
    warnCustomAgents(`skipping ${where}: "invocation_template" must be a mapping`);
    return null;
  }
  // Every `InvocationTemplate` member is typed `string`, but a mapping check
  // alone lets `label: false` through and the cast below preserves it. The
  // "How to Go Deeper" renderer interpolates the label directly
  // (`how_to_go_deeper.ts:215`), so a non-string member reaches the wiki as a
  // bogus bullet like `- **false:**` instead of being skipped as promised.
  //
  // Empty strings need rejecting for the same reason: `customConfigToManifest`
  // fills each member with `?? <default>`, which only fires on null/undefined,
  // so `label: ""` survives the default and renders as `- **:**`. The same
  // holds for `subagent_type` and `default_model`, whose empty values would
  // reach the dispatcher instead of the derived name and model.
  if (invocation !== undefined) {
    const inv = invocation as Record<string, unknown>;
    for (const key of ["label", "subagent_type", "default_model"] as const) {
      if (inv[key] === undefined) continue;
      if (typeof inv[key] !== "string" || !isTidyString(inv[key] as string)) {
        warnCustomAgents(
          `skipping ${where}: "invocation_template.${key}" must be a non-empty string ` +
            `without surrounding whitespace`,
        );
        return null;
      }
    }
  }
  const out: CustomAgentConfig = { name };
  if (typeof e["description"] === "string") out.description = e["description"];
  if (typeof e["type"] === "string") out.type = e["type"];
  if (typeof e["model"] === "string") out.model = e["model"];
  if (schemes !== undefined) out.source_schemes = schemes as string[];
  if (urlPatterns !== undefined) out.source_url_patterns = urlPatterns as UrlPattern[];
  if (invocation !== undefined) out.invocation_template = invocation as Partial<InvocationTemplate>;
  return out;
}

/**
 * Load `ecosystem.agents.custom` entries from a wiki.config.yaml.
 *
 * Degrades gracefully — this feeds the ingest path, so a broken custom
 * block must never abort a run:
 *  - missing config file → `[]` (no wiki config is a normal state)
 *  - unparseable / invalid config → stderr warning + `[]`
 *  - malformed entry → stderr warning + that entry skipped
 *
 * `configPath` is an explicit wiki.config.yaml file path (callers that
 * know the wiki root pass `<wikiRoot>/wiki.config.yaml`); when omitted,
 * cwd is probed via `resolveWikiConfigPath()`.
 */
export function loadCustomAgentConfigs(configPath?: string): CustomAgentConfig[] {
  const resolved =
    configPath !== undefined
      ? fs.existsSync(configPath)
        ? configPath
        : null
      : resolveWikiConfigPath();
  if (resolved === null) return [];

  let config: WikiConfig;
  try {
    config = parseConfig(resolved);
  } catch (e) {
    warnCustomAgents(
      `ignoring custom agents — failed to load ${resolved}: ${(e as Error).message}`,
    );
    return [];
  }

  // parseConfig guarantees `ecosystem` is an object; `agents` is passthrough.
  const ecosystem = config["ecosystem"] as Record<string, unknown>;
  const agents = ecosystem["agents"];
  if (agents === null || agents === undefined || typeof agents !== "object") return [];
  const custom = (agents as Record<string, unknown>)["custom"];
  if (custom === undefined || custom === null) return [];
  if (!Array.isArray(custom)) {
    warnCustomAgents(
      `ignoring ecosystem.agents.custom in ${resolved}: expected a list, got ${typeof custom}`,
    );
    return [];
  }

  const out: CustomAgentConfig[] = [];
  for (let i = 0; i < custom.length; i++) {
    const validated = validateCustomAgentEntry(custom[i], i, resolved);
    if (validated !== null) out.push(validated);
  }
  return out;
}

/**
 * `initRegistry` with custom agents loaded from `wiki.config.yaml` in one
 * call. This is the ingest-path bootstrap: `how_to_go_deeper.ts` and
 * `external_sources.ts` initialize through here so patterns registered
 * via `ecosystem.agents.custom` actually participate in classification.
 */
export function initRegistryFromConfig(configPath?: string): void {
  initRegistry({ customAgents: loadCustomAgentConfigs(configPath) });
  _loadedConfigPath = configPath ?? null;
  _registryLoaded = true;
}

// Which config the global registry currently holds. Owned here rather than in
// each wrapper: `how_to_go_deeper.ts` and `external_sources.ts` both bootstrap
// the same global `_agents`, so a per-module "already initialized" flag goes
// stale as soon as the other module reloads — one wrapper would then classify
// with a config it never asked for, believing it was initialized.
let _registryLoaded = false;
let _loadedConfigPath: string | null = null;

/**
 * Load `configPath` into the registry unless it is already loaded.
 *
 * An explicit path that differs from the loaded one reloads. An omitted path
 * means "no opinion, use whatever is loaded" and probes cwd only on the very
 * first call — callers that classify many sources after one explicit
 * initialization rely on that, and treating those calls as a cwd request
 * would reload the registry mid-scan and drop the custom agents.
 */
export function ensureRegistryForConfig(configPath?: string): void {
  if (configPath === undefined) {
    if (_registryLoaded) return;
  } else if (_registryLoaded && _loadedConfigPath === configPath) {
    return;
  }
  initRegistryFromConfig(configPath);
}

/** Reset the loaded-config tracking (test helper). */
export function _resetRegistryConfigState(): void {
  _registryLoaded = false;
  _loadedConfigPath = null;
}

// ── Connector config ──────────────────────────────────────────────────

/**
 * Read the set of CONFIGURED connector ids from a `.connectors/config.yaml`.
 *
 * Schema: top-level `connectors:` map; a child key is "configured" when its
 * value is a map with `enabled: true` (or, lenient: when the key is present
 * with a truthy/empty map and not `enabled: false`).
 *
 * Default search path: `<cwd>/.connectors/config.yaml` then
 * `~/.connectors/config.yaml` (first that exists).
 *
 * Returns an empty Set when no config exists or it's malformed.
 */
export function loadConfiguredConnectorIds(configPath?: string): Set<string> {
  const resolved = resolveConnectorConfigPath(configPath);
  if (resolved === null) return new Set();

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch {
    return new Set();
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return new Set();
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("connectors" in (parsed as object))
  ) {
    return new Set();
  }

  const connectors = (parsed as Record<string, unknown>)["connectors"];
  if (connectors === null || typeof connectors !== "object") return new Set();

  const ids = new Set<string>();
  for (const [id, val] of Object.entries(connectors as Record<string, unknown>)) {
    // Exclude only when explicitly disabled (enabled === false).
    if (val !== null && typeof val === "object" && (val as Record<string, unknown>)["enabled"] === false) {
      continue;
    }
    ids.add(id);
  }
  return ids;
}

function resolveConnectorConfigPath(configPath?: string): string | null {
  if (configPath !== undefined) {
    return configPath;
  }
  const localPath = path.join(process.cwd(), ".connectors", "config.yaml");
  if (fs.existsSync(localPath)) return localPath;
  const homePath = path.join(os.homedir(), ".connectors", "config.yaml");
  if (fs.existsSync(homePath)) return homePath;
  return null;
}

// ── CLI ───────────────────────────────────────────────────────────────

function cliMain(argv: string[]): number {
  const cmd = argv[0];

  if (cmd === "list") {
    initRegistryFromConfig();
    const filter: { type?: string } = {};
    const typeFlag = getFlagValue(argv, "--type");
    if (typeFlag) filter.type = typeFlag;
    const agents = listAgents(filter);
    process.stdout.write(JSON.stringify(agents, null, 2) + "\n");
    return 0;
  }

  if (cmd === "lookup") {
    const source = getFlagValue(argv, "--source");
    if (!source) {
      process.stderr.write("--source is required\n");
      return 2;
    }
    initRegistryFromConfig();
    const agent = lookupBySource(source);
    if (agent) {
      process.stdout.write(JSON.stringify(agent, null, 2) + "\n");
    } else {
      process.stdout.write("null\n");
    }
    return 0;
  }

  process.stderr.write("usage: source_registry.js <list|lookup> [--source SRC] [--type TYPE]\n");
  return 2;
}

function getFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(cliMain(process.argv.slice(2)));
}
