#!/usr/bin/env node
/**
 * atlas_inventory.ts — pre-Phase-2 code-inventory manifest for
 * `/doc-wiki:atlas`.
 *
 * Walks the repo once and emits four buckets of structured findings —
 * project metadata, ORM entities, REST endpoints, and code-client
 * callsites — to `<wikiRoot>/outputs/atlas/<runId>/code-inventory.json`.
 * Phase 8 gap-report consumes the manifest in this PR; Phase 4
 * cost-estimate, Phase 6 source heuristics, and the four `assembleX`
 * helpers are reserved future consumers.
 *
 * Used as a library:
 *     import { generateInventory, persistInventory } from "./atlas_inventory.js";
 *     const inv = generateInventory(repoRoot, runId, { enableRest: true });
 *     persistInventory(wikiRoot, inv);
 *
 * Used as a CLI:
 *     node atlas_inventory.js generate --wiki-root <p> --repo-root <p> --run-id <YYYY-MM-DDTHH-MM-SS>
 *     # stdout: full manifest JSON; also persists to disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { parse as parseToml } from "smol-toml";

import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { walkCodebase } from "./repo_walker.js";
import { loadAllProfiles, detectOrm } from "./wiki_orm/profiles.js";
import { extractEntities } from "./wiki_orm/extractor.js";
import { parseMavenArtifactId, discoverServices } from "./service_discovery.js";
import type { ServiceIdentity } from "./service_discovery.js";
import { countRealServices } from "./cross_service_pages.js";
import { resolveRef, buildResolutionContext } from "./property_resolver.js";
import type { ResolutionContext } from "./property_resolver.js";
import { detectExternalSources, type ExternalSourceEntry } from "./external_sources.js";
import { loadConfiguredConnectorIds } from "./source_registry.js";

// ── Manifest types ──────────────────────────────────────────────────

export interface ProjectMetadata {
  name: string;
  version: string;
  /** `typescript` | `python` | `go` | `rust` | `java` | `unknown` */
  language: string;
  /** Free-form: `node@20`, `python@3.11`, `go@1.22`, `rust@1.70`, etc. */
  runtime: string;
  /** Manifest filenames consulted (subset of package.json, pyproject.toml, go.mod, Cargo.toml). */
  manifests_seen: string[];
}

/** One ORM entity discovered in the repo. Mirrors `wiki_orm.ExtractedEntity`. */
export interface OrmEntityEntry {
  profile: string;
  class_name: string;
  table_name: string;
  schema_name: string;
  /** Repo-relative POSIX path. */
  source_file: string;
  columns: Array<{ name: string; source_field: string }>;
  relationships: Array<{ type: string; target_entity: string }>;
}

/** One HTTP endpoint discovered in the repo. */
export interface RestEndpointEntry {
  framework: string;
  /** Uppercase HTTP verb. */
  method: string;
  /** URL path as written in source (may include `:param` placeholders). */
  path: string;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-indexed line number of the route declaration. */
  line: number;
}

/** One callsite of an external-system client (e.g. `gather(`, `fetchWithCaps(`). */
export interface CodeClientEntry {
  /** What kind of client — `gather`, `fetchWithCaps`, etc. */
  kind: string;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-indexed line number of the callsite. */
  line: number;
}

export interface HttpClientEntry {
  framework: string;            // profile name (feign, axios, ...)
  method: string;               // uppercase verb (best-effort)
  /** Raw target reference as written: a literal host/URL, `${prop}`, Feign service name, or "". */
  target_ref: string;
  /** When `target_ref` is a `${prop}` reference, the property's value resolved
   *  against the owning service's config (application.yml/properties). Set in
   *  `generateInventory`'s per-service wiring; `undefined` when not a `${prop}`
   *  ref or unresolvable. Lets `buildServiceGraph` bridge property→url→host→service. */
  resolved_target?: string;
  /** Path captured from the call (may include {param} / :param / ${param}). */
  path: string;
  file: string;
  line: number;
}
export interface QueueEndpointEntry {
  framework: string;            // spring_amqp, spring_kafka, ...
  role: "producer" | "consumer";
  /** Resolved queue/topic/exchange name literal (after constant resolution) or raw ref. */
  queue_name: string;
  message_type?: string;
  file: string;
  line: number;
}
/**
 * One RabbitMQ exchange→queue binding (a `Binding` declaration). Producers send
 * to an EXCHANGE with a routing key; consumers listen on a QUEUE bound to that
 * exchange. This triple lets `buildServiceGraph` bridge a producer keyed on the
 * exchange / routing key to the bound queue the consumer's `@RabbitListener` reads.
 * All three fields are resolved to literals (constants/bean-method names resolved).
 */
export interface QueueBindingEntry {
  queue_name: string;
  exchange: string;
  routing_key: string;
  file: string;
  line: number;
}
export interface ServiceInventory {
  identity: ServiceIdentity;
  project_metadata: ProjectMetadata;
  orm_entities: OrmEntityEntry[];
  rest_endpoints: RestEndpointEntry[];
  http_clients: HttpClientEntry[];
  queue_endpoints: QueueEndpointEntry[];
  /** RabbitMQ exchange→queue bindings; bridges producer(exchange/routing-key)→queue. */
  queue_bindings: QueueBindingEntry[];
  external_sources: ExternalSourceEntry[];
  /** Library ids (from `kind:"library"` services) this service depends on, via pom <dependency>. */
  library_deps: string[];
  /**
   * Repo-relative path of the pom.xml actually used to derive `library_deps`.
   * Differs from `<root>/pom.xml` for nested-build-subdir layouts (e.g. `feed/project/pom.xml`).
   * Absent when no pom was found or the service has no Maven manifest.
   */
  pom_path?: string;
  /** OAuth2 resource-server issuer URI (spring.security.oauth2.resourceserver.jwt.issuer-uri), or "". */
  auth_issuer: string;
}

export interface InventoryStats {
  files_walked: number;
  files_skipped_for_size: number;
  duration_ms: number;
}

export interface CodeInventory {
  atlas_run_id: string;
  generated_at: string;
  repo_root: string;
  project_metadata: ProjectMetadata;
  orm_entities: OrmEntityEntry[];
  rest_endpoints: RestEndpointEntry[];
  code_clients: CodeClientEntry[];
  /** Per-service breakdown. Populated only when `enableCrossService` is true; otherwise `[]`. */
  services: ServiceInventory[];
  stats: InventoryStats;
  /** Free-form per-bucket notes (e.g. "Cargo.toml unparseable; skipped"). */
  notes: string[];
}

// ── Project metadata ────────────────────────────────────────────────

/** Match the major Node version embedded in `engines.node`. */
function _nodeMajorFromEnginesString(spec: string): string {
  const m = spec.match(/(\d+)/);
  return m ? `node@${m[1]}` : "node";
}

/**
 * Walk the repo root for the four canonical project-metadata manifests
 * (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`) in priority
 * order. Returns the first non-empty `(name, version)` pair found and
 * the language/runtime inferred from that manifest. `manifests_seen`
 * lists every manifest that was successfully parsed (not just the
 * one whose `name` won) so consumers can detect polyglot repos.
 */
export function detectProjectMetadata(
  repoRoot: string,
  notes: string[] = [],
): ProjectMetadata {
  const manifestsSeen: string[] = [];
  let name = "";
  let version = "";
  let language = "unknown";
  let runtime = "";

  // package.json — Node / TypeScript
  const pkgPath = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        name?: string;
        version?: string;
        engines?: { node?: string };
      };
      if (typeof json.name === "string") name = name || json.name;
      if (typeof json.version === "string") version = version || json.version;
      if (language === "unknown") language = "typescript";
      if (runtime.length === 0) {
        runtime = typeof json.engines?.node === "string"
          ? _nodeMajorFromEnginesString(json.engines.node)
          : "node";
      }
      manifestsSeen.push("package.json");
    } catch (e) {
      notes.push(`package.json unparseable: ${(e as Error).message}`);
    }
  }

  // pyproject.toml — Python (PEP 621 or Poetry)
  const pyPath = path.join(repoRoot, "pyproject.toml");
  if (fs.existsSync(pyPath)) {
    try {
      const parsed = parseToml(fs.readFileSync(pyPath, "utf-8")) as {
        project?: { name?: unknown; version?: unknown };
        tool?: { poetry?: { name?: unknown; version?: unknown } };
      };
      const projectName =
        typeof parsed.project?.name === "string" ? parsed.project.name : "";
      const poetryName =
        typeof parsed.tool?.poetry?.name === "string"
          ? parsed.tool.poetry.name
          : "";
      const projectVersion =
        typeof parsed.project?.version === "string" ? parsed.project.version : "";
      const poetryVersion =
        typeof parsed.tool?.poetry?.version === "string"
          ? parsed.tool.poetry.version
          : "";
      name = name || projectName || poetryName || "";
      version = version || projectVersion || poetryVersion || "";
      if (language === "unknown") language = "python";
      if (runtime.length === 0) runtime = "python";
      manifestsSeen.push("pyproject.toml");
    } catch (e) {
      notes.push(`pyproject.toml unparseable: ${(e as Error).message}`);
    }
  }

  // go.mod — Go
  const goPath = path.join(repoRoot, "go.mod");
  if (fs.existsSync(goPath)) {
    try {
      const text = fs.readFileSync(goPath, "utf-8");
      const moduleMatch = text.match(/^module\s+(\S+)/m);
      const goMatch = text.match(/^go\s+([\d.]+)/m);
      if (moduleMatch?.[1]) name = name || moduleMatch[1];
      if (language === "unknown") language = "go";
      if (runtime.length === 0) {
        runtime = goMatch?.[1] ? `go@${goMatch[1]}` : "go";
      }
      manifestsSeen.push("go.mod");
    } catch (e) {
      notes.push(`go.mod unparseable: ${(e as Error).message}`);
    }
  }

  // Cargo.toml — Rust
  const cargoPath = path.join(repoRoot, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    try {
      const parsed = parseToml(fs.readFileSync(cargoPath, "utf-8")) as {
        package?: {
          name?: unknown;
          version?: unknown;
          "rust-version"?: unknown;
        };
      };
      if (typeof parsed.package?.name === "string") {
        name = name || parsed.package.name;
      }
      if (typeof parsed.package?.version === "string") {
        version = version || parsed.package.version;
      }
      if (language === "unknown") language = "rust";
      if (runtime.length === 0) {
        runtime =
          typeof parsed.package?.["rust-version"] === "string"
            ? `rust@${parsed.package["rust-version"]}`
            : "rust";
      }
      manifestsSeen.push("Cargo.toml");
    } catch (e) {
      notes.push(`Cargo.toml unparseable: ${(e as Error).message}`);
    }
  }

  // pom.xml — Java / Maven
  const pomPath = path.join(repoRoot, "pom.xml");
  if (fs.existsSync(pomPath)) {
    try {
      const pom = fs.readFileSync(pomPath, "utf-8");
      const artifact = parseMavenArtifactId(pom);
      if (artifact) name = name || artifact;
      const verM = pom.replace(/<parent>[\s\S]*?<\/parent>/gi, "").match(/<version>\s*([^<\s]+)/i);
      if (verM?.[1]) version = version || verM[1];
      if (language === "unknown") language = "java";
      if (runtime.length === 0) {
        const jv = pom.match(/<(?:java\.version|maven\.compiler\.target|maven\.compiler\.release)>\s*([\d.]+)/);
        runtime = jv?.[1] ? `java@${jv[1]}` : "java";
      }
      manifestsSeen.push("pom.xml");
    } catch (e) { notes.push(`pom.xml unparseable: ${(e as Error).message}`); }
  }

  // build.gradle(.kts) — Java / Gradle
  const gradlePath = ["build.gradle", "build.gradle.kts"].map((f) => path.join(repoRoot, f)).find(fs.existsSync);
  if (gradlePath) {
    if (language === "unknown") language = "java";
    if (runtime.length === 0) runtime = "java";
    manifestsSeen.push(path.basename(gradlePath));
  }

  return {
    name,
    version,
    language,
    runtime,
    manifests_seen: manifestsSeen,
  };
}

