/**
 * repo_walker.ts — shared filesystem walker for atlas inventory and any
 * future consumer that needs to enumerate source files.
 *
 * Lifted from `agents/wiki-orm-agent/scripts/orm_detect.ts:33-106` so a
 * single ignore-list, glob compiler, and bounded walker is shared across
 * the codebase. Exports are pure (no module-level side effects beyond a
 * local pattern-cache); safe to import from any tier.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Top-level directory names skipped during any walk. Tuned for the seven
 * supported language ecosystems plus the wiki's own dev-time artifacts
 * (`.worktrees`, `wiki-workspace`).
 */
export const DEFAULT_IGNORE: ReadonlySet<string> = new Set([
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

/** Hard cap so walks of very large monorepos terminate quickly. */
export const MAX_FILES = 2000;

/**
 * Compile a shell-style glob pattern to a RegExp that tests against a
 * file's (possibly absolute) path. Supports `*` (single segment), `**`
 * (any number of segments), and `**\/` (zero-or-more parent
 * directories) — the patterns shipped by the wiki_orm profiles and the
 * REST-endpoint profiles.
 *
 * Anchored at the end (`$`) and either at start of string or after a
 * `/`, so `*.ts` matches `src/x.ts` but not `src/x.tsx`.
 */
export function compileGlob(pattern: string): RegExp {
  let re = pattern.replace(/[.+^$|()\[\]{}]/g, "\\$&");
  re = re.replace(/\*\*\//g, "(?:.*/)?");
  re = re.replace(/\*\*/g, ".*");
  re = re.replace(/\*/g, "[^/]*");
  return new RegExp("(?:^|/)" + re + "$");
}

const _PATTERN_CACHE = new Map<string, RegExp>();

/**
 * Test a path against an array of glob patterns. Returns true on the
 * first match. Compiled patterns are cached so repeated walks against
 * the same profile do not recompile.
 */
export function matchesPattern(
  fullPath: string,
  patterns: readonly string[],
): boolean {
  for (const p of patterns) {
    let re = _PATTERN_CACHE.get(p);
    if (re === undefined) {
      re = compileGlob(p);
      _PATTERN_CACHE.set(p, re);
    }
    if (re.test(fullPath)) return true;
  }
  return false;
}

/**
 * Walk `root` recursively, returning a map of `{absolutePath: fileContents}`
 * for every regular file matching one of `patterns`. Honors {@link
 * DEFAULT_IGNORE} and the {@link MAX_FILES} cap. Unreadable files are
 * silently skipped (permission errors, broken symlinks, etc.).
 *
 * Iterative DFS via an explicit stack so very deep trees do not blow
 * the call stack.
 */
export function walkCodebase(
  root: string,
  patterns: readonly string[],
): Record<string, string> {
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

/**
 * Test-only: drop every cached compiled pattern. Useful for tests that
 * register temp patterns and want a clean slate. Production callers
 * should not need this.
 */
export function _resetPatternCache(): void {
  _PATTERN_CACHE.clear();
}
