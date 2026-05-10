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
import { buildInitialMatcherStack, findRepoRoot, isIgnoredByStack, loadGitignoreScoped, } from "./gitignore_loader.js";
/**
 * Resolve the initial scoped-matcher stack for a walk: every
 * `.gitignore` between the inferred repo root and the walked `root`,
 * ordered top-down. Returns an empty array when gitignore handling is
 * disabled or no repo root can be located, so callers can short-circuit
 * the per-entry check.
 *
 * As the walker descends past `root`, it appends new
 * {@link ScopedMatcher}s for every `.gitignore` it encounters; the
 * initial stack established here is the prefix common to every frame.
 */
function resolveInitialMatcherStack(root, opts) {
    if (opts.respectGitignore === false)
        return [];
    const anchorRoot = opts.gitignoreRoot ?? findRepoRoot(root) ?? root;
    return buildInitialMatcherStack(anchorRoot, root);
}
/**
 * Top-level directory names skipped during any walk. Tuned for the seven
 * supported language ecosystems plus the wiki's own dev-time artifacts
 * (`.worktrees`, `wiki-workspace`).
 */
export const DEFAULT_IGNORE = new Set([
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
export function compileGlob(pattern) {
    let re = pattern.replace(/[.+^$|()\[\]{}]/g, "\\$&");
    re = re.replace(/\*\*\//g, "(?:.*/)?");
    re = re.replace(/\*\*/g, ".*");
    re = re.replace(/\*/g, "[^/]*");
    return new RegExp("(?:^|/)" + re + "$");
}
const _PATTERN_CACHE = new Map();
/**
 * Test a path against an array of glob patterns. Returns true on the
 * first match. Compiled patterns are cached so repeated walks against
 * the same profile do not recompile.
 */
export function matchesPattern(fullPath, patterns) {
    for (const p of patterns) {
        let re = _PATTERN_CACHE.get(p);
        if (re === undefined) {
            re = compileGlob(p);
            _PATTERN_CACHE.set(p, re);
        }
        if (re.test(fullPath))
            return true;
    }
    return false;
}
/**
 * Walk `root` recursively, returning a map of `{absolutePath: fileContents}`
 * for every regular file matching one of `patterns`. Honors {@link
 * DEFAULT_IGNORE}, the {@link MAX_FILES} cap, and `.gitignore` from the
 * repo root (default on; pass `opts.respectGitignore: false` to disable).
 * Unreadable files are silently skipped (permission errors, broken
 * symlinks, etc.).
 *
 * Iterative DFS via an explicit stack so very deep trees do not blow
 * the call stack.
 */
export function walkCodebase(root, patterns, opts = {}) {
    const initialStack = resolveInitialMatcherStack(root, opts);
    const out = {};
    const stack = [{ dir: root, active: initialStack }];
    while (stack.length > 0 && Object.keys(out).length < MAX_FILES) {
        const frame = stack.pop();
        if (frame === undefined)
            break;
        let entries;
        try {
            entries = fs.readdirSync(frame.dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (DEFAULT_IGNORE.has(entry.name))
                continue;
            const full = path.join(frame.dir, entry.name);
            if (frame.active.length > 0 &&
                isIgnoredByStack(frame.active, full, entry.isDirectory())) {
                continue;
            }
            if (entry.isDirectory()) {
                // Layer this dir's `.gitignore` (if any) onto the active stack
                // for descendants. Slice so sibling subtrees don't pollute one
                // another's matcher list.
                const childActive = frame.active.slice();
                if (opts.respectGitignore !== false) {
                    const childGi = loadGitignoreScoped(full);
                    if (childGi)
                        childActive.push(childGi);
                }
                stack.push({ dir: full, active: childActive });
            }
            else if (entry.isFile() && matchesPattern(full, patterns)) {
                try {
                    out[full] = fs.readFileSync(full, "utf-8");
                }
                catch {
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
export function _resetPatternCache() {
    _PATTERN_CACHE.clear();
}
/**
 * Walker variant tailored to the per-facet bundle assemblers in
 * `atlas_synthesize.ts`: top-level basenames matching one of a fixed
 * regex set + named subdirectories walked recursively with their own
 * basename filter. Returns a sorted list of repo-relative POSIX paths.
 *
 * Does NOT read file bodies — callers handle truncation, encoding, and
 * synthesis-text formatting themselves. Stays small, single-purpose,
 * and reusable.
 */
export function walkRepoTargets(repoRoot, spec, opts = {}) {
    const paths = new Set();
    const notes = [];
    const initialStack = resolveInitialMatcherStack(repoRoot, opts);
    const respectGitignore = opts.respectGitignore !== false;
    // Top-level files.
    if (spec.topLevelBasenames && spec.topLevelBasenames.length > 0) {
        let topLevel;
        try {
            topLevel = fs.readdirSync(repoRoot, { withFileTypes: true });
        }
        catch {
            notes.push(`could not read repo root: ${repoRoot}`);
            return { paths: [], notes };
        }
        for (const e of topLevel) {
            if (!e.isFile())
                continue;
            const full = path.join(repoRoot, e.name);
            if (initialStack.length > 0 &&
                isIgnoredByStack(initialStack, full, false)) {
                continue;
            }
            if (spec.topLevelBasenames.some((rx) => rx.test(e.name))) {
                paths.add(e.name);
            }
        }
    }
    // Subdirectory recursive walks.
    if (spec.subdirPatterns) {
        for (const { dir, rx } of spec.subdirPatterns) {
            const abs = path.join(repoRoot, dir);
            // Skip the entire subtree if the subdir itself is gitignored.
            if (initialStack.length > 0 &&
                isIgnoredByStack(initialStack, abs, true)) {
                continue;
            }
            if (!fs.existsSync(abs))
                continue;
            // Layer any `.gitignore` at the subdir root onto the active stack
            // before descending, so its rules apply to entries inside.
            const subdirActive = initialStack.slice();
            if (respectGitignore) {
                const subdirGi = loadGitignoreScoped(abs);
                if (subdirGi)
                    subdirActive.push(subdirGi);
            }
            const recurse = (d, relBase, active) => {
                let entries;
                try {
                    entries = fs.readdirSync(d, { withFileTypes: true });
                }
                catch {
                    return;
                }
                for (const entry of entries) {
                    const full = path.join(d, entry.name);
                    const rel = path.posix.join(relBase, entry.name);
                    if (active.length > 0 &&
                        isIgnoredByStack(active, full, entry.isDirectory())) {
                        continue;
                    }
                    if (entry.isDirectory()) {
                        const childActive = active.slice();
                        if (respectGitignore) {
                            const childGi = loadGitignoreScoped(full);
                            if (childGi)
                                childActive.push(childGi);
                        }
                        recurse(full, rel, childActive);
                    }
                    else if (entry.isFile() && rx.test(entry.name)) {
                        paths.add(rel);
                    }
                }
            };
            recurse(abs, dir, subdirActive);
        }
    }
    return { paths: [...paths].sort(), notes };
}
