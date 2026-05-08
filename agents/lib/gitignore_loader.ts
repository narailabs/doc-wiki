/**
 * gitignore_loader.ts — shared `.gitignore` loader and matcher utilities.
 *
 * Used by `repo_walker.ts` (and any future repo-walker) so documentation
 * generation does not include files the user has explicitly excluded from
 * version control. Matches the same `IgnoreMatcher` shape that
 * `skills/doc-wiki/scripts/_wiki_fs.ts` exposes for `.wiki-ignore`, so
 * callers can `combineMatchers(...)` the two without adapter glue.
 *
 * Pure: no module-level side effects, no caching beyond what the callers
 * pass through. Safe to import from any tier.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";

/**
 * Minimal matcher interface. Paths passed to `isIgnored` are
 * relative-to-the-loader-root POSIX paths (forward slashes).
 *
 * A matcher built from a missing or unreadable source returns `false`
 * for every input — never throws.
 */
export interface IgnoreMatcher {
  isIgnored(relPath: string): boolean;
}

const NO_OP: IgnoreMatcher = { isIgnored: () => false };

/**
 * Wrap an `ignore` instance behind the small `IgnoreMatcher` interface
 * so callers do not depend on the npm package's exported type.
 */
export function wrapIgnore(ig: Ignore): IgnoreMatcher {
  return {
    isIgnored(relPath: string): boolean {
      const normalized = relPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      if (normalized === "") return false;
      return ig.ignores(normalized);
    },
  };
}

/**
 * Walk up from `start` looking for a directory that contains a `.git`
 * entry (directory or file — the latter handles git-worktree linkfiles).
 * Returns that directory, or `null` when the filesystem root is reached
 * without a hit. Capped at 64 levels so a non-repo path cannot loop.
 *
 * Used to anchor `.gitignore` resolution when the caller's working
 * directory is somewhere inside a repo (e.g. wiki at
 * `docs/<name>-wiki/` is two levels below the repo root).
 */
export function findRepoRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Load `.gitignore` from `repoRoot` and return an {@link IgnoreMatcher}.
 * Returns a no-op matcher when the file is missing or unreadable, so
 * callers can apply this unconditionally without first checking
 * existence.
 *
 * Only `<repoRoot>/.gitignore` is read — nested `.gitignore` files
 * inside subdirectories are NOT chained. (Nesting is rare in projects
 * doc-wiki targets, and adding it would require multiple matchers
 * scoped per-directory, complicating the shared API.)
 */
export function loadGitignore(repoRoot: string): IgnoreMatcher {
  const file = path.join(repoRoot, ".gitignore");
  let text: string;
  try {
    text = fs.readFileSync(file, { encoding: "utf-8" });
  } catch {
    return NO_OP;
  }
  const ig = ignore();
  ig.add(text);
  return wrapIgnore(ig);
}

/**
 * Combine N matchers with OR semantics — `isIgnored` returns true on
 * the first matcher that returns true. Safe with zero matchers (returns
 * a no-op).
 *
 * Used to layer `.gitignore` on top of `.wiki-ignore`, or to chain
 * future per-directory ignore files.
 */
export function combineMatchers(...matchers: IgnoreMatcher[]): IgnoreMatcher {
  if (matchers.length === 0) return NO_OP;
  return {
    isIgnored(relPath: string): boolean {
      for (const m of matchers) {
        if (m.isIgnored(relPath)) return true;
      }
      return false;
    },
  };
}

// ── Nested .gitignore support ────────────────────────────────────────

/**
 * A {@link IgnoreMatcher} bound to the absolute directory its patterns
 * are relative to. Used by walkers that need to honour nested
 * `.gitignore` files: each `.gitignore` discovered during descent is
 * loaded as a `ScopedMatcher` with `baseDir` set to its containing
 * directory, then layered onto a stack.
 *
 * gitignore semantics: patterns in `<dir>/.gitignore` are evaluated
 * against paths relative to `<dir>`. So a `dist/` rule in
 * `<repo>/foo/.gitignore` matches `<repo>/foo/dist/` but not
 * `<repo>/bar/dist/`.
 */
export interface ScopedMatcher {
  matcher: IgnoreMatcher;
  baseDir: string;
}

/**
 * Try to load `<dir>/.gitignore`; return a {@link ScopedMatcher}
 * anchored at `dir`, or `null` when no file is present (or unreadable).
 *
 * This is the per-directory probe used by walkers as they descend the
 * tree, so it deliberately returns `null` (not a no-op matcher) to let
 * callers skip pushing useless frames onto the active stack.
 */
export function loadGitignoreScoped(dir: string): ScopedMatcher | null {
  const file = path.join(dir, ".gitignore");
  let text: string;
  try {
    text = fs.readFileSync(file, { encoding: "utf-8" });
  } catch {
    return null;
  }
  const ig = ignore();
  ig.add(text);
  return { matcher: wrapIgnore(ig), baseDir: path.resolve(dir) };
}

/**
 * Test `absPath` against a stack of {@link ScopedMatcher}s. Returns
 * true on the first matcher that matches the path relative to its
 * `baseDir`. Paths outside a matcher's scope (those that would yield
 * a `..`-prefixed relative path) are skipped silently.
 *
 * `isDirectory` controls whether the test path carries a trailing
 * slash, so gitignore's `dist/` (directory-only) syntax matches the
 * bare directory name correctly.
 *
 * **Conservative semantics (deliberate):** OR across the stack, with
 * the first match winning. If a parent `.gitignore` excludes a path,
 * a deeper `.gitignore`'s `!pattern` negation does NOT re-include it.
 * This is stricter than git's own nested-override behaviour — for the
 * documentation walker we prefer to over-exclude than risk surfacing a
 * file the user marked private at any level of the tree. Negations
 * inside a single `.gitignore` still work normally because the npm
 * `ignore` package processes patterns in order within one matcher.
 */
export function isIgnoredByStack(
  stack: readonly ScopedMatcher[],
  absPath: string,
  isDirectory: boolean,
): boolean {
  for (const sm of stack) {
    const rel = path.relative(sm.baseDir, absPath).replace(/\\/g, "/");
    if (rel === "" || rel.startsWith("..")) continue;
    const probe = isDirectory ? rel + "/" : rel;
    if (sm.matcher.isIgnored(probe)) return true;
  }
  return false;
}

/**
 * Build the initial active-matcher stack for a walk that begins at
 * `walkRoot` but should respect every `.gitignore` between
 * `anchorRoot` and `walkRoot` (inclusive). Used to handle the case
 * where a caller walks a subdirectory of the repo and intermediate
 * directories carry their own `.gitignore` files.
 *
 * Returns an empty array when `walkRoot` is not inside `anchorRoot`,
 * apart from the `anchorRoot`'s own `.gitignore` if present.
 */
export function buildInitialMatcherStack(
  anchorRoot: string,
  walkRoot: string,
): ScopedMatcher[] {
  const stack: ScopedMatcher[] = [];
  const anchor = path.resolve(anchorRoot);
  const target = path.resolve(walkRoot);

  const top = loadGitignoreScoped(anchor);
  if (top) stack.push(top);

  if (target === anchor) return stack;

  const rel = path.relative(anchor, target);
  if (rel.startsWith("..")) return stack; // walkRoot not under anchor

  let cursor = anchor;
  for (const seg of rel.split(path.sep)) {
    if (seg === "") continue;
    cursor = path.join(cursor, seg);
    if (cursor === anchor) continue;
    const sm = loadGitignoreScoped(cursor);
    if (sm) stack.push(sm);
  }
  return stack;
}
