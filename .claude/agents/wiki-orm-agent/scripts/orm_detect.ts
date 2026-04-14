#!/usr/bin/env node
/**
 * orm_detect.ts — CLI entry point for the wiki-orm-agent.
 *
 * Thin shim over the wiki_orm library. Walks a codebase directory,
 * detects the ORM profile (or uses a specified one), extracts entities,
 * and emits either database-mapping.md markdown or a structured JSON
 * result matching the AGENT.md contract.
 *
 * CLI usage:
 *   node orm_detect.js --codebase-path <path> [--profile <name|auto>]
 *     [--project-name <name>] [--output-markdown <file>] [--output-json]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

import {
  loadAllProfiles,
  detectOrm,
  type OrmProfile,
} from "../../lib/wiki_orm/profiles.js";
import {
  crossValidate,
  extractEntities,
  type CrossValidationReport,
  type ExtractedEntity,
} from "../../lib/wiki_orm/extractor.js";
import { generateMappingMarkdown } from "../../lib/wiki_orm/output.js";

const DEFAULT_IGNORE: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  ".next",
  ".gradle",
  ".idea",
  ".worktrees",
  "wiki-workspace",
]);

const MAX_FILES = 2000;

/**
 * Compile a shell-style glob pattern to a RegExp that tests against a file's
 * (possibly absolute) path. Supports `*` (single segment), `**` (any number
 * of segments), and `**\/` (zero-or-more parent directories) — the patterns
 * actually used by the shipped ORM profiles.
 */
function compileGlob(pattern: string): RegExp {
  let re = pattern.replace(/[.+^$|()\[\]{}]/g, "\\$&");
  re = re.replace(/\*\*\//g, "(?:.*/)?");
  re = re.replace(/\*\*/g, ".*");
  re = re.replace(/\*/g, "[^/]*");
  return new RegExp("(?:^|/)" + re + "$");
}

const PATTERN_CACHE = new Map<string, RegExp>();

function matchesPattern(fullPath: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    let re = PATTERN_CACHE.get(p);
    if (re === undefined) {
      re = compileGlob(p);
      PATTERN_CACHE.set(p, re);
    }
    if (re.test(fullPath)) return true;
  }
  return false;
}

function walkCodebase(root: string, patterns: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const stack: string[] = [root];
  while (stack.length > 0 && Object.keys(out).length < MAX_FILES) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (DEFAULT_IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && matchesPattern(full, patterns)) {
        try {
          out[full] = fs.readFileSync(full, "utf-8");
        } catch {
          // skip unreadable
        }
      }
    }
  }
  return out;
}

interface ParsedArgs {
  codebasePath?: string;
  profile?: string;
  projectName?: string;
  outputMarkdown?: string;
  outputJson?: boolean;
  env?: string;
  help?: boolean;
}

/**
 * Read `ecosystem.orm.cross_validate_against_db` from `wiki.config.yaml`
 * at the codebase root (or the parent's `wiki/` subdir). Returns `true`
 * when the flag is absent — matches the init_wiki.ts default. Never
 * throws on missing or malformed YAML.
 */
