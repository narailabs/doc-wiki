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
import ignore from "ignore";
const NO_OP = { isIgnored: () => false };
/**
 * Wrap an `ignore` instance behind the small `IgnoreMatcher` interface
 * so callers do not depend on the npm package's exported type.
 */
export function wrapIgnore(ig) {
    return {
        isIgnored(relPath) {
            const normalized = relPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
            if (normalized === "")
                return false;
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
export function findRepoRoot(start) {
    let dir = path.resolve(start);
    for (let i = 0; i < 64; i++) {
        if (fs.existsSync(path.join(dir, ".git")))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            return null;
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
export function loadGitignore(repoRoot) {
    const file = path.join(repoRoot, ".gitignore");
    let text;
    try {
        text = fs.readFileSync(file, { encoding: "utf-8" });
    }
    catch {
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
export function combineMatchers(...matchers) {
    if (matchers.length === 0)
        return NO_OP;
    return {
        isIgnored(relPath) {
            for (const m of matchers) {
                if (m.isIgnored(relPath))
                    return true;
            }
            return false;
        },
    };
}
/**
 * Try to load `<dir>/.gitignore`; return a {@link ScopedMatcher}
 * anchored at `dir`, or `null` when no file is present (or unreadable).
 *
 * This is the per-directory probe used by walkers as they descend the
 * tree, so it deliberately returns `null` (not a no-op matcher) to let
 * callers skip pushing useless frames onto the active stack.
 */
export function loadGitignoreScoped(dir) {
    const file = path.join(dir, ".gitignore");
    let text;
    try {
        text = fs.readFileSync(file, { encoding: "utf-8" });
    }
    catch {
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
export function isIgnoredByStack(stack, absPath, isDirectory) {
    for (const sm of stack) {
        const rel = path.relative(sm.baseDir, absPath).replace(/\\/g, "/");
        if (rel === "" || rel.startsWith(".."))
            continue;
        const probe = isDirectory ? rel + "/" : rel;
        if (sm.matcher.isIgnored(probe))
            return true;
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
export function buildInitialMatcherStack(anchorRoot, walkRoot) {
    const stack = [];
    const anchor = path.resolve(anchorRoot);
    const target = path.resolve(walkRoot);
    const top = loadGitignoreScoped(anchor);
    if (top)
        stack.push(top);
    if (target === anchor)
        return stack;
    const rel = path.relative(anchor, target);
    if (rel.startsWith(".."))
        return stack; // walkRoot not under anchor
    let cursor = anchor;
    for (const seg of rel.split(path.sep)) {
        if (seg === "")
            continue;
        cursor = path.join(cursor, seg);
        if (cursor === anchor)
            continue;
        const sm = loadGitignoreScoped(cursor);
        if (sm)
            stack.push(sm);
    }
    return stack;
}
