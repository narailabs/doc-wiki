#!/usr/bin/env node
/**
 * init_wiki -- Create the directory scaffold and default config for a
 * documentation wiki.
 *
 * Usage:
 *   node init_wiki.js --path /path/to/wiki-root [--domain general] [--name "My Wiki"]
 *
 * The script is idempotent: existing directories are kept, existing config is
 * not overwritten, and existing wiki files are preserved.
 *
 * This is a TypeScript port of init_wiki.py; stdout JSON, on-disk scaffold,
 * and idempotency semantics match the Python reference byte-for-byte.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { pythonJsonDumps } from "./_json_py.js";
import { parseFlags } from "./_cli_args.js";

// ── Constants ───────────────────────────────────────────────────────

const SCAFFOLD_DIRS: readonly string[] = [
  "wiki",
  "raw",
  "graph",
  "audit/open",
  "audit/resolved",
  "log/daily",
  "outputs/queries",
  "outputs/reports",
  ".wiki-cache",
];

const WIKI_IGNORE_DEFAULTS: readonly string[] = [
  "__pycache__/",
  ".git/",
  "node_modules/",
  ".DS_Store",
  "*.pyc",
];

/** Initial seeded pages under wiki/. Insertion order matches Python's dict
 *  literal so `created_files` lists them in the same order. */
const INITIAL_WIKI_FILES: ReadonlyArray<[string, string]> = [
  ["wiki/index.md", "# Index\n\nWiki entry point.\n"],
  ["wiki/summaries.md", "# Summaries\n\nHigh-level summaries of wiki topics.\n"],
  ["wiki/overview.md", "# Overview\n\nOverview of the knowledge domain.\n"],
];

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Return the default wiki.config.yaml structure. Key order MUST match
 * _build_config() in init_wiki.py — PyYAML emits keys in insertion order
 * when `sort_keys=False`, so we preserve the same nesting shape here.
 */
function buildConfig(domain: string, name: string): Record<string, unknown> {
  return {
    wiki: {
      name,
      domain,
      max_depth: 3,
      ignore_file: ".wiki-ignore",
    },
    autonomy: {
      mode: "balanced",
    },
    sources: {
      providers: {
        file: { type: "static" },
      },
    },
    security: {
      url_schemes: ["http", "https"],
      block_file_redirects: true,
      fetch_size_cap_mb: 50,
      fetch_timeout_s: 60,
      path_containment_check: true,
      label_sanitization: {
        strip_control_chars: true,
        max_length: 256,
        html_escape: true,
      },
    },
    graph: {
      enabled: true,
      edges_file: "graph/edges.jsonl",
    },
    cache: {
      enabled: true,
      dir: ".wiki-cache",
    },
    logging: {
      format: "jsonl",
      events_file: "log/events.jsonl",
    },
  };
}

/**
 * Python's `Path(path).resolve()` on macOS collapses `/tmp` into
 * `/private/tmp`. Match that exactly by walking up until we hit an existing
 * prefix, realpath-ing that, then re-joining the missing tail. Returns an
 * absolute, symlink-resolved path even when the target does not yet exist.
 */
function pythonResolve(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    // Walk up until we find an existing ancestor; realpath that, then
    // reattach the missing tail components.
    const missing: string[] = [];
    let current = abs;
    while (true) {
      const parent = path.dirname(current);
      if (parent === current) {
        // Hit the filesystem root.
        return abs;
      }
      missing.unshift(path.basename(current));
      current = parent;
      try {
        const resolved = fs.realpathSync(current);
        return path.join(resolved, ...missing);
      } catch {
        // keep walking up
      }
    }
  }
}

/** Touch (create empty file if missing). Mirrors `Path.touch()`. */
function touchFile(target: string): void {
  const fd = fs.openSync(target, "a");
  fs.closeSync(fd);
}

// ── Main logic ──────────────────────────────────────────────────────

export interface InitResult {
  status: string;
  wiki_root: string;
  created_dirs: string[];
  created_files: string[];
}

/**
 * Create the wiki scaffold at `wikiPath`. Idempotent — re-running on an
 * existing wiki leaves user edits intact and returns empty `created_*`
 * arrays for anything that already existed.
 */
export function initWiki(
  wikiPath: string,
  domain: string = "general",
  name: string = "My Wiki",
): InitResult {
  const root = pythonResolve(wikiPath);

  const createdDirs: string[] = [];
  const createdFiles: string[] = [];

  // 1. Create directories
  for (const d of SCAFFOLD_DIRS) {
    const target = path.join(root, d);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
      createdDirs.push(d);
    }
  }

  // 2. Write wiki.config.yaml (skip if exists)
  const configPath = path.join(root, "wiki.config.yaml");
  if (!fs.existsSync(configPath)) {
    const config = buildConfig(domain, name);
    // PyYAML(default_flow_style=False, sort_keys=False) emits arrays with no
    // extra indent ("  - item" not "    - item"); js-yaml mirrors that with
    // `noArrayIndent: true`.
    fs.writeFileSync(
      configPath,
      yaml.dump(config, { sortKeys: false, noArrayIndent: true }),
    );
    createdFiles.push("wiki.config.yaml");
  }

  // 3. Create initial wiki files (skip if exists)
  for (const [relPath, content] of INITIAL_WIKI_FILES) {
    const target = path.join(root, relPath);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, content);
      createdFiles.push(relPath);
    }
  }

  // 4. Create .wiki-ignore (skip if exists)
  const ignorePath = path.join(root, ".wiki-ignore");
  if (!fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, WIKI_IGNORE_DEFAULTS.join("\n") + "\n");
    createdFiles.push(".wiki-ignore");
  }

  // 5. Create empty events log (skip if exists)
  const eventsPath = path.join(root, "log", "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    touchFile(eventsPath);
    createdFiles.push("log/events.jsonl");
  }

  // 6. Create empty edges file (skip if exists)
  const edgesPath = path.join(root, "graph", "edges.jsonl");
  if (!fs.existsSync(edgesPath)) {
    touchFile(edgesPath);
    createdFiles.push("graph/edges.jsonl");
  }

  return {
    status: "ok",
    wiki_root: root,
    created_dirs: createdDirs,
    created_files: createdFiles,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--path": "path",
  "--domain": "domain",
  "--name": "name",
} as const;

const HELP_TEXT = `usage: init_wiki.js [-h] --path PATH [--domain DOMAIN] [--name NAME]

Initialize a documentation wiki scaffold.

options:
  -h, --help       show this help message and exit
  --path PATH      Root directory for the wiki.
  --domain DOMAIN  Knowledge domain (default: general).
  --name NAME      Display name for the wiki (default: "My Wiki").
`;

export function main(
  argv: readonly string[] = process.argv.slice(2),
): number {
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

  const pathArg = parsed.values["path"];
  if (typeof pathArg !== "string" || pathArg === "") {
    process.stderr.write("the following arguments are required: --path\n");
    return 2;
  }
  const domain =
    typeof parsed.values["domain"] === "string" && parsed.values["domain"]
      ? parsed.values["domain"]
      : "general";
  const name =
    typeof parsed.values["name"] === "string" && parsed.values["name"]
      ? parsed.values["name"]
      : "My Wiki";

  const result = initWiki(pathArg, domain, name);
  process.stdout.write(pythonJsonDumps(result) + "\n");
  return 0;
}

// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
