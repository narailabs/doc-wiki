/**
 * Shared filesystem helpers for walking the wiki pages tree.
 *
 * Both `lint_checks.ts` and `quality_score.ts` previously inlined the same
 * recursive `.md` walker. This module owns the canonical version.
 *
 * Parity rule (matches Python `sorted(Path(wiki_dir).rglob("*.md"))` in both
 * source files):
 *   - Roots at `<wikiRoot>/wiki/`. Returns `[]` if that directory doesn't exist.
 *   - Recurses into subdirectories. Skips entries that aren't files or `.md`.
 *   - Sorted lexicographically over the *absolute* paths returned, which
 *     matches Python's behaviour because the common prefix is identical.
 *   - Hidden files (leading `.`) ARE returned by Python's `rglob("*.md")` —
 *     glob's `*` matches dotfiles unless the pattern itself starts with `.`.
 *     We mirror that: no special hidden-file filter beyond the implicit
 *     `endsWith(".md")` test.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
/**
 * Return absolute paths to every `.md` file under `<wikiRoot>/wiki/`,
 * sorted lexicographically. See module docstring for parity details.
 */
export function wikiPages(wikiRoot) {
    const wikiDir = path.join(wikiRoot, "wiki");
    if (!fs.existsSync(wikiDir)) {
        return [];
    }
    const out = [];
    const stack = [wikiDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        if (dir === undefined)
            continue;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            }
            else if (entry.isFile() && full.endsWith(".md")) {
                out.push(full);
            }
        }
    }
    out.sort();
    return out;
}
/** Wraps the `ignore` package so callers only see `isIgnored`. */
function wrap(ig) {
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
 * Load `<wikiRoot>/.wiki-ignore`. If the file is missing or unreadable,
 * returns a matcher that ignores nothing. Lines are parsed by the
 * `ignore` npm package (gitignore-compatible: supports `!` negation,
 * `#` comments, `**` globs, trailing `/` directory markers).
 */
export function loadIgnore(wikiRoot) {
    const ig = ignore();
    const file = path.join(wikiRoot, ".wiki-ignore");
    let text;
    try {
        text = fs.readFileSync(file, { encoding: "utf-8" });
    }
    catch {
        return wrap(ig);
    }
    ig.add(text);
    return wrap(ig);
}
