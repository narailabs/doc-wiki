import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import type { RepoConfig, ServiceSpec } from "./types.js";

function isoDate(v: unknown): string {
  // js-yaml's default schema parses unquoted YAML timestamps into Date objects.
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function loadRepoConfig(path: string): RepoConfig {
  const raw = load(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error(`${path}: not a YAML mapping`);
  const cfg = raw as Record<string, unknown>;

  const required = [
    "id", "github", "clone_url", "language", "ticket_source",
    "install", "test_command", "test_patterns", "ticket_after", "toolchain",
  ];
  for (const k of required) {
    if (cfg[k] === undefined || cfg[k] === null) throw new Error(`${path}: missing required key "${k}"`);
  }
  if (cfg.ticket_source !== "github" && cfg.ticket_source !== "trac-commits") {
    throw new Error(`${path}: ticket_source must be "github" or "trac-commits"`);
  }
  if (typeof cfg.test_command !== "string" || !cfg.test_command.includes("{test_files}")) {
    throw new Error(`${path}: test_command must contain the "{test_files}" placeholder`);
  }
  if (!Array.isArray(cfg.test_patterns) || cfg.test_patterns.length === 0) {
    throw new Error(`${path}: test_patterns must be a non-empty list`);
  }
  if (!Array.isArray(cfg.install)) throw new Error(`${path}: install must be a list`);
  if (!cfg.install.every((e) => typeof e === "string")) {
    throw new Error(`${path}: every install entry must be a string`);
  }
  if (!Array.isArray(cfg.toolchain)) throw new Error(`${path}: toolchain must be a list`);
  if (!cfg.toolchain.every((e) => typeof e === "string")) {
    throw new Error(`${path}: every toolchain entry must be a string`);
  }

  const ticketAfter = isoDate(cfg.ticket_after);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ticketAfter)) {
    throw new Error(`${path}: ticket_after must be YYYY-MM-DD, got "${ticketAfter}"`);
  }

  const retries = cfg.test_retries === undefined ? 0 : Number(cfg.test_retries);
  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error(`${path}: test_retries must be a non-negative integer`);
  }

  const optionalPatternList = (key: "run_patterns" | "exclude_test_paths"): string[] | undefined => {
    const v = cfg[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || !v.every((e) => typeof e === "string")) {
      throw new Error(`${path}: ${key} must be a list of strings`);
    }
    return v.map(String);
  };
  const runPatterns = optionalPatternList("run_patterns");
  const excludeTestPaths = optionalPatternList("exclude_test_paths");

  // Parse services: must be a list of {name, image} objects, NOT bare strings.
  const rawServices = cfg.services;
  let services: ServiceSpec[] = [];
  if (rawServices !== undefined && rawServices !== null) {
    if (!Array.isArray(rawServices)) throw new Error(`${path}: services must be a list of {name, image} objects`);
    for (const svc of rawServices) {
      if (typeof svc === "string") {
        throw new Error(`${path}: services must be a list of {name, image} objects (got a bare string "${svc}")`);
      }
      if (typeof svc !== "object" || svc === null) {
        throw new Error(`${path}: services must be a list of {name, image} objects`);
      }
      const s = svc as Record<string, unknown>;
      if (typeof s.name !== "string" || s.name === "") throw new Error(`${path}: each service must have a string "name"`);
      if (typeof s.image !== "string" || s.image === "") throw new Error(`${path}: each service must have a string "image"`);
      const env: Record<string, string> = {};
      if (s.env !== undefined && s.env !== null) {
        if (typeof s.env !== "object" || Array.isArray(s.env)) {
          throw new Error(`${path}: service "${s.name}" env must be a string→string map`);
        }
        for (const [k, v] of Object.entries(s.env as Record<string, unknown>)) {
          if (typeof v !== "string") throw new Error(`${path}: service "${s.name}" env["${k}"] must be a string`);
          env[k] = v;
        }
      }
      const ready = s.ready === undefined ? undefined : String(s.ready);
      services.push({ name: s.name, image: s.image, env, ready });
    }
  }

  // Parse container_env: optional string→string map.
  const container_env: Record<string, string> = {};
  if (cfg.container_env !== undefined && cfg.container_env !== null) {
    if (typeof cfg.container_env !== "object" || Array.isArray(cfg.container_env)) {
      throw new Error(`${path}: container_env must be a string→string map`);
    }
    for (const [k, v] of Object.entries(cfg.container_env as Record<string, unknown>)) {
      if (typeof v !== "string") throw new Error(`${path}: container_env["${k}"] must be a string`);
      container_env[k] = v;
    }
  }

  // Parse system_packages: optional list of strings.
  const system_packages: string[] = [];
  if (cfg.system_packages !== undefined && cfg.system_packages !== null) {
    if (!Array.isArray(cfg.system_packages) || !cfg.system_packages.every((e) => typeof e === "string")) {
      throw new Error(`${path}: system_packages must be a list of strings`);
    }
    system_packages.push(...cfg.system_packages.map(String));
  }

  return {
    id: String(cfg.id),
    github: String(cfg.github),
    clone_url: String(cfg.clone_url),
    language: String(cfg.language),
    ticket_source: cfg.ticket_source,
    install: cfg.install.map(String),
    test_command: cfg.test_command,
    test_patterns: cfg.test_patterns.map(String),
    run_patterns: runPatterns ?? cfg.test_patterns.map(String),
    exclude_test_paths: excludeTestPaths ?? [],
    test_retries: retries,
    ticket_after: ticketAfter,
    wiki_commit: cfg.wiki_commit === undefined ? "" : String(cfg.wiki_commit),
    toolchain: cfg.toolchain.map(String),
    services,
    container_env,
    system_packages,
  };
}