// ── Maven dependency helpers ────────────────────────────────────────

/**
 * Extract every `<artifactId>` that appears inside a `<dependency>` block
 * in a pom.xml string. The project's own `<artifactId>` (outside any
 * `<dependency>`) and the `<parent>` block are intentionally excluded by
 * only scanning inside `<dependency>…</dependency>` blocks.
 */
function _pomDependencyArtifactIds(pomXml: string): string[] {
  const ids: string[] = [];
  const depBlockRe = /<dependency>([\s\S]*?)<\/dependency>/gi;
  const artifactIdRe = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/i;
  let block: RegExpExecArray | null;
  while ((block = depBlockRe.exec(pomXml)) !== null) {
    const m = artifactIdRe.exec(block[1] ?? "");
    if (m?.[1]) ids.push(m[1]);
  }
  return ids;
}

/**
 * Build subdirectory names conventionally used to hold a nested build
 * manifest — mirrors the same list in `service_discovery.ts`.
 */
const _BUILD_SUBDIR_NAMES = ["project", "app", "server", "service", "backend", "src", "main"] as const;

/**
 * Locate the effective `pom.xml` for a service whose root may use a
 * nested build-subdir layout (T5: `feed-processor/project/pom.xml`).
 *
 * Tries `<serviceAbsRoot>/pom.xml` first; if absent, searches the
 * conventional build subdirs in `_BUILD_SUBDIR_NAMES` order and returns
 * the first `<serviceAbsRoot>/<subdir>/pom.xml` that exists, or `null`
 * when none is found.
 */
function _findServicePom(serviceAbsRoot: string): string | null {
  const direct = path.join(serviceAbsRoot, "pom.xml");
  if (fs.existsSync(direct)) return direct;
  for (const sub of _BUILD_SUBDIR_NAMES) {
    const nested = path.join(serviceAbsRoot, sub, "pom.xml");
    if (fs.existsSync(nested)) return nested;
  }
  return null;
}

// ── ORM entities ────────────────────────────────────────────────────

/**
 * Discover ORM entities by reusing the `wiki_orm` library. Loads every
 * shipped profile, scans for the best match, and (if any) extracts
 * entities from matching files. Returns `[]` for repos with no detected
 * ORM — a clean signal in the manifest, not an error.
 */
export function detectOrmEntities(repoRoot: string): OrmEntityEntry[] {
  const profiles = loadAllProfiles();
  if (profiles.length === 0) return [];

  // Union of every profile's file_patterns so one walk feeds all profiles.
  const patternSet = new Set<string>();
  for (const p of profiles) {
    for (const fp of p.file_patterns) patternSet.add(fp);
  }
  if (patternSet.size === 0) return [];

  const fileContents = walkCodebase(repoRoot, [...patternSet]);
  if (Object.keys(fileContents).length === 0) return [];

  // detectOrm returns matches sorted by score desc; take the top one.
  const matches = detectOrm(fileContents, profiles);
  const detected = matches[0];
  if (!detected) return [];

  const entities = extractEntities(fileContents, detected);
  return entities.map((e) => ({
    profile: detected.name,
    class_name: e.class_name,
    table_name: e.table_name,
    schema_name: e.schema_name,
    source_file: _toRepoRelative(repoRoot, e.source_file),
    columns: e.columns.map((c) => ({
      name: c.name,
      source_field: c.source_field,
    })),
    relationships: e.relationships.map((r) => ({
      type: r.type,
      target_entity: r.target_entity,
    })),
  }));
}

// ── REST endpoints ──────────────────────────────────────────────────

/**
 * Shape of a REST endpoint profile (shipped under `agents/lib/rest_profiles/`
 * or supplied inline via `wiki.config.yaml`'s `ecosystem.rest.custom_profiles`).
 * Mirrors the wiki_orm profile shape but tuned for HTTP-route extraction:
 * markers are literal substrings (not regex); endpoint patterns are
 * full regex with method + path capture-group offsets.
 */
export interface RestProfile {
  name: string;
  language: string;
  description?: string;
  detection: {
    file_patterns: string[];
    markers: Array<{ pattern: string; type?: string }>;
  };
  endpoint_extraction: {
    /** Optional per-file prefix extracted from a class-level annotation
     *  (e.g. ASP.NET's `[Route("api/users")]` above the controller class).
     *  When set, the prefix is prepended to each relative path captured
     *  by the per-line `patterns` regexes. Paths that start with `/` are
     *  treated as absolute and bypass the prefix. */
    file_prefix?: {
      regex: string;
      prefix_group: number;
      /** When the captured prefix contains `[controller]`, replace it
       *  with the controller class name (lowercased, `Controller`
       *  suffix stripped). Used by ASP.NET's `[Route("api/[controller]")]`. */
      expand_controller_token?: boolean;
    };
    patterns: Array<{
      regex: string;
      /** 1-indexed offset of the method capture group. `0` = no method
       *  captured; in that case `default_method` MUST be set. */
      method_group: number;
      path_group: number;
      /** Hardcoded HTTP verb for path-only patterns (e.g. Flask's
       *  `@app.route('/x')` defaults to GET). Used when `method_group` is 0. */
      default_method?: string;
    }>;
  };
}

function _restProfilesDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "rest_profiles",
  );
}

/**
 * Names of every shipped REST profile under `agents/lib/rest_profiles/`.
 * Sorted for deterministic ordering. Used as the default profile set
 * when a caller does not specify one.
 */
export function discoverShippedRestProfiles(): string[] {
  const dir = _restProfilesDir();
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".yaml")) continue;
    out.push(e.name.slice(0, -".yaml".length));
  }
  return out.sort();
}

/**
 * Validate a parsed object as a {@link RestProfile}. Returns the typed
 * profile on success, `null` when required fields are missing or wrong
 * shape. Used by both `loadRestProfile` (file-backed) and
 * `loadCustomRestProfiles` (config-backed) — same shape contract for both.
 */
function _validateRestProfile(parsed: unknown): RestProfile | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (
    typeof rec["name"] !== "string" ||
    typeof rec["language"] !== "string" ||
    !rec["detection"] ||
    !rec["endpoint_extraction"]
  ) {
    return null;
  }
  return rec as unknown as RestProfile;
}

/**
 * Load a shipped REST profile by name (e.g. `"express"`, `"fastapi"`).
 * Returns `null` when the YAML is missing, malformed, or fails minimal
 * shape validation. Errors are silenced — the inventory simply skips
 * that profile.
 */
