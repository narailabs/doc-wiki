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

  return {
    name,
    version,
    language,
    runtime,
    manifests_seen: manifestsSeen,
  };
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
    patterns: Array<{
      regex: string;
      method_group: number;
      path_group: number;
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
            const method = (m[ext.method_group] ?? "").toUpperCase();
            const apiPath = m[ext.path_group] ?? "";
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
  if (options.enableRest === true) {
    const profiles = resolveRestProfiles({
      profileNames: options.restProfiles,
      wikiConfigPath: options.wikiConfigPath,
    });
    rest_endpoints = detectRestEndpoints(repoRoot, profiles);
  }

  const code_clients = detectCodeClients(repoRoot);

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
  return parsed as CodeInventory;
}

// ── Helpers ────────────────────────────────────────────────────────

function _toRepoRelative(repoRoot: string, absPath: string): string {
  if (absPath.length === 0) return "";
  const rel = path.relative(repoRoot, absPath);
  return rel.split(path.sep).join("/");
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
                                  [--enable-rest] [--rest-profiles <csv>]
                                  [--rest-profile <name>]

Build the code-inventory manifest for a /doc-wiki:atlas run.

Required:
  --wiki-root <p>      Wiki root (where outputs/atlas/<run-id>/ lives)
  --repo-root <p>      Source repo to inventory
  --run-id <id>        Atlas run id (YYYY-MM-DDTHH-MM-SS)

Optional:
  --enable-rest                Run REST endpoint detection (off by default)
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
  // --enable-rest is a bare flag; detect it before parseFlags consumes
  // the value-bearing args.
  const enableRest = argv.includes("--enable-rest");
  const flagArgs = argv.slice(1).filter((a) => a !== "--enable-rest");

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

  let inventory: CodeInventory;
  try {
    inventory = generateInventory(repoRoot, runId, {
      enableRest,
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
