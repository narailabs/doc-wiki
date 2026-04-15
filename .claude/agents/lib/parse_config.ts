#!/usr/bin/env node
/**
 * Parse and validate wiki.config.yaml, outputting the full config as JSON.
 *
 * Usage:
 *     node parse_config.js --config <path-to-wiki.config.yaml>
 *
 * Exits 0 on success (JSON to stdout), 1 on validation failure (error to stderr).
 *
 * This is a TypeScript port of parse_config.py; behavior matches the Python
 * reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const VALID_AUTONOMY_MODES: ReadonlySet<string> = new Set([
  "conservative",
  "balanced",
  "autonomous",
  "auto",
]);

const DEFAULTS = {
  wiki: {
    domain: "general",
    maxDepth: 3,
  },
  autonomy: {
    mode: "balanced",
  },
} as const;

/** A wiki config dict after defaults have been applied. Kept loose on purpose
 *  to mirror the dynamic dict shape the Python reference returns. */
export type WikiConfig = Record<string, unknown>;

/** Thrown when the wiki config path does not exist. */
export class ConfigFileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigFileNotFoundError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" && v !== null && !Array.isArray(v) && v.constructor === Object
  );
}

/**
 * Parse and validate a wiki.config.yaml file.
 *
 * @param configPath Path to the YAML config file.
 * @returns Validated config dict with defaults applied.
 * @throws {ConfigFileNotFoundError} If the config file does not exist.
 * @throws {Error} If the YAML is malformed or required fields are missing.
 */
export function parseConfig(configPath: string): WikiConfig {
  if (!fs.existsSync(configPath)) {
    throw new ConfigFileNotFoundError(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, { encoding: "utf-8" });

  let config: unknown;
  try {
    config = yaml.load(raw);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    throw new Error(`Failed to parse YAML: ${msg}`);
  }

  if (!isPlainObject(config)) {
    const typeName = config === null
      ? "NoneType"
      : Array.isArray(config)
        ? "list"
        : typeof config;
    throw new Error(`Config must be a YAML mapping, got: ${typeName}`);
  }

  // --- Required: wiki section ---
  const wikiSection = config["wiki"];
  if (!("wiki" in config) || !isPlainObject(wikiSection)) {
    throw new Error("Config must contain a 'wiki' section (mapping)");
  }

  const wiki = wikiSection;

  // --- Required: wiki.name ---
  const name = wiki["name"];
  if (!("name" in wiki) || !name) {
    throw new Error("'wiki.name' is required but missing or empty");
  }

  // --- Apply wiki defaults ---
  if (!("domain" in wiki)) {
    wiki["domain"] = DEFAULTS.wiki.domain;
  }
  if (!("max_depth" in wiki)) {
    wiki["max_depth"] = DEFAULTS.wiki.maxDepth;
  }

  // --- Apply autonomy defaults ---
  if (!("autonomy" in config) || !isPlainObject(config["autonomy"])) {
    config["autonomy"] = {};
  }
  const autonomy = config["autonomy"] as Record<string, unknown>;
  if (!("mode" in autonomy)) {
    autonomy["mode"] = DEFAULTS.autonomy.mode;
  }

  // --- Validate autonomy.mode ---
  const mode = autonomy["mode"];
  if (typeof mode !== "string" || !VALID_AUTONOMY_MODES.has(mode)) {
    const sorted = [...VALID_AUTONOMY_MODES].sort().join(", ");
    throw new Error(
      `Invalid autonomy mode '${mode}'. Valid modes: ${sorted}`,
    );
  }

  return config;
}

interface ParsedArgs {
  config?: string;
  help?: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) {
      i++;
      continue;
    }
    if (a === "-h" || a === "--help") {
      out.help = true;
      i++;
      continue;
    }
    let name: string;
    let value: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
        i++;
      } else {
        name = a.slice(2);
        value = argv[i + 1];
        i += 2;
      }
    } else {
      throw new Error(`unrecognized argument: ${a}`);
    }
    switch (name) {
      case "config":
        out.config = value ?? "";
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: parse_config.js [-h] --config CONFIG

Parse wiki.config.yaml

options:
  -h, --help       show this help message and exit
  --config CONFIG  Path to wiki.config.yaml
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (!args.config) {
    process.stderr.write(
      "the following arguments are required: --config\n",
    );
    return 2;
  }

  try {
    const config = parseConfig(args.config);
    process.stdout.write(JSON.stringify(config, null, 2) + "\n");
    return 0;
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    process.stderr.write(JSON.stringify({ error: msg }) + "\n");
    return 1;
  }
}

// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