export function loadRestProfile(name: string): RestProfile | null {
  const profilePath = path.join(_restProfilesDir(), `${name}.yaml`);
  if (!fs.existsSync(profilePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(profilePath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return null;
  }
  return _validateRestProfile(parsed);
}

/**
 * Read `ecosystem.rest.custom_profiles` from `wiki.config.yaml` and
 * return every entry that validates as a `RestProfile`. Mirrors the
 * existing `ecosystem.orm.custom_profiles` slot. Returns `[]` when:
 *   - the config file is missing
 *   - the YAML is malformed
 *   - the `ecosystem.rest.custom_profiles` key is absent
 *   - every entry fails validation
 *
 * Custom profiles let users teach the inventory about in-house frameworks
 * without modifying the doc-wiki repo.
 */
export function loadCustomRestProfiles(wikiConfigPath: string): RestProfile[] {
  if (!fs.existsSync(wikiConfigPath)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(wikiConfigPath, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const ecosystem = (parsed as Record<string, unknown>)["ecosystem"];
  if (!ecosystem || typeof ecosystem !== "object" || Array.isArray(ecosystem)) {
    return [];
  }
  const rest = (ecosystem as Record<string, unknown>)["rest"];
  if (!rest || typeof rest !== "object" || Array.isArray(rest)) {
    return [];
  }
  const customRaw = (rest as Record<string, unknown>)["custom_profiles"];
  if (!Array.isArray(customRaw)) return [];
  const out: RestProfile[] = [];
  for (const entry of customRaw) {
    const validated = _validateRestProfile(entry);
    if (validated) out.push(validated);
  }
  return out;
}

/**
 * Resolve the set of {@link RestProfile} objects the inventory should
 * scan with. When `profileNames` is empty/undefined, returns ALL shipped
 * profiles plus any custom profiles loaded from `wikiConfigPath`. When
 * `profileNames` is provided, treats each as a shipped-profile name and
 * loads accordingly (skipping unknown names silently). Custom profiles
 * win on name collision with shipped ones — users can override in-house.
 */
export function resolveRestProfiles(options: {
  profileNames?: readonly string[];
  wikiConfigPath?: string;
}): RestProfile[] {
  const out: RestProfile[] = [];
  const seen = new Set<string>();

  // 1. Load custom profiles first (so they can override shipped names).
  const custom = options.wikiConfigPath
    ? loadCustomRestProfiles(options.wikiConfigPath)
    : [];
  for (const p of custom) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }

  // 2. Load shipped profiles.
  const names =
    options.profileNames && options.profileNames.length > 0
      ? [...options.profileNames]
      : discoverShippedRestProfiles();
  for (const name of names) {
    if (seen.has(name)) continue;
    const loaded = loadRestProfile(name);
    if (loaded) {
      seen.add(loaded.name);
      out.push(loaded);
    }
  }

  return out;
}

// ── HTTP client profiles ────────────────────────────────────────────

/**
 * Shape of an HTTP client profile (shipped under `agents/lib/client_profiles/`
 * or supplied inline via `wiki.config.yaml`'s `ecosystem.clients.custom_profiles`).
 * Mirrors the RestProfile shape but tuned for outbound service-to-service call
 * detection: file_anchor captures once per file (Feign service name / prefix /
 * url); patterns capture per-call method + url/path.
 */
export interface ClientProfile {
  name: string;
  language: string;
  description?: string;
  detection: { file_patterns: string[]; markers: Array<{ pattern: string; type?: string }> };
  client_extraction: {
    /** Interface/instance-level anchor captured once per file (Feign service name + path prefix + url). */
    file_anchor?: {
      service_regex?: string; service_group?: number;
      prefix_regex?: string;  prefix_group?: number;
      url_regex?: string;     url_group?: number;
    };
    patterns: Array<{
      regex: string;
      method_group: number;        // 0 ⇒ default_method
      url_group: number;           // captures URL or path
      default_method?: string;
      /** N-line window for fluent chains (WebClient .get().uri(...)). Default 1. */
      window?: number;
      /** true ⇒ run this regex against the WHOLE file (with the `s` dotAll flag)
       *  rather than per-line. Needed for multi-line callsites where the verb and
       *  the URI appear on different lines — e.g. Spring WebClient's fluent chain:
       *  `webClient.get()\n  .uri("/api/orders")`. */
      multiline?: boolean;
    }>;
  };
}

function _clientProfilesDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "client_profiles",
  );
}

/**
 * Names of every shipped client profile under `agents/lib/client_profiles/`.
 * Sorted for deterministic ordering. Used as the default profile set
 * when a caller does not specify one.
 */
export function discoverShippedClientProfiles(): string[] {
  const dir = _clientProfilesDir();
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".yaml")) continue;
    out.push(e.name.slice(0, -".yaml".length));
  }
  return out.sort();
}

/**
 * Validate a parsed object as a {@link ClientProfile}. Returns the typed
 * profile on success, `null` when required fields are missing or wrong
 * shape. Used by both `loadClientProfile` (file-backed) and
 * `loadCustomClientProfiles` (config-backed) — same shape contract for both.
 */
function _validateClientProfile(parsed: unknown): ClientProfile | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (
    typeof rec["name"] !== "string" ||
    typeof rec["language"] !== "string" ||
    !rec["detection"] ||
    !rec["client_extraction"]
  ) {
    return null;
  }
  return rec as unknown as ClientProfile;
}

/**
 * Load a shipped client profile by name (e.g. `"feign"`, `"axios"`).
 * Returns `null` when the YAML is missing, malformed, or fails minimal
 * shape validation. Errors are silenced — the inventory simply skips
 * that profile.
 */
export function loadClientProfile(name: string): ClientProfile | null {
  const profilePath = path.join(_clientProfilesDir(), `${name}.yaml`);
  if (!fs.existsSync(profilePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(profilePath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return null;
  }
  return _validateClientProfile(parsed);
}

/**
 * Read `ecosystem.clients.custom_profiles` from `wiki.config.yaml` and
 * return every entry that validates as a `ClientProfile`. Mirrors
 * `loadCustomRestProfiles`. Returns `[]` when:
 *   - the config file is missing
 *   - the YAML is malformed
 *   - the `ecosystem.clients.custom_profiles` key is absent
 *   - every entry fails validation
 *
 * Custom profiles let users teach the inventory about in-house HTTP client
 * frameworks without modifying the doc-wiki repo.
 */
export function loadCustomClientProfiles(wikiConfigPath: string): ClientProfile[] {
  if (!fs.existsSync(wikiConfigPath)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(wikiConfigPath, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const ecosystem = (parsed as Record<string, unknown>)["ecosystem"];
  if (!ecosystem || typeof ecosystem !== "object" || Array.isArray(ecosystem)) {
    return [];
  }
  const clients = (ecosystem as Record<string, unknown>)["clients"];
  if (!clients || typeof clients !== "object" || Array.isArray(clients)) {
    return [];
  }
  const customRaw = (clients as Record<string, unknown>)["custom_profiles"];
  if (!Array.isArray(customRaw)) return [];
  const out: ClientProfile[] = [];
  for (const entry of customRaw) {
    const validated = _validateClientProfile(entry);
    if (validated) out.push(validated);
  }
  return out;
}

/**
 * Resolve the set of {@link ClientProfile} objects the inventory should
 * scan with. When `profileNames` is empty/undefined, returns ALL shipped
 * profiles plus any custom profiles loaded from `wikiConfigPath`. When
 * `profileNames` is provided, treats each as a shipped-profile name and
 * loads accordingly (skipping unknown names silently). Custom profiles
 * win on name collision with shipped ones — users can override in-house.
 */
export function resolveClientProfiles(options: {
  profileNames?: readonly string[];
  wikiConfigPath?: string;
}): ClientProfile[] {
  const out: ClientProfile[] = [];
  const seen = new Set<string>();

  // 1. Load custom profiles first (so they can override shipped names).
  const custom = options.wikiConfigPath
    ? loadCustomClientProfiles(options.wikiConfigPath)
    : [];
  for (const p of custom) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }

  // 2. Load shipped profiles.
  const names =
    options.profileNames && options.profileNames.length > 0
      ? [...options.profileNames]
      : discoverShippedClientProfiles();
  for (const name of names) {
    if (seen.has(name)) continue;
    const loaded = loadClientProfile(name);
    if (loaded) {
      seen.add(loaded.name);
      out.push(loaded);
    }
  }

  return out;
}

/**
 * Scan the repo for HTTP routes matching any of the given profiles.
 * Three-stage per profile: walkCodebase with the profile's file_patterns,
 * marker pre-filter (cheap substring), then line-by-line regex extraction.
 *
 * Endpoints are deduplicated across profiles by `(file, line, method,
 * path)` so a route matched by two overlapping profiles only appears
 * once. The first profile to match a tuple wins (its `framework` field
 * is the one recorded).
 */
export function detectRestEndpoints(
  repoRoot: string,
  profiles: readonly RestProfile[],
): RestEndpointEntry[] {
  const out: RestEndpointEntry[] = [];
  const seen = new Set<string>();

  for (const profile of profiles) {
    const fileContents = walkCodebase(
      repoRoot,
      profile.detection.file_patterns,
    );
    if (Object.keys(fileContents).length === 0) continue;

    const markerPatterns = profile.detection.markers.map((m) => m.pattern);

    for (const [absFile, content] of Object.entries(fileContents)) {
      // Cheap pre-filter: file must contain at least one marker.
      if (
        markerPatterns.length > 0 &&
        !markerPatterns.some((m) => content.includes(m))
      ) {
        continue;
      }

      // Optional per-file prefix (e.g. ASP.NET `[Route("api/users")]`
      // above the controller class). Captured once per file.
      const filePrefix = _extractFilePrefix(content, profile.endpoint_extraction.file_prefix);

      const lines = content.split("\n");
      const relFile = _toRepoRelative(repoRoot, absFile);
      for (const ext of profile.endpoint_extraction.patterns) {
        let re: RegExp;
        try {
          re = new RegExp(ext.regex, "g");
        } catch {
          continue;
        }
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx] ?? "";
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            const method =
              ext.method_group > 0
                ? (m[ext.method_group] ?? "").toUpperCase()
                : (ext.default_method ?? "").toUpperCase();
            const rawPath = m[ext.path_group] ?? "";
            const apiPath = _resolvePath(rawPath, filePrefix);
            if (method.length > 0 && apiPath.length > 0) {
              const key = `${relFile}|${lineIdx + 1}|${method}|${apiPath}`;
              if (!seen.has(key)) {
                seen.add(key);
                out.push({
                  framework: profile.name,
                  method,
                  path: apiPath,
                  file: relFile,
                  line: lineIdx + 1,
                });
              }
            }
            // Avoid pathological infinite loops on zero-width matches.
            if (m.index === re.lastIndex) re.lastIndex++;
          }
        }
      }
    }
  }

  return out;
}

// ── Code clients ────────────────────────────────────────────────────

/** External-system client kinds + the regex that matches their callsites. */
const _CLIENT_PATTERNS: ReadonlyArray<{ kind: string; regex: RegExp }> = [
  { kind: "gather", regex: /\bgather\s*\(/ },
  { kind: "fetchWithCaps", regex: /\bfetchWithCaps\s*\(/ },
];

/** File globs scanned for client callsites. Restricted to source files. */
const _CLIENT_FILE_PATTERNS: readonly string[] = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.mjs",
  "**/*.cjs",
  "**/*.py",
];

/**
 * Find every callsite of the well-known client primitives shipped with
 * doc-wiki: `gather()` from `narai-primitives` and `fetchWithCaps()` from
 * `narai-primitives/toolkit`. Per-line scan so the manifest carries an
 * actionable `(file, line)` tuple.
 */
export function detectCodeClients(repoRoot: string): CodeClientEntry[] {
  const fileContents = walkCodebase(repoRoot, _CLIENT_FILE_PATTERNS);
  const out: CodeClientEntry[] = [];
  for (const [absFile, content] of Object.entries(fileContents)) {
    const lines = content.split("\n");
    const relFile = _toRepoRelative(repoRoot, absFile);
    for (const { kind, regex } of _CLIENT_PATTERNS) {
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx] ?? "";
        if (regex.test(line)) {
          out.push({ kind, file: relFile, line: lineIdx + 1 });
        }
      }
    }
  }
  return out;
}

