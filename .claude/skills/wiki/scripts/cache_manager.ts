#!/usr/bin/env node
/**
 * SHA256 content-hash cache for the documentation wiki.
 *
 * Stores cache entries in `.wiki-cache/` as `<sha256>.json` files.
 * Supports body-only hashing for markdown (strips YAML frontmatter).
 * Auto-invalidates when the cache version changes.
 *
 * Usage as a library:
 *     import { computeHash, checkCache, storeCache } from "./cache_manager.js";
 *     const h = computeHash(content, true);
 *     const cached = checkCache("/path/to/wiki", h);
 *     if (cached === null) {
 *         storeCache("/path/to/wiki", h, {source: "file.md", pages: 2});
 *     }
 *
 * Usage as a script:
 *     node cache_manager.js check --wiki-root /path --content "..."
 *     node cache_manager.js store --wiki-root /path --content "..." --metadata '{"k":"v"}'
 *     node cache_manager.js clear --wiki-root /path
 *     node cache_manager.js version --wiki-root /path [--set 2]
 *
 * This is a TypeScript port of cache_manager.py; CLI output and on-disk
 * format match the Python reference byte-for-byte.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "./_json_py.js";

// ── Constants ───────────────────────────────────────────────────────

export const CACHE_DIR_NAME = ".wiki-cache";
export const VERSION_FILE = "VERSION";
export const CURRENT_CACHE_VERSION = "1";

/**
 * Matches Python's `re.compile(r"^---\n.*?\n---\n", re.DOTALL)`.
 * Anchored at the start of the string (Python's `re.match`). Non-greedy
 * `.*?` across newlines — we use `[\s\S]` to get DOTALL semantics in JS.
 */
const _FRONTMATTER_RE: RegExp = /^---\n[\s\S]*?\n---\n/;

// ── Hashing ─────────────────────────────────────────────────────────

/**
 * Compute SHA256 hex digest of `content`.
 *
 * If `bodyOnly` is true, strips YAML frontmatter (delimited by `---`) before
 * hashing. Content without frontmatter is hashed as-is.
 *
 * Python equivalent: `hashlib.sha256(content.encode("utf-8")).hexdigest()`.
 * Node's createHash uses the same UTF-8 encoding by default when passed a
 * JS string, producing identical digests for identical inputs.
 */
export function computeHash(content: string, bodyOnly: boolean = false): string {
  let source = content;
  if (bodyOnly) {
    const m = source.match(_FRONTMATTER_RE);
    if (m) {
      source = source.slice(m[0].length);
    }
  }
  return crypto.createHash("sha256").update(source, "utf8").digest("hex");
}

// ── Paths ───────────────────────────────────────────────────────────

function _cacheDir(wikiRoot: string): string {
  return path.join(wikiRoot, CACHE_DIR_NAME);
}

function _versionPath(wikiRoot: string): string {
  return path.join(_cacheDir(wikiRoot), VERSION_FILE);
}

// ── Version ─────────────────────────────────────────────────────────

/** Read the cache VERSION file. Returns `'0'` if missing. */
export function getCacheVersion(wikiRoot: string): string {
  const p = _versionPath(wikiRoot);
  if (fs.existsSync(p)) {
    return fs.readFileSync(p, { encoding: "utf-8" }).trim();
  }
  return "0";
}

/** Write the cache VERSION file. Creates the cache directory if absent. */
export function setCacheVersion(wikiRoot: string, version: string): void {
  const d = _cacheDir(wikiRoot);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(_versionPath(wikiRoot), version);
}

// ── Cache CRUD ──────────────────────────────────────────────────────

/**
 * Return cached metadata for `contentHash`, or `null` on miss.
 *
 * Returns `null` if:
 * - the cache directory does not exist
 * - no entry file exists for the hash
 * - the entry file is malformed JSON
 * - the entry's `cache_version` does not match the current version
 */
