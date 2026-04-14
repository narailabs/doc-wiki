#!/usr/bin/env node
/**
 * Security checks for the documentation wiki.
 *
 * Provides URL validation, path containment checks, and label sanitization.
 * Importable as a module or runnable as a CLI script.
 *
 * CLI usage:
 *     node security_check.js --url <url>
 *     node security_check.js --path <path> --wiki-root <root>
 *     node security_check.js --label <text>
 *
 * Exit codes: 0 = pass, 1 = fail (with JSON error on stdout).
 *
 * This is a TypeScript port of security_check.py; behavior matches
 * the Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonJsonDumps } from "./_json_py.js";

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http", "https"]);

/**
 * Re-exported fetch caps from `agents/lib/fetch_helper.ts` so the two
 * security-baseline knobs live under one import at call sites.
 * `fetch_helper` remains the canonical owner; update the numbers there.
 */
export {
  FETCH_MAX_BYTES_DEFAULT,
  FETCH_TIMEOUT_MS_DEFAULT,
  FetchCapExceeded,
  fetchWithCaps,
  type FetchCapsOptions,
} from "../../../agents/lib/fetch_helper.js";

/**
 * Check that a URL uses an allowed scheme (http or https only).
 *
 * Mirrors Python's urllib.parse.urlparse: extracts a scheme by regex
 * (lowercased) and rejects anything not in ALLOWED_SCHEMES.
 *
 * @param url The URL string to validate.
 * @returns True if the URL is valid and uses http/https, False otherwise.
 */
export function validateUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  // Python's urlparse scheme extraction: lowercase alpha + [a-z0-9+.-]* followed by ":"
  // Per RFC 3986, scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
  const match = url.match(/^([A-Za-z][A-Za-z0-9+.\-]*):/);
  if (!match || match[1] === undefined) {
    return false;
  }
  const scheme = match[1].toLowerCase();
  return ALLOWED_SCHEMES.has(scheme);
}

/**
 * Best-effort realpath that mirrors Python's pathlib.Path.resolve(strict=False).
 *
 * Resolves existing symlinks in the path even when the full path does not
 * exist: walks up from the target until finding an existing ancestor,
 * realpaths it, then re-appends the non-existent tail.
 */
function bestEffortRealpath(p: string): string {
  const abs = path.resolve(p);
  const tail: string[] = [];
  let cur = abs;
  while (cur && cur !== path.dirname(cur)) {
    // existsSync dereferences, so a broken or cyclic symlink returns false.
    // Fall back to lstatSync (which doesn't dereference) to detect that the
    // entry is actually a symlink so realpathSync can surface ELOOP.
    let entryExists = fs.existsSync(cur);
    if (!entryExists) {
      try {
        fs.lstatSync(cur);
        entryExists = true;
      } catch {
        // Path truly absent; continue walking up.
      }
    }
    if (entryExists) {
      // Let realpath errors (e.g. ELOOP on symlink cycles) propagate. The
      // outer try/catch in checkPathContainment converts them to false —
      // fail-closed rather than silently treating a cycle as contained.
      const real = fs.realpathSync.native(cur);
      if (tail.length === 0) {
        return real;
      }
      return path.join(real, ...tail.reverse());
    }
    tail.push(path.basename(cur));
    cur = path.dirname(cur);
  }
  return abs;
}

/**
 * Verify that a path resolves to a location inside wiki_root.
 *
 * Resolves symlinks before checking to prevent symlink traversal attacks.
 *
 * @param p The file path to check.
 * @param wikiRoot The wiki root directory that must contain the path.
 * @returns True if the resolved path is inside the resolved wiki_root.
 */
export function checkPathContainment(p: string, wikiRoot: string): boolean {
  try {
    const resolvedPath = bestEffortRealpath(p);
    const resolvedRoot = bestEffortRealpath(wikiRoot);
    return (
      resolvedPath.startsWith(resolvedRoot + path.sep) ||
      resolvedPath === resolvedRoot
    );
  } catch {
    return false;
  }
}

/**
 * HTML-escape a string the same way Python's html.escape(s, quote=True) does.
 * Maps:  & -> &amp;, < -> &lt;, > -> &gt;, " -> &quot;, ' -> &#x27;
 * Ampersand must be escaped first so subsequent replacements do not double-escape.
 */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Regex matching Unicode general-category "Cc" (control chars): U+0000..U+001F, U+007F..U+009F.
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Sanitize a label by stripping control characters, capping length, and HTML-escaping.
 *
 * @param label The raw label text.
 * @param maxLength Maximum allowed length (default 256).
 * @returns The sanitized label string.
 */
export function sanitizeLabel(label: string, maxLength: number = 256): string {
  // Strip control characters (Unicode category Cc)
  let cleaned = label.replace(CONTROL_CHARS_RE, "");
  // Truncate to max_length
  cleaned = cleaned.slice(0, maxLength);
  // HTML-escape to prevent XSS
  cleaned = htmlEscape(cleaned);
  return cleaned;
}

interface ParsedArgs {
  url?: string;
  path?: string;
  wikiRoot?: string;
  label?: string;
  help?: boolean;
}

/**
 * Hand-rolled argparse-equivalent for the security_check CLI.
 * Accepts "--flag value" or "--flag=value" forms and the "-h"/"--help" flag.
 * Returns parsed values; on malformed input throws an Error.
 */
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
      case "url":
        out.url = value ?? "";
        break;
      case "path":
        out.path = value ?? "";
        break;
      case "wiki-root":
        out.wikiRoot = value ?? "";
        break;
      case "label":
        out.label = value ?? "";
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: security_check.js [-h] [--url URL] [--path PATH] [--wiki-root WIKI_ROOT] [--label LABEL]

Wiki security checks

options:
  -h, --help            show this help message and exit
  --url URL             Validate a URL (http/https only)
  --path PATH           Check path containment
  --wiki-root WIKI_ROOT
                        Wiki root for path containment check
  --label LABEL         Sanitize a label
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

  if (args.url !== undefined) {
    if (validateUrl(args.url)) {
      process.stdout.write(
        pythonJsonDumps({ ok: true, url: args.url }) + "\n",
      );
      return 0;
    } else {
      process.stdout.write(
        pythonJsonDumps({ error: `URL rejected: ${args.url}` }) + "\n",
      );
      return 1;
    }
  }

  if (args.path !== undefined) {
    if (!args.wikiRoot) {
      process.stdout.write(
        pythonJsonDumps({ error: "--wiki-root is required with --path" }) + "\n",
      );
      return 1;
    }
    if (checkPathContainment(args.path, args.wikiRoot)) {
      process.stdout.write(
        pythonJsonDumps({ ok: true, path: args.path }) + "\n",
      );
      return 0;
    } else {
      process.stdout.write(
        pythonJsonDumps({ error: `Path escapes wiki root: ${args.path}` }) +
          "\n",
      );
      return 1;
    }
  }

  if (args.label !== undefined) {
    const result = sanitizeLabel(args.label);
    process.stdout.write(
      pythonJsonDumps({ ok: true, sanitized: result }) + "\n",
    );
    return 0;
  }

  process.stdout.write(HELP_TEXT);
  return 1;
}

// CLI entry point: run main() when this file is executed directly.
// Matches the Python `if __name__ == "__main__":` idiom.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