// ── HTTP client detector ────────────────────────────────────────────

/** Normalize a captured verb token to an HTTP method.
 *  Handles annotation verbs (`Get`→GET) and RestTemplate For-methods (`getForObject`→GET). */
function _normalizeHttpVerb(raw: string): string {
  const s = raw.toLowerCase();
  for (const v of ["get", "post", "put", "delete", "patch", "head", "options"]) {
    if (s === v || s.startsWith(v)) return v.toUpperCase();
  }
  return "";
}

/** Parse the host (first DNS label / authority) from an absolute URL literal; "" if not absolute. */
function _hostFromUrl(raw: string): string {
  const m = raw.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
  return m?.[1] ?? "";
}

/**
 * A real HTTP target looks like a URL or path: contains a slash, an http(s)
 * scheme, or a `${placeholder}`. Strings with none of these are likely cache
 * keys, config keys, or other non-URL string arguments — filter them out to
 * avoid false-positive http_client entries.
 */
function _looksLikeUrlOrPath(p: string): boolean {
  return p.includes("/") || /^https?:/i.test(p) || p.startsWith("${");
}

/**
 * Concatenate a Feign-style interface-level path prefix with a method-level
 * path. Unlike `_resolvePath`, Feign ALWAYS concatenates prefix + method-path
 * even when the method path starts with `/`. Ensures a single `/` at the join.
 */
function _feignConcatPath(prefix: string | undefined, methodPath: string): string {
  if (!prefix) return methodPath;
  return prefix.replace(/\/+$/, "") + "/" + methodPath.replace(/^\/+/, "");
}

/**
 * Scan the repo for outbound HTTP client calls matching any of the given
 * {@link ClientProfile}s. Mirrors `detectRestEndpoints` (3-stage: walkCodebase
 * → marker pre-filter → line-by-line extraction) and adds two client-specific
 * concerns:
 *   1. Per-file `file_anchor` — captures Feign's interface-level service name,
 *      path prefix, and url ONCE per file (first match of each regex).
 *   2. HTTP-verb normalization — handles annotation-style (`Get`→GET) and
 *      RestTemplate-style (`getForObject`→GET) raw captures.
 *
 * Entries are deduplicated by `(file, line, method, path)`. The first profile
 * to match a tuple wins (its `framework` is recorded).
 *
 * Only entries whose resolved path looks like a URL or path (contains a slash,
 * an `http(s):` scheme, or a `${placeholder}`) are emitted — this suppresses
 * false positives from broad-receiver patterns (e.g. `cache.get("key")`).
 *
 * Wired into `generateInventory` via the `enableCrossService` block; per-service
 * http_clients are populated by filtering the repo-wide result with `inService()`.
 */
export function detectHttpClients(
  repoRoot: string,
  profiles: readonly ClientProfile[],
): HttpClientEntry[] {
  const out: HttpClientEntry[] = [];
  const seen = new Set<string>();

  for (const profile of profiles) {
    const fileContents = walkCodebase(repoRoot, profile.detection.file_patterns);
    if (Object.keys(fileContents).length === 0) continue;

    const markerPatterns = profile.detection.markers.map((m) => m.pattern);

    for (const [absFile, content] of Object.entries(fileContents)) {
      // Cheap pre-filter: file must contain at least one marker.
      if (
        markerPatterns.length > 0 &&
        !markerPatterns.some((m) => content.includes(m))
      ) {
        continue;
      }

      // Per-file anchor (captured once — first match of each regex).
      let anchorService: string | undefined;
      let anchorPrefix: string | undefined;
      let anchorUrl: string | undefined;

      const fa = profile.client_extraction.file_anchor;
      if (fa) {
        if (fa.service_regex) {
          try {
            const re = new RegExp(fa.service_regex);
            const m = re.exec(content);
            if (m && (fa.service_group ?? 0) > 0) {
              anchorService = m[fa.service_group!] ?? undefined;
            }
          } catch { /* skip bad regex */ }
        }
        if (fa.prefix_regex) {
          try {
            const re = new RegExp(fa.prefix_regex);
            const m = re.exec(content);
            if (m && (fa.prefix_group ?? 0) > 0) {
              anchorPrefix = m[fa.prefix_group!] ?? undefined;
            }
          } catch { /* skip bad regex */ }
        }
        if (fa.url_regex) {
          try {
            const re = new RegExp(fa.url_regex);
            const m = re.exec(content);
            if (m && (fa.url_group ?? 0) > 0) {
              anchorUrl = m[fa.url_group!] ?? undefined;
            }
          } catch { /* skip bad regex */ }
        }
      }

      const lines = content.split("\n");
      const relFile = _toRepoRelative(repoRoot, absFile);

      // Shared emit helper for a single extracted client call.
      const emitClient = (
        ext: (typeof profile.client_extraction.patterns)[number],
        m: RegExpExecArray,
        lineNo: number,
      ): void => {
        const rawVerb =
          ext.method_group > 0
            ? (m[ext.method_group] ?? "")
            : (ext.default_method ?? "");
        const method = _normalizeHttpVerb(rawVerb);

        const rawUrl = m[ext.url_group] ?? "";
        // Feign always concatenates prefix + method-path (even when
        // method-path starts with `/`), so use the feign-aware helper
        // instead of the generic _resolvePath which treats leading-`/`
        // paths as absolute.
        const resolvedPath = anchorPrefix !== undefined
          ? _feignConcatPath(anchorPrefix, rawUrl)
          : _resolvePath(rawUrl, undefined);

        const _perCallHost = _hostFromUrl(rawUrl);
        const target_ref =
          (_perCallHost || undefined) ??
          anchorUrl ??
          anchorService ??
          "";

        if (method.length > 0 && resolvedPath.length > 0 && _looksLikeUrlOrPath(resolvedPath)) {
          const key = `${relFile}|${lineNo}|${method}|${resolvedPath}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              framework: profile.name,
              method,
              target_ref,
              path: resolvedPath,
              file: relFile,
              line: lineNo,
            });
          }
        }
      };

      for (const ext of profile.client_extraction.patterns) {
        let re: RegExp;
        try {
          // Multiline patterns scan the whole file with dotAll so `.` spans
          // newlines (verb and URI on different lines in a fluent chain).
          re = new RegExp(ext.regex, ext.multiline ? "gs" : "g");
        } catch {
          continue;
        }

        if (ext.multiline) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(content)) !== null) {
            // Derive the 1-based line of the captured group (fall back to match start).
            const grpStart =
              m.index + m[0].indexOf(m[ext.url_group] ?? "");
            const idx = m[ext.url_group] ? grpStart : m.index;
            const lineNo = content.slice(0, idx).split("\n").length;
            emitClient(ext, m, lineNo);
            if (m.index === re.lastIndex) re.lastIndex++;
          }
          continue;
        }

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx] ?? "";
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            emitClient(ext, m, lineIdx + 1);
            // Avoid pathological infinite loops on zero-width matches.
            if (m.index === re.lastIndex) re.lastIndex++;
          }
        }
      }
    }
  }

  return out;
}

// ── Queue endpoint detector ─────────────────────────────────────────

/**
 * Shape of a queue/messaging profile (shipped under `agents/lib/queue_profiles/`
 * or supplied inline via `wiki.config.yaml`'s `ecosystem.queues.custom_profiles`).
 * Covers Spring AMQP (RabbitMQ) and Spring Kafka; additional frameworks can
 * be added by dropping a YAML file in the profiles directory.
 *
 * NATS, AWS SQS, GCP Pub/Sub, and raw Redis Streams were evaluated but are
 * intentionally NOT shipped: their call-site markers are too unreliable for
 * pure marker-based detection without configuration-file correlation.
 */
export interface QueueProfile {
  name: string;
  language: string;
  description?: string;
  detection: { file_patterns: string[]; markers: Array<{ pattern: string; type?: string }> };
  queue_extraction: {
    patterns: Array<{
      regex: string;
      role: "producer" | "consumer";
      name_group: number;
      message_type_group?: number;
      /** true ⇒ name_group captured a BARE SYMBOL (constant) → resolve via ResolutionContext.
       *  false/absent ⇒ a quoted-string literal → use as-is (do NOT resolveRef). */
      resolve?: boolean;
      window?: number;
      /** true ⇒ run this regex against the WHOLE file (with the `s` dotAll flag)
       *  rather than per-line. Needed for multi-line callsites whose queue arg
       *  lives on a different line than the method name — e.g. a custom
       *  `sendAndReceive(payload,\n  QUEUE,\n  REPLY,\n  Type.class)` helper, or a
       *  multi-line `@RabbitListener(\n  queues = QUEUE, ...)` annotation. */
      multiline?: boolean;
    }>;
  };
}

function _queueProfilesDir(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "queue_profiles",
  );
}

/**
 * Names of every shipped queue profile under `agents/lib/queue_profiles/`.
 * Sorted for deterministic ordering.
 */
export function discoverShippedQueueProfiles(): string[] {
  const dir = _queueProfilesDir();
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".yaml")) continue;
    out.push(e.name.slice(0, -".yaml".length));
  }
  return out.sort();
}

function _validateQueueProfile(parsed: unknown): QueueProfile | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (
    typeof rec["name"] !== "string" ||
    typeof rec["language"] !== "string" ||
    !rec["detection"] ||
    !rec["queue_extraction"]
  ) {
    return null;
  }
  return rec as unknown as QueueProfile;
}

/**
 * Load a shipped queue profile by name (e.g. `"spring_amqp"`, `"spring_kafka"`).
 * Returns `null` when the YAML is missing, malformed, or fails minimal shape validation.
 */
export function loadQueueProfile(name: string): QueueProfile | null {
  const profilePath = path.join(_queueProfilesDir(), `${name}.yaml`);
  if (!fs.existsSync(profilePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(profilePath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return null;
  }
  return _validateQueueProfile(parsed);
}

/**
 * Read `ecosystem.queues.custom_profiles` from `wiki.config.yaml` and
 * return every entry that validates as a `QueueProfile`. Returns `[]` when
 * the config file is missing, malformed, or the key is absent.
 */
export function loadCustomQueueProfiles(wikiConfigPath: string): QueueProfile[] {
  if (!fs.existsSync(wikiConfigPath)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(wikiConfigPath, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const ecosystem = (parsed as Record<string, unknown>)["ecosystem"];
  if (!ecosystem || typeof ecosystem !== "object" || Array.isArray(ecosystem)) {
    return [];
  }
  const queues = (ecosystem as Record<string, unknown>)["queues"];
  if (!queues || typeof queues !== "object" || Array.isArray(queues)) {
    return [];
  }
  const customRaw = (queues as Record<string, unknown>)["custom_profiles"];
  if (!Array.isArray(customRaw)) return [];
  const out: QueueProfile[] = [];
  for (const entry of customRaw) {
    const validated = _validateQueueProfile(entry);
    if (validated) out.push(validated);
  }
  return out;
}

/**
 * Resolve the set of {@link QueueProfile} objects to scan with. When
 * `profileNames` is empty/undefined, returns ALL shipped profiles plus any
 * custom profiles from `wikiConfigPath`. Custom profiles win on name collision.
 */
export function resolveQueueProfiles(options: {
  profileNames?: readonly string[];
  wikiConfigPath?: string;
}): QueueProfile[] {
  const out: QueueProfile[] = [];
  const seen = new Set<string>();

  // 1. Load custom profiles first (so they can override shipped names).
  const custom = options.wikiConfigPath
    ? loadCustomQueueProfiles(options.wikiConfigPath)
    : [];
  for (const p of custom) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }

  // 2. Load shipped profiles.
  const names =
    options.profileNames && options.profileNames.length > 0
      ? [...options.profileNames]
      : discoverShippedQueueProfiles();
  for (const name of names) {
    if (seen.has(name)) continue;
    const loaded = loadQueueProfile(name);
    if (loaded) {
      seen.add(loaded.name);
      out.push(loaded);
    }
  }

  return out;
}

/**
 * Scan the repo for message-queue produce/consume callsites matching any of
 * the given {@link QueueProfile}s. Three-stage per profile: walkCodebase with
 * the profile's file_patterns, marker pre-filter (cheap substring), then
 * per-line regex extraction.
 *
 * For each pattern match:
 *   - If `pattern.resolve === true` and a ResolutionContext is supplied, the
 *     captured group is treated as a BARE SYMBOL (constant identifier) and
 *     resolved via `resolveRef`; falls back to the raw symbol when unresolved.
 *   - Otherwise the captured group is a quoted-string literal and used as-is
 *     (do NOT pass literals to resolveRef — they fail the UPPER_SNAKE guard
 *     and would wrongly return undefined for lowercase names like "events").
 *
 * Entries are deduplicated by `(file, line, role, queue_name)`. The first
 * profile to match a tuple wins.
 *
 * Wired into `generateInventory` via the `enableCrossService` block. When
 * called without a `ctx`, symbol-typed names are left as raw captured values;
 * `generateInventory` resolves them per-service using a service-scoped context
 * (own files + shared-library files) to avoid cross-service constant bleed.
 */
export function detectQueueEndpoints(
  repoRoot: string,
  profiles: readonly QueueProfile[],
  ctx?: ResolutionContext,
): QueueEndpointEntry[] {
  const out: QueueEndpointEntry[] = [];
  const seen = new Set<string>();

  for (const profile of profiles) {
    const fileContents = walkCodebase(repoRoot, profile.detection.file_patterns);
    if (Object.keys(fileContents).length === 0) continue;

    const markerPatterns = profile.detection.markers.map((m) => m.pattern);

    for (const [absFile, content] of Object.entries(fileContents)) {
      // Cheap pre-filter: file must contain at least one marker.
      if (
        markerPatterns.length > 0 &&
        !markerPatterns.some((m) => content.includes(m))
      ) {
        continue;
      }

      const lines = content.split("\n");
      const relFile = _toRepoRelative(repoRoot, absFile);

      // Emit one endpoint from a successful regex match at a given 1-based line.
      const emit = (
        pat: (typeof profile.queue_extraction.patterns)[number],
        m: RegExpExecArray,
        lineNo: number,
      ): void => {
        const captured = m[pat.name_group] ?? "";
        if (!captured) return;
        // Literal vs. symbol: only call resolveRef on bare symbols.
        const queue_name =
          pat.resolve === true && ctx ? (resolveRef(captured, ctx) ?? captured) : captured;
        const message_type =
          pat.message_type_group != null ? (m[pat.message_type_group] ?? undefined) : undefined;
        const key = `${relFile}|${lineNo}|${pat.role}|${queue_name}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
          framework: profile.name,
          role: pat.role,
          queue_name,
          ...(message_type !== undefined ? { message_type } : {}),
          file: relFile,
          line: lineNo,
        });
      };

      for (const pat of profile.queue_extraction.patterns) {
        let re: RegExp;
        try {
          // Multiline patterns scan the whole file with dotAll so `.` spans
          // newlines (queue arg on a different line than the method name).
          re = new RegExp(pat.regex, pat.multiline ? "gs" : "g");
        } catch {
          continue;
        }

        if (pat.multiline) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(content)) !== null) {
            // Derive the 1-based line of the captured group (fall back to match start).
            const grpStart =
              m.index + m[0].indexOf(m[pat.name_group] ?? "");
            const idx = m[pat.name_group] ? grpStart : m.index;
            const lineNo = content.slice(0, idx).split("\n").length;
            emit(pat, m, lineNo);
            if (m.index === re.lastIndex) re.lastIndex++;
          }
          continue;
        }

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx] ?? "";
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            emit(pat, m, lineIdx + 1);
            // Avoid pathological infinite loops on zero-width matches.
            if (m.index === re.lastIndex) re.lastIndex++;
          }
        }
      }
    }
  }

  return out;
}