export function checkCache(
  wikiRoot: string,
  contentHash: string,
): Record<string, unknown> | null {
  const cacheFile = path.join(_cacheDir(wikiRoot), `${contentHash}.json`);
  if (!fs.existsSync(cacheFile)) {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(cacheFile, { encoding: "utf-8" });
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const currentVersion = getCacheVersion(wikiRoot);
  if (data["cache_version"] !== currentVersion) {
    return null;
  }

  return data;
}

/**
 * Write a cache entry to `.wiki-cache/<hash>.json`.
 *
 * The current cache version is embedded in the entry so that `checkCache`
 * can auto-invalidate on version change.
 */
export function storeCache(
  wikiRoot: string,
  contentHash: string,
  metadata: Record<string, unknown>,
): void {
  const d = _cacheDir(wikiRoot);
  fs.mkdirSync(d, { recursive: true });

  // Python: `{**metadata, "cache_version": get_cache_version(wiki_root)}`.
  // That spread preserves metadata's key order, then appends cache_version
  // (or overwrites an existing cache_version key). Python 3.7+ dicts are
  // insertion-ordered; JS object literals behave the same for string keys.
  const entry: Record<string, unknown> = { ...metadata };
  entry["cache_version"] = getCacheVersion(wikiRoot);

  const cacheFile = path.join(d, `${contentHash}.json`);
  // Python: `json.dumps(entry)` — default separators (", ", ": ").
  fs.writeFileSync(cacheFile, pythonJsonDumps(entry));
}

/**
 * Remove all `.json` cache entries. Preserves the VERSION file.
 * Returns the number of entries removed.
 */
export function clearCache(wikiRoot: string): number {
  const d = _cacheDir(wikiRoot);
  if (!fs.existsSync(d)) {
    return 0;
  }
  let count = 0;
  for (const entry of fs.readdirSync(d)) {
    if (entry.endsWith(".json")) {
      fs.unlinkSync(path.join(d, entry));
      count++;
    }
  }
  return count;
}

// ── CLI ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  command?: string;
  wikiRoot?: string;
  content?: string;
  metadata?: string;
  bodyOnly?: boolean;
  setVersion?: string | null;
  help?: boolean;
}

/**
 * Hand-rolled argparse-equivalent. Subcommands: check/store/clear/version.
 * Accepts `--flag value`, `--flag=value`, and boolean flags (`--body-only`).
 * `--set` is scoped to the `version` subcommand but accepted on any level.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  if (argv.length === 0) return out;

  let i = 0;
  const first = argv[0];
  if (first === "-h" || first === "--help") {
    out.help = true;
    return out;
  }
  if (first !== undefined && !first.startsWith("-")) {
    out.command = first;
    i = 1;
  }

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

    // Handle boolean flag explicitly before generic value consumption.
    if (a === "--body-only" || a === "--body-only=true") {
      out.bodyOnly = true;
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
      case "wiki-root":
        out.wikiRoot = value ?? "";
        break;
      case "content":
        out.content = value ?? "";
        break;
      case "metadata":
        out.metadata = value ?? "{}";
        break;
      case "set":
        out.setVersion = value ?? "";
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: cache_manager.js [-h] {check,store,clear,version} ...

SHA256 content-hash cache manager.

positional arguments:
  {check,store,clear,version}
    check               Check if content is cached
    store               Store a cache entry
    clear               Clear all cache entries
    version             Get or set cache version

options:
  -h, --help            show this help message and exit
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

  if (args.command === "check") {
    if (!args.wikiRoot || args.content === undefined) {
      process.stderr.write("--wiki-root and --content are required\n");
      return 2;
    }
    const h = computeHash(args.content, args.bodyOnly ?? false);
    const result = checkCache(args.wikiRoot, h);
    if (result !== null) {
      process.stdout.write(
        pythonJsonDumps({ hit: true, hash: h, metadata: result }) + "\n",
      );
    } else {
      process.stdout.write(pythonJsonDumps({ hit: false, hash: h }) + "\n");
    }
    return 0;
  }

  if (args.command === "store") {
    if (!args.wikiRoot || args.content === undefined) {
      process.stderr.write("--wiki-root and --content are required\n");
      return 2;
    }
    const h = computeHash(args.content, args.bodyOnly ?? false);
    const meta = JSON.parse(args.metadata ?? "{}") as Record<string, unknown>;
    storeCache(args.wikiRoot, h, meta);
    process.stdout.write(pythonJsonDumps({ stored: true, hash: h }) + "\n");
    return 0;
  }

  if (args.command === "clear") {
    if (!args.wikiRoot) {
      process.stderr.write("--wiki-root is required\n");
      return 2;
    }
    const count = clearCache(args.wikiRoot);
    process.stdout.write(pythonJsonDumps({ removed: count }) + "\n");
    return 0;
  }

  if (args.command === "version") {
    if (!args.wikiRoot) {
      process.stderr.write("--wiki-root is required\n");
      return 2;
    }
    if (args.setVersion !== null && args.setVersion !== undefined) {
      setCacheVersion(args.wikiRoot, args.setVersion);
      process.stdout.write(
        pythonJsonDumps({ version: args.setVersion }) + "\n",
      );
    } else {
      process.stdout.write(
        pythonJsonDumps({ version: getCacheVersion(args.wikiRoot) }) + "\n",
      );
    }
    return 0;
  }

  process.stdout.write(HELP_TEXT);
  return 0;
}

// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