function readCrossValidateFlag(codebasePath: string): boolean {
  const candidates = [
    path.join(codebasePath, "wiki.config.yaml"),
    path.join(codebasePath, "wiki", "wiki.config.yaml"),
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
      const orm = eco?.["orm"] as Record<string, unknown> | undefined;
      const flag = orm?.["cross_validate_against_db"];
      if (typeof flag === "boolean") return flag;
    } catch {
      // malformed YAML — treat as missing
    }
  }
  return true;
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
    if (a === "--output-json") {
      out.outputJson = true;
      i++;
      continue;
    }
    if (!a.startsWith("--")) {
      throw new Error(`unrecognized argument: ${a}`);
    }
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const value = eq >= 0 ? a.slice(eq + 1) : argv[i + 1];
    i = eq >= 0 ? i + 1 : i + 2;
    switch (name) {
      case "codebase-path":
        out.codebasePath = value ?? "";
        break;
      case "profile":
        out.profile = value ?? "";
        break;
      case "project-name":
        out.projectName = value ?? "";
        break;
      case "output-markdown":
        out.outputMarkdown = value ?? "";
        break;
      case "env":
        out.env = value ?? "";
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: orm_detect.js --codebase-path <path> [--profile <name|auto>] [--project-name <name>] [--output-markdown <file>] [--output-json] [--env <name>]

Detect ORM patterns and generate database-mapping.md.

options:
  --codebase-path PATH     Root directory of the codebase
  --profile NAME           ORM profile (jpa|sqlalchemy|django|prisma|typeorm|entity_framework|activerecord|auto); default: auto
  --project-name NAME      Project name used in the generated markdown
  --output-markdown FILE   Write database-mapping.md to FILE
  --output-json            Print the AGENT.md-contract JSON to stdout
  --env NAME               DB environment name to cross-validate against. When
                           set and ecosystem.orm.cross_validate_against_db is
                           true in wiki.config.yaml (default), entity fields
                           are diffed against the live DB schema.
  -h, --help               Show this help and exit
`;

function extractMermaidBlock(
  markdown: string,
): { type: string; title: string; code: string } | null {
  const m = markdown.match(/```mermaid\n([\s\S]*?)```/);
  if (!m || m[1] === undefined) return null;
  const code = m[1];
  const type = code.trim().startsWith("erDiagram") ? "erDiagram" : "unknown";
  return { type, title: "Entity Relationships", code };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
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

  if (!args.codebasePath) {
    process.stderr.write("required: --codebase-path\n");
    return 2;
  }

  const profileArg = args.profile ?? "auto";
  const projectName =
    args.projectName ?? path.basename(path.resolve(args.codebasePath));

  const allProfiles = loadAllProfiles();
  const allPatterns = new Set<string>();
  for (const p of allProfiles) {
    for (const fp of p.file_patterns) allPatterns.add(fp);
  }
  const fileContents = walkCodebase(args.codebasePath, [...allPatterns]);

  let chosenProfile: OrmProfile | undefined;
  if (profileArg === "auto") {
    const detected = detectOrm(fileContents, allProfiles);
    chosenProfile = detected[0];
  } else {
    chosenProfile = allProfiles.find((p) => p.name === profileArg);
    if (chosenProfile === undefined) {
      process.stderr.write(`unknown profile: ${profileArg}\n`);
      return 2;
    }
  }

  if (chosenProfile === undefined) {
    const empty = {
      status: "success",
      orm_detected: null,
      entities: [],
      mapping_file: null,
      mermaid: null,
    };
    if (args.outputJson) {
      process.stdout.write(JSON.stringify(empty, null, 2) + "\n");
    } else {
      process.stdout.write("No ORM profile detected in codebase.\n");
    }
    return 0;
  }

  const entities: ExtractedEntity[] = extractEntities(
    fileContents,
    chosenProfile,
  );

  // G2: cross-validate against live DB when --env is supplied AND the
  // wiki.config.yaml has `ecosystem.orm.cross_validate_against_db: true`
  // (default). Disabling the flag skips validation even with --env.
  let xvalid: CrossValidationReport | undefined;
  if (args.env && readCrossValidateFlag(args.codebasePath)) {
    xvalid = await crossValidate(entities, args.env);
  }

  const markdown = generateMappingMarkdown(
    entities,
    projectName,
    chosenProfile.name,
    undefined,
    undefined,
    xvalid,
  );

  let mappingFile: string | null = null;
  if (args.outputMarkdown) {
    fs.mkdirSync(path.dirname(args.outputMarkdown), { recursive: true });
    fs.writeFileSync(args.outputMarkdown, markdown);
    mappingFile = args.outputMarkdown;
  }

  if (args.outputJson) {
    const result: Record<string, unknown> = {
      status: "success",
      orm_detected: chosenProfile.name,
      entities: entities.map((e) => ({
        class_name: e.class_name,
        table_name: e.table_name,
        schema: e.schema_name,
        columns: e.columns.length,
        relationships: e.relationships.map((r) => r.type),
      })),
      mapping_file: mappingFile,
      mermaid: extractMermaidBlock(markdown),
    };
    if (xvalid !== undefined) result["cross_validation"] = xvalid;
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!args.outputMarkdown) {
    process.stdout.write(markdown);
  }

  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