// ── Queue binding detector (exchange→queue indirection) ──────────────

/** Source globs scanned for RabbitMQ `Binding` declarations (Spring AMQP is Java/Kotlin). */
const _BINDING_FILE_GLOBS: readonly string[] = ["**/*.java", "**/*.kt"];

/** Cheap pre-filter: a file must contain at least one of these to host a binding. */
const _BINDING_MARKERS: readonly string[] = ["BindingBuilder", "@QueueBinding"];

/**
 * Build a per-file map of `@Bean` method name → the Queue/Exchange string name
 * it declares. Spring AMQP's `BindingBuilder.bind(mainQueue).to(mainExchange)`
 * references the BEAN METHODS `mainQueue`/`mainExchange` (not the string names),
 * so to resolve the binding triple we first resolve each bean method to the name
 * literal it constructs:
 *   `@Bean public Queue mainQueue(){ return QueueBuilder.durable(MAIN_QUEUE)... }`
 *   `@Bean public DirectExchange mainExchange(){ return new DirectExchange(EXCHANGE); }`
 * The constructor arg (a literal or UPPER_SNAKE constant) is resolved via `ctx`.
 */
function _buildBeanNameMap(
  content: string,
  ctx: ResolutionContext | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  // @Bean ... <ReturnType> methodName() { ... <NameSource(arg)> ... }
  // Capture the method name and the FIRST queue/exchange-name argument in its body.
  const beanRe =
    /@Bean[\s\S]{0,200}?\b(?:public\s+)?(?:[\w.<>]+\s+)?(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
  // Inside a bean body, the name comes from QueueBuilder.durable(X) / QueueBuilder.nonDurable(X)
  // / new Queue(X) / new DirectExchange(X) / new TopicExchange(X) / new FanoutExchange(X) /
  // new HeadersExchange(X) / ExchangeBuilder.*Exchange(X).
  const nameArgRe =
    /(?:QueueBuilder\.\w+|new\s+(?:Queue|DirectExchange|TopicExchange|FanoutExchange|HeadersExchange|CustomExchange)|ExchangeBuilder\.\w+Exchange)\s*\(\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))/;
  let m: RegExpExecArray | null;
  beanRe.lastIndex = 0;
  while ((m = beanRe.exec(content)) !== null) {
    const methodName = m[1];
    const body = m[2] ?? "";
    if (!methodName) continue;
    const nm = nameArgRe.exec(body);
    if (!nm) continue;
    const raw = nm[1] ?? nm[2] ?? nm[3] ?? "";
    if (!raw) continue;
    const resolved = _resolveBindingToken(raw, ctx);
    if (resolved) map.set(methodName, resolved);
  }
  return map;
}

/**
 * Resolve a single binding token (queue / exchange / routing-key reference) to a
 * literal. A token may be:
 *   - already a quoted literal (handled by the caller before this is reached), or
 *   - an UPPER_SNAKE constant → `ctx.constants`, or
 *   - a `${prop}` reference → `ctx.properties`, or
 *   - a bare camelCase bean-method name → resolved by the caller via the bean map.
 * Returns the resolved literal, or "" when unresolvable.
 */
function _resolveBindingToken(raw: string, ctx: ResolutionContext | undefined): string {
  if (!raw) return "";
  // Drop a trailing `.build()`-style member access if present (e.g. "MAIN_QUEUE").
  const ref = raw.trim();
  if (ctx) {
    const resolved = resolveRef(ref, ctx);
    if (resolved !== undefined) return resolved;
  }
  // No ctx, or unresolved: treat a bare lowercase identifier as unknown (""),
  // but pass through anything that already looks like a concrete name.
  if (/^[A-Z][A-Z0-9_]*$/.test(ref)) return ""; // unresolved constant
  if (ref.startsWith("${") || ref.startsWith("`")) return ""; // unresolved interpolation
  if (/^\w+$/.test(ref)) return ""; // bare identifier (bean ref / unknown symbol)
  return ref; // concrete literal with non-word chars (already a name)
}

/**
 * Detect RabbitMQ exchange→queue bindings so `buildServiceGraph` can bridge a
 * producer keyed on an exchange / routing key to the bound queue a consumer's
 * `@RabbitListener` reads. Two idioms (both common in real-world Spring repos):
 *
 *   1. `BindingBuilder.bind(Q).to(E).with(RK)` — fluent, usually multi-line.
 *      Q/E may be inline literals (`new Queue("q")`), UPPER_SNAKE constants, or
 *      `@Bean` METHOD NAMES (`mainQueue`). Bean names are resolved to the string
 *      the bean constructs via `_buildBeanNameMap`; constants via `ctx`.
 *   2. `@QueueBinding(value=@Queue("q"), exchange=@Exchange("e"), key="rk")` —
 *      Spring's declarative listener binding (multi-line).
 *
 * Called WITHOUT a `ctx` it leaves constant-typed tokens unresolved (dropped);
 * `generateInventory` calls it per-service with a service-scoped `ctx` (own +
 * shared-library files), mirroring `detectQueueEndpoints`. Only fully-resolved
 * triples (queue + exchange both non-empty) are emitted — precision over recall.
 */
export function detectQueueBindings(
  repoRoot: string,
  ctx?: ResolutionContext,
): QueueBindingEntry[] {
  const fileContents = walkCodebase(repoRoot, _BINDING_FILE_GLOBS);
  const out: QueueBindingEntry[] = [];
  const seen = new Set<string>();

  // BindingBuilder.bind(Q).to(E).with(RK) — multi-line, [\s\S] between calls.
  // Q/E capture either a quoted literal or a bare symbol/bean-method/constant.
  const builderRe =
    /BindingBuilder\s*\.\s*bind\s*\(\s*(?:new\s+\w+\s*\(\s*)?(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))[\s\S]*?\.\s*to\s*\(\s*(?:new\s+\w+\s*\(\s*)?(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))[\s\S]*?\.\s*with\s*\(\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))/g;

  // @QueueBinding(value=@Queue("q"|CONST), exchange=@Exchange("e"|CONST), key="rk"|CONST)
  // Multi-line; @Queue / @Exchange may carry extra attrs (value = "...", durable=...).
  const annoRe =
    /@QueueBinding\s*\([\s\S]*?@Queue\s*\(\s*(?:value\s*=\s*)?(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))[\s\S]*?@Exchange\s*\(\s*(?:value\s*=\s*)?(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))[\s\S]*?\bkey\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))/g;

  for (const [absFile, content] of Object.entries(fileContents)) {
    if (!_BINDING_MARKERS.some((mk) => content.includes(mk))) continue;
    const relFile = _toRepoRelative(repoRoot, absFile);
    const beanMap = _buildBeanNameMap(content, ctx);

    // Resolve a captured (literal | symbol) token: literal wins; else bean map;
    // else constant/property via ctx. Returns "" when unresolvable.
    const resolveToken = (
      lit: string | undefined,
      sym: string | undefined,
    ): string => {
      if (lit) return lit;
      if (!sym) return "";
      return beanMap.get(sym) ?? _resolveBindingToken(sym, ctx);
    };

    const emit = (
      queue_name: string,
      exchange: string,
      routing_key: string,
      idx: number,
    ): void => {
      // A binding needs at least a real queue AND a real exchange to bridge.
      if (!queue_name || !exchange) return;
      const line = content.slice(0, idx).split("\n").length;
      const key = `${relFile}|${line}|${queue_name}|${exchange}|${routing_key}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ queue_name, exchange, routing_key, file: relFile, line });
    };

    builderRe.lastIndex = 0;
    let bm: RegExpExecArray | null;
    while ((bm = builderRe.exec(content)) !== null) {
      const queue_name = resolveToken(bm[1] ?? bm[2], bm[3]);
      const exchange = resolveToken(bm[4] ?? bm[5], bm[6]);
      const routing_key = resolveToken(bm[7] ?? bm[8], bm[9]);
      emit(queue_name, exchange, routing_key, bm.index);
      if (bm.index === builderRe.lastIndex) builderRe.lastIndex++;
    }

    annoRe.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = annoRe.exec(content)) !== null) {
      const queue_name = resolveToken(am[1] ?? am[2], am[3]);
      const exchange = resolveToken(am[4] ?? am[5], am[6]);
      const routing_key = resolveToken(am[7] ?? am[8], am[9]);
      emit(queue_name, exchange, routing_key, am.index);
      if (am.index === annoRe.lastIndex) annoRe.lastIndex++;
    }
  }

  return out;
}

// ── Generate, persist, load ─────────────────────────────────────────

export interface GenerateOptions {
  /** Default true. Set false to skip ORM detection entirely. */
  enableOrm?: boolean;
  /** Default false. Set true to enable REST endpoint detection. */
  enableRest?: boolean;
  /**
   * Shipped-profile names to scan with. When omitted/empty, ALL shipped
   * profiles run (`discoverShippedRestProfiles()`) PLUS any custom
   * profiles loaded from `wikiConfigPath`'s
   * `ecosystem.rest.custom_profiles` slot.
   */
  restProfiles?: readonly string[];
  /**
   * Path to `wiki.config.yaml` for custom-profile loading. When omitted,
   * the inventory does not load custom profiles.
   */
  wikiConfigPath?: string;
  /**
   * Default false. When true, discover services and emit per-service inventory.
   */
  enableCrossService?: boolean;
  /**
   * Path to .connectors/config.yaml for the configured-connector cross-reference.
   * Default searches ./ then ~/.connectors/config.yaml.
   */
  connectorsConfigPath?: string;
}

/**
 * Build a {@link CodeInventory} for a single atlas run. Pure function —
 * no disk writes. Use {@link persistInventory} to write to the canonical
 * `<wikiRoot>/outputs/atlas/<runId>/code-inventory.json`.
 */
export function generateInventory(
  repoRoot: string,
  runId: string,
  options: GenerateOptions = {},
): CodeInventory {
  const startTs = Date.now();
  const notes: string[] = [];

  const project_metadata = detectProjectMetadata(repoRoot, notes);

  const orm_entities =
    options.enableOrm !== false ? detectOrmEntities(repoRoot) : [];

  let rest_endpoints: RestEndpointEntry[] = [];
  // Cross-service detection requires REST endpoints: `calls` edges join a client's
  // path to the target service's endpoints. Enabling cross-service implies enabling
  // REST so callers (and the atlas --cross-service flag) can't silently produce an
  // endpoint-less, calls-less graph.
  if (options.enableRest === true || options.enableCrossService === true) {
    const profiles = resolveRestProfiles({
      profileNames: options.restProfiles,
      wikiConfigPath: options.wikiConfigPath,
    });
    rest_endpoints = detectRestEndpoints(repoRoot, profiles);
  }

  const code_clients = detectCodeClients(repoRoot);

  // Per-service breakdown (only when enableCrossService is set).
  let services: ServiceInventory[] = [];
  if (options.enableCrossService === true) {
    const discovered = discoverServices(repoRoot);

    // Detect repo-wide ONCE, then partition per service via inService().
    // Mirrors the existing orm_entities / rest_endpoints filtering pattern.
    const clientProfiles = resolveClientProfiles({ wikiConfigPath: options.wikiConfigPath });
    const queueProfiles = resolveQueueProfiles({ wikiConfigPath: options.wikiConfigPath });

    // Walk config + source files PER SERVICE ROOT (not once repo-wide).
    // A single repo-wide walk shares one MAX_FILES budget across the whole
    // monorepo; in a large (30+-service, thousands-of-files) tree the DFS
    // exhausts that budget before reaching most services, so their queue
    // endpoints and constant definitions are never seen (queue recall → 0%).
    // Walking each discovered root separately gives every service its own
    // budget. Keys are ABSOLUTE paths — walkCodebase returns abs keys;
    // buildResolutionContext only checks file extensions, so abs keys are fine.
    const CONFIG_GLOBS = [
      "**/application*.yml",
      "**/application*.yaml",
      "**/application*.properties",
      "**/bootstrap*.yml",
      "**/bootstrap*.yaml",
    ];
    const CONST_GLOBS = [
      "**/*.java", "**/*.kt", "**/*.ts", "**/*.js", "**/*.go", "**/*.py",
    ];
    // Per-service budget — generous enough for a single large service's tree
    // while still bounding pathological repos.
    const PER_ROOT_MAX_FILES = 5000;

    const configFiles: Record<string, string> = {};
    const constSource: Record<string, string> = {};
    const allHttpClients: ReturnType<typeof detectHttpClients> = [];
    const allQueueEndpoints: ReturnType<typeof detectQueueEndpoints> = [];

    // Detectors compute their `file` field relative to the root they are
    // handed. Since we hand them per-service ABSOLUTE roots, their `file`
    // fields come back relative to that service root; re-prefix them with the
    // service's repo-relative root so downstream inService(e.file) (which
    // matches against the repo-relative svcRoot) works unchanged.
    const rebaseFile = <T extends { file: string }>(svcRootPosix: string, e: T): T =>
      ({ ...e, file: e.file ? `${svcRootPosix}/${e.file}` : svcRootPosix });

    for (const svc of discovered) {
      const svcRootPosix = svc.root.replace(/\\/g, "/");
      const svcAbsRoot = path.join(repoRoot, svc.root);
      Object.assign(
        configFiles,
        walkCodebase(svcAbsRoot, CONFIG_GLOBS, { maxFiles: PER_ROOT_MAX_FILES }),
      );
      Object.assign(
        constSource,
        walkCodebase(svcAbsRoot, CONST_GLOBS, { maxFiles: PER_ROOT_MAX_FILES }),
      );
      // Detect queue endpoints + HTTP clients per root WITHOUT a ctx so raw
      // symbols stay as bare identifiers (e.g. "Q", "SHARED_Q"). Resolution
      // happens per-service below using a service-scoped context (own files +
      // shared-library files). detectQueueEndpoints walks internally with its
      // own budget; scoping the root keeps that budget per-service too.
      allHttpClients.push(
        ...detectHttpClients(svcAbsRoot, clientProfiles).map((e) => rebaseFile(svcRootPosix, e)),
      );
      allQueueEndpoints.push(
        ...detectQueueEndpoints(svcAbsRoot, queueProfiles).map((e) => rebaseFile(svcRootPosix, e)),
      );
    }

    // External sources: DB datasource URLs + cloud-SDK imports (per-service) +
    // narai-primitives gather()/fetchWithCaps() callsites (from code_clients).
    // Run detectExternalSources per discovered service root — mirrors the
    // per-service client/queue walk pattern above — so each service gets its
    // own MAX_FILES budget rather than sharing a single repo-wide cap that
    // starves later services on large monorepos.
    const configuredIds = loadConfiguredConnectorIds(options.connectorsConfigPath);
    const allExternal: ExternalSourceEntry[] = [];
    for (const svc of discovered) {
      const svcRootPosix = svc.root.replace(/\\/g, "/");
      const svcAbsRoot = path.join(repoRoot, svc.root);
      // detectExternalSources returns paths relative to the root it is given
      // (svcAbsRoot). Rebase each entry's `file` to repo-relative so that the
      // inService() predicate (which matches against the repo-relative svcRoot)
      // continues to work unchanged.
      const svcEntries = detectExternalSources(svcAbsRoot).map((e) =>
        rebaseFile(svcRootPosix, e),
      );
      allExternal.push(...svcEntries);
    }
    const gatherExternal: ExternalSourceEntry[] = code_clients.map((c) => ({
      kind: "narai_gather" as const,
      detail: c.kind,          // "gather" | "fetchWithCaps"
      connector_id: "",        // narai-gather is the hub, not a single connector
      configured: false,
      file: c.file,
      line: c.line,
    }));
    const allExternalAll = [...allExternal, ...gatherExternal];

    // Partition walked files by service root. A file belongs to a service when
    // its repo-relative path is the root itself or starts with "<root>/".
    // Uses the same normalization as the inService() predicate.
    function partitionByOwner(
      walked: Record<string, string>,
      rootPosix: string,
    ): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [absPath, content] of Object.entries(walked)) {
        const rel = path.relative(repoRoot, absPath).split(path.sep).join("/");
        if (rel === rootPosix || rel.startsWith(rootPosix + "/")) {
          out[absPath] = content;
        }
      }
      return out;
    }

    // Files under any library service root — shared across all consuming services.
    const libRoots = discovered
      .filter((s) => s.kind === "library")
      .map((s) => s.root.replace(/\\/g, "/"));

    const libConfigFiles: Record<string, string> = {};
    const libConstSource: Record<string, string> = {};
    for (const libRoot of libRoots) {
      Object.assign(libConfigFiles, partitionByOwner(configFiles, libRoot));
      Object.assign(libConstSource, partitionByOwner(constSource, libRoot));
    }

    notes.push(
      "cross-service queue detection ships RabbitMQ/Kafka/BullMQ; NATS, AWS SQS, GCP Pub/Sub edges, and raw Redis Streams are intentionally not detected (marker-based detection too unreliable — see plan Phase B).",
    );

    services = discovered.map((identity) => {
      const svcRoot = identity.root.replace(/\\/g, "/");
      const inService = (relFile: string): boolean => {
        const f = relFile.replace(/\\/g, "/");
        return f === svcRoot || f.startsWith(svcRoot + "/");
      };

      // Build a service-scoped resolution context: shared-library files first,
      // then this service's own files (own consts win on name collision).
      const ownConfigFiles = partitionByOwner(configFiles, svcRoot);
      const ownConstSource = partitionByOwner(constSource, svcRoot);
      const svcCtx = buildResolutionContext(
        { ...libConfigFiles, ...ownConfigFiles },
        { ...libConstSource, ...ownConstSource },
      );

      // ── library_deps: pom.xml <dependency> blocks matched against discovered libraries ──
      const libraryServices = discovered.filter((d) => d.kind === "library");
      let library_deps: string[] = [];
      // Use _findServicePom so nested-build-subdir layouts (T5) are handled:
      // e.g. `feed-processor/project/pom.xml` when `identity.root = "feed-processor"`.
      const svcPomPath = _findServicePom(path.join(repoRoot, identity.root));
      if (libraryServices.length > 0 && svcPomPath !== null) {
        try {
          const pomXml = fs.readFileSync(svcPomPath, "utf-8");
          const depIds = _pomDependencyArtifactIds(pomXml);
          const matched = new Set<string>();
          for (const depId of depIds) {
            for (const lib of libraryServices) {
              if (lib.id === depId || lib.aliases.includes(depId)) {
                matched.add(lib.id);
              }
            }
          }
          library_deps = [...matched];
        } catch { /* pom unreadable — leave empty */ }
      }

      // ── auth_issuer: spring.security.oauth2.resourceserver.jwt.issuer-uri ──
      const auth_issuer =
        svcCtx.properties.get("spring.security.oauth2.resourceserver.jwt.issuer-uri") ??
        svcCtx.properties.get("spring.security.oauth2.resourceserver.jwt.issuer_uri") ??
        "";

      return {
        identity,
        project_metadata: detectProjectMetadata(path.join(repoRoot, identity.root)),
        orm_entities: orm_entities.filter((e) => inService(e.source_file)),
        rest_endpoints: rest_endpoints.filter((e) => inService(e.file)),
        http_clients: allHttpClients.filter((e) => inService(e.file)).map((e) => ({
          ...e,
          resolved_target: e.target_ref.startsWith("${")
            ? (resolveRef(e.target_ref, svcCtx) ?? undefined)
            : undefined,
        })),
        queue_endpoints: allQueueEndpoints
          .filter((e) => inService(e.file))
          .map((e) => ({ ...e, queue_name: resolveRef(e.queue_name, svcCtx) ?? e.queue_name })),
        // Exchange→queue bindings, detected with the service-scoped resolution
        // context so bean-method names + UPPER_SNAKE constants resolve to literals.
        // Scoped to the service abs root; `file` rebased to repo-relative.
        queue_bindings: detectQueueBindings(path.join(repoRoot, identity.root), svcCtx)
          .map((e) => ({
            ...e,
            file: e.file ? `${svcRoot}/${e.file}` : svcRoot,
          })),
        external_sources: allExternalAll
          .filter((e) => inService(e.file))
          .map((e) => ({
            ...e,
            configured: e.connector_id.length > 0 && configuredIds.has(e.connector_id),
          })),
        library_deps,
        // Repo-relative path of the pom actually used to derive library_deps.
        // Differs from `<root>/pom.xml` for nested-build-subdir layouts.
        ...(svcPomPath !== null
          ? { pom_path: path.relative(repoRoot, svcPomPath).replace(/\\/g, "/") }
          : {}),
        auth_issuer,
      };
    });
  }

  // files_walked is approximate — each detector walked the repo with its
  // own pattern set, so the union is hard to count cheaply. Sum unique
  // touched paths across the buckets that emit a `file`/`source_file`.
  const touched = new Set<string>();
  for (const e of orm_entities) touched.add(e.source_file);
  for (const e of rest_endpoints) touched.add(e.file);
  for (const e of code_clients) touched.add(e.file);

  return {
    atlas_run_id: runId,
    generated_at: new Date().toISOString(),
    repo_root: path.resolve(repoRoot),
    project_metadata,
    orm_entities,
    rest_endpoints,
    code_clients,
    services,
    stats: {
      files_walked: touched.size,
      files_skipped_for_size: 0,
      duration_ms: Date.now() - startTs,
    },
    notes,
  };
}

/** Canonical on-disk path for a manifest given a wiki root + run id. */
export function inventoryPath(wikiRoot: string, runId: string): string {
  return path.join(wikiRoot, "outputs", "atlas", runId, "code-inventory.json");
}

/**
 * Persist {@link CodeInventory} to {@link inventoryPath}. Creates the
 * containing directory tree. Returns the absolute path written.
 */
export function persistInventory(
  wikiRoot: string,
  inventory: CodeInventory,
): string {
  const target = inventoryPath(wikiRoot, inventory.atlas_run_id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(inventory, null, 2) + "\n");
  return target;
}

/**
 * Read a previously-persisted manifest. Returns `null` on missing file,
 * malformed JSON, or shape mismatch (missing `atlas_run_id` or wrong
 * `atlas_run_id`).
 */
export function loadInventory(
  wikiRoot: string,
  runId: string,
): CodeInventory | null {
  const target = inventoryPath(wikiRoot, runId);
  if (!fs.existsSync(target)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(target, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (rec["atlas_run_id"] !== runId) return null;
  if (
    !rec["project_metadata"] ||
    !Array.isArray(rec["orm_entities"]) ||
    !Array.isArray(rec["rest_endpoints"]) ||
    !Array.isArray(rec["code_clients"])
  ) {
    return null;
  }
  // `services` was added in A5; default to [] so old manifests still load.
  if (!Array.isArray(rec["services"])) {
    rec["services"] = [];
  }
  // `queue_bindings` is optional per-service (added with binding resolution);
  // default to [] so manifests written before it still load + build a graph.
  for (const s of rec["services"] as Array<Record<string, unknown>>) {
    if (s && typeof s === "object" && !Array.isArray((s as Record<string, unknown>)["queue_bindings"])) {
      (s as Record<string, unknown>)["queue_bindings"] = [];
    }
  }
  return parsed as CodeInventory;
}

// ── Helpers ────────────────────────────────────────────────────────

function _toRepoRelative(repoRoot: string, absPath: string): string {
  if (absPath.length === 0) return "";
  const rel = path.relative(repoRoot, absPath);
  return rel.split(path.sep).join("/");
}

/**
 * Run a profile's `file_prefix` regex against the full file content and
 * return the captured prefix string, or `undefined` if the file declares
 * no class-level prefix. When the captured prefix contains the
 * `[controller]` token and the profile asks for it, expand it to the
 * controller class name (lowercased, `Controller` suffix stripped).
 */
function _extractFilePrefix(
  content: string,
  spec: RestProfile["endpoint_extraction"]["file_prefix"],
): string | undefined {
  if (!spec) return undefined;
  let re: RegExp;
  try {
    re = new RegExp(spec.regex);
  } catch {
    return undefined;
  }
  const m = re.exec(content);
  if (!m) return undefined;
  let prefix = m[spec.prefix_group] ?? "";
  if (spec.expand_controller_token && prefix.includes("[controller]")) {
    const classMatch = content.match(
      /\bpublic\s+(?:abstract\s+|sealed\s+|partial\s+|static\s+)*class\s+(\w+?)Controller\b/,
    );
    if (classMatch?.[1]) {
      prefix = prefix.replace(/\[controller\]/g, classMatch[1].toLowerCase());
    }
  }
  return prefix.length > 0 ? prefix : undefined;
}

/**
 * Combine a per-line captured path with the file's class-level prefix.
 * Absolute paths (starting with `/`) bypass the prefix entirely. When
 * the regex captured an empty path (e.g. ASP.NET's `[HttpGet]` with no
 * argument) and a prefix exists, the prefix becomes the full route path.
 */
function _resolvePath(rawPath: string, filePrefix: string | undefined): string {
  if (rawPath.startsWith("/")) return rawPath;
  if (!filePrefix) return rawPath;
  if (rawPath.length === 0) return filePrefix;
  return `${filePrefix.replace(/\/+$/, "")}/${rawPath.replace(/^\/+/, "")}`;
}

/**
 * Read `ecosystem.rest.enabled` from `wiki.config.yaml` at the wiki root
 * (or the parent's `wiki/` subdir). Returns `false` when the flag is
 * absent or the config is missing/malformed — REST detection is opt-in.
 * Mirrors `readCrossValidateFlag` in `agents/wiki-orm-agent/scripts/orm_detect.ts`.
 */
export function _readEcosystemRestEnabled(wikiRoot: string): boolean {
  const candidates = [
    path.join(wikiRoot, "wiki.config.yaml"),
    path.join(wikiRoot, "wiki", "wiki.config.yaml"),
  ];
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    try {
      const parsed = yaml.load(text) as Record<string, unknown> | undefined;
      const eco = parsed?.["ecosystem"] as Record<string, unknown> | undefined;
      const rest = eco?.["rest"] as Record<string, unknown> | undefined;
      const flag = rest?.["enabled"];
      if (typeof flag === "boolean") return flag;
    } catch {
      // malformed YAML — treat as missing
    }
  }
  return false;
}

/**
 * Read `ecosystem.cross_service.enabled` from `wiki.config.yaml` at the wiki
 * root (or the parent's `wiki/` subdir). Returns `true` only when the flag is
 * explicitly set to `true`; `false` for explicit-false, absent, or malformed.
 *
 * NOTE: an absent key no longer means "off" — it means AUTO (cross-service
 * runs when the repo has >=2 services). Callers that need to distinguish
 * absent from explicit-false (to honor AUTO) should use the tri-state
 * {@link _readEcosystemCrossServiceConfig} instead. This boolean wrapper is
 * kept for the orchestrator's config-only cost-estimate fallback.
 */
export function _readEcosystemCrossServiceEnabled(wikiRoot: string): boolean {
  return _readEcosystemCrossServiceConfig(wikiRoot) === true;
}

/**
 * Tri-state read of `ecosystem.cross_service.enabled`: `true` / `false` when
 * the key is explicitly set, `undefined` when absent or the config is
 * missing/malformed. The `undefined` case signals AUTO — the caller decides
 * cross-service from the discovered service count rather than from config.
 */
export function _readEcosystemCrossServiceConfig(
  wikiRoot: string,
): boolean | undefined {
  const candidates = [
    path.join(wikiRoot, "wiki.config.yaml"),
    path.join(wikiRoot, "wiki", "wiki.config.yaml"),
  ];
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    try {
      const parsed = yaml.load(text) as Record<string, unknown> | undefined;
      const eco = parsed?.["ecosystem"] as Record<string, unknown> | undefined;
      const xs = eco?.["cross_service"] as Record<string, unknown> | undefined;
      const flag = xs?.["enabled"];
      if (typeof flag === "boolean") return flag;
    } catch {
      // malformed YAML — treat as missing
    }
  }
  return undefined;
}

/**
 * Resolve whether cross-service detection should run, applying the precedence:
 *
 *   1. `--no-cross-service`        → false  (hard suppress, beats everything)
 *   2. `--cross-service`           → true   (hard force)
 *   3. config `enabled: true`      → true
 *   4. config `enabled: false`     → false
 *   5. AUTO (config absent)        → repo has ≥2 real services
 *
 * AUTO uses {@link countRealServices} on the discovered identities — the same
 * non-synthetic / non-library predicate as `hasServiceTopology` — so a
 * monolith (0/1 service) resolves to false and emits no cross-service docs.
 */
export function resolveCrossService(opts: {
  fromCliEnable: boolean;
  fromCliDisable: boolean;
  config: boolean | undefined;
  serviceCount: number;
}): boolean {
  if (opts.fromCliDisable) return false;
  if (opts.fromCliEnable) return true;
  if (opts.config !== undefined) return opts.config;
  return opts.serviceCount >= 2;
}

// ── CLI ────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--wiki-root": "wikiRoot",
  "--repo-root": "repoRoot",
  "--run-id": "runId",
  "--rest-profile": "restProfile",
  "--rest-profiles": "restProfiles",
} as const;

const _RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

const HELP_TEXT = `usage: atlas_inventory.js generate --wiki-root <p> --repo-root <p> --run-id <id>
                                  [--enable-rest] [--cross-service | --no-cross-service]
                                  [--rest-profiles <csv>] [--rest-profile <name>]

Build the code-inventory manifest for a /doc-wiki:atlas run.

Required:
  --wiki-root <p>      Wiki root (where outputs/atlas/<run-id>/ lives)
  --repo-root <p>      Source repo to inventory
  --run-id <id>        Atlas run id (YYYY-MM-DDTHH-MM-SS)

Optional:
  --enable-rest                Run REST endpoint detection. If absent,
                               the CLI reads ecosystem.rest.enabled from
                               <wiki-root>/wiki.config.yaml (default false).
  --cross-service              Force service discovery + per-service inventory
                               (HTTP clients, queue endpoints, external sources).
                               Implies REST detection. Default is AUTO: cross-
                               service runs automatically when the repo has >=2
                               real services. Precedence:
                                 --no-cross-service > --cross-service >
                                 ecosystem.cross_service.enabled (true|false) >
                                 AUTO (>=2 services).
  --no-cross-service           Suppress cross-service detection entirely, even
                               when >=2 services are present or config enables it.
  --rest-profiles <csv>        Comma-separated profile names. Default: all
                               shipped profiles + custom profiles from
                               <wiki-root>/wiki.config.yaml's
                               ecosystem.rest.custom_profiles.
  --rest-profile <name>        Backwards-compat alias for --rest-profiles
                               with a single value.

Stdout: full manifest JSON with an additional 'written' field naming
the path persisted on disk.
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const sub = argv[0];
  if (sub !== "generate") {
    process.stderr.write(`unknown subcommand: ${sub}\n`);
    return 2;
  }
  // --enable-rest, --cross-service, and --no-cross-service are bare flags;
  // detect them before parseFlags consumes the value-bearing args. The CLI
  // flags always win; if absent, the config-file flag (then AUTO) is consulted
  // after wikiRoot/repoRoot are resolved.
  const enableRestFromCli = argv.includes("--enable-rest");
  const enableCrossServiceFromCli = argv.includes("--cross-service");
  const disableCrossServiceFromCli = argv.includes("--no-cross-service");
  const flagArgs = argv
    .slice(1)
    .filter(
      (a) =>
        a !== "--enable-rest" &&
        a !== "--cross-service" &&
        a !== "--no-cross-service",
    );

  let parsed;
  try {
    parsed = parseFlags(flagArgs, FLAG_SPEC);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const wikiRoot = parsed.values["wikiRoot"];
  const repoRoot = parsed.values["repoRoot"];
  const runId = parsed.values["runId"];
  const restProfileRaw = parsed.values["restProfile"];
  const restProfilesRaw = parsed.values["restProfiles"];

  if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
    process.stderr.write("--wiki-root is required\n");
    return 2;
  }
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    process.stderr.write("--repo-root is required\n");
    return 2;
  }
  if (typeof runId !== "string" || !_RUN_ID_RE.test(runId)) {
    process.stderr.write(
      "--run-id is required and must match YYYY-MM-DDTHH-MM-SS\n",
    );
    return 2;
  }

  // Resolve --rest-profiles (plural csv) > --rest-profile (singular alias).
  // Empty / missing → undefined, which signals "default = all shipped + custom".
  let profileNames: readonly string[] | undefined;
  if (typeof restProfilesRaw === "string" && restProfilesRaw.length > 0) {
    profileNames = restProfilesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } else if (typeof restProfileRaw === "string" && restProfileRaw.length > 0) {
    profileNames = [restProfileRaw];
  }

  // Custom profiles come from <wikiRoot>/wiki.config.yaml. Always
  // attempted; missing file yields an empty list, which the resolver
  // tolerates without complaint.
  const wikiConfigPath = path.join(wikiRoot, "wiki.config.yaml");

  // Resolve the REST-detection flag: CLI > config > default false.
  const enableRest = enableRestFromCli || _readEcosystemRestEnabled(wikiRoot);
  // Resolve cross-service with full precedence:
  //   --no-cross-service > --cross-service > config(true/false) > AUTO(≥2 svcs)
  // AUTO only needs the service count, so run discovery here ONLY when neither
  // a flag nor config decides it — avoids a redundant discoverServices() pass
  // (generateInventory runs its own when enableCrossService resolves true).
  const crossServiceConfig = _readEcosystemCrossServiceConfig(wikiRoot);
  const needsAutoCount =
    !disableCrossServiceFromCli &&
    !enableCrossServiceFromCli &&
    crossServiceConfig === undefined;
  const autoServiceCount = needsAutoCount
    ? countRealServices(discoverServices(repoRoot))
    : 0;
  const enableCrossService = resolveCrossService({
    fromCliEnable: enableCrossServiceFromCli,
    fromCliDisable: disableCrossServiceFromCli,
    config: crossServiceConfig,
    serviceCount: autoServiceCount,
  });

  let inventory: CodeInventory;
  try {
    inventory = generateInventory(repoRoot, runId, {
      enableRest,
      enableCrossService,
      restProfiles: profileNames,
      wikiConfigPath,
    });
  } catch (e) {
    process.stderr.write(
      `inventory generation failed: ${(e as Error).message}\n`,
    );
    return 1;
  }

  let target: string;
  try {
    target = persistInventory(wikiRoot, inventory);
  } catch (e) {
    process.stderr.write(
      `inventory persistence failed: ${(e as Error).message}\n`,
    );
    return 1;
  }

  process.stdout.write(JSON.stringify({ ...inventory, written: target }) + "\n");
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
