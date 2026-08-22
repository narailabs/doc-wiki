import * as path from "node:path";
import { _resetRegistryConfigState, ensureRegistryForConfig, lookupBySource, } from "./source_registry.js";
import { walkCodebase } from "./repo_walker.js";
// ── Registry bootstrap ────────────────────────────────────────────────
/**
 * Builtins + `ecosystem.agents.custom` from wiki.config.yaml. Callers
 * that know the wiki root pass `<wikiRoot>/wiki.config.yaml`; otherwise
 * cwd is probed.
 *
 * Delegates to the registry, which owns the "which config is loaded" state.
 * A local flag here would go stale whenever `how_to_go_deeper.ts` reloads the
 * same global registry.
 */
function ensureRegistry(wikiConfigPath) {
    ensureRegistryForConfig(wikiConfigPath);
}
/** Reset registry state (test helper). */
export function _resetRegistry() {
    _resetRegistryConfigState();
}
// ── DB-scheme fallback patterns ───────────────────────────────────────
/**
 * Prefixes/substrings that identify a real database connection URL.
 * The `db://` scheme is already handled by source_registry's builtins;
 * these cover the real-world URL forms that `lookupBySource` cannot classify.
 */
const DB_SCHEME_PREFIXES = [
    "jdbc:",
    "postgres://",
    "postgresql://",
    "mysql://",
    "mariadb://",
    "mongodb://",
    "mongodb+srv://",
    "redis://",
    "rediss://",
    "oracle:",
    "sqlserver://",
    "jdbc:sqlserver",
    "r2dbc:",
];
function isDbScheme(s) {
    const lower = s.toLowerCase();
    for (const prefix of DB_SCHEME_PREFIXES) {
        if (lower.startsWith(prefix))
            return true;
    }
    return false;
}
// ── classifySource ────────────────────────────────────────────────────
/**
 * Classify an external source string to a narai-primitives connector id.
 *
 * 1. Tries `lookupBySource` (source_registry builtins + custom).
 * 2. Falls back to DB-scheme detection for real DB URLs.
 * 3. Returns "" when unclassifiable.
 *
 * `wikiConfigPath` (optional) locates the wiki.config.yaml whose
 * `ecosystem.agents.custom` block feeds the registry. Passing a different
 * path than the one currently loaded reloads the registry; omitting it
 * reuses whatever is loaded (and probes cwd only on the very first call).
 */
export function classifySource(s, wikiConfigPath) {
    if (s === "")
        return "";
    ensureRegistry(wikiConfigPath);
    const manifest = lookupBySource(s);
    if (manifest !== null) {
        return manifest.name.replace(/^wiki-/, "").replace(/-agent$/, "");
    }
    if (isDbScheme(s))
        return "db";
    return "";
}
// ── Config-file DB datasource detection ──────────────────────────────
/**
 * Glob patterns for config files that may contain DB datasource URLs.
 */
const CONFIG_FILE_GLOBS = [
    "**/application*.yml",
    "**/application*.yaml",
    "**/application*.properties",
    "**/bootstrap*.yml",
    "**/bootstrap*.yaml",
    "**/*.env",
    ".env",
];
/**
 * Source-file globs for cloud-SDK import detection.
 */
const SOURCE_FILE_GLOBS = [
    "**/*.java",
    "**/*.kt",
    "**/*.ts",
    "**/*.js",
    "**/*.py",
    "**/*.go",
    "**/*.cs",
];
/**
 * Regex that matches DB connection URL forms found inside config files.
 * Group 1 captures the full URL. Credentials (user:pass@) are redacted in output.
 */
const DB_URL_RE = /(?:jdbc:[^\s"']+|(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|sqlserver|oracle|r2dbc):\/\/[^\s"']*)/gi;
/**
 * Strip user:password@ from a URL for safe display.
 */
function redactCredentials(url) {
    // Handle jdbc:scheme://user:pass@host/db and plain scheme://user:pass@host/db
    return url.replace(/(\/\/)[^@/]+@/, "$1");
}
/**
 * AWS SDK import patterns (any of these substrings on a source line = aws).
 */
const AWS_PATTERNS = [
    "software.amazon.awssdk",
    "com.amazonaws",
    'from "aws-sdk"',
    "require('aws-sdk')",
    'require("aws-sdk")',
    "import boto3",
    "@aws-sdk/",
];
/**
 * GCP SDK import patterns.
 */
const GCP_PATTERNS = [
    "com.google.cloud",
    "@google-cloud/",
    "from google.cloud",
    "cloud.google.com/go",
];
// ── Main detection ────────────────────────────────────────────────────
/**
 * Static per-service external-dependency detection.
 *
 * Walks `repoRoot`, returns repo-relative entries with `configured=false`.
 * Caller sets `configured` in B7b after loading the connector config.
 * Pass `options.wikiConfigPath` (`<wikiRoot>/wiki.config.yaml`) so
 * `ecosystem.agents.custom` patterns participate in classification even
 * when the wiki root is not the process cwd.
 */
export function detectExternalSources(repoRoot, options = {}) {
    ensureRegistry(options.wikiConfigPath);
    const entries = [];
    // Dedup key: "file:line:kind"
    const seen = new Set();
    function addEntry(e) {
        const key = `${e.file}:${e.line}:${e.kind}`;
        if (seen.has(key))
            return;
        seen.add(key);
        entries.push(e);
    }
    function toRelative(absPath) {
        return path.relative(repoRoot, absPath).split(path.sep).join("/");
    }
    // ── DB datasource URLs in config files ────────────────────────────
    const configFiles = walkCodebase(repoRoot, CONFIG_FILE_GLOBS, {
        respectGitignore: false,
    });
    for (const [absPath, content] of Object.entries(configFiles)) {
        const relFile = toRelative(absPath);
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            DB_URL_RE.lastIndex = 0;
            let match;
            while ((match = DB_URL_RE.exec(line)) !== null) {
                const rawUrl = match[0];
                const detail = redactCredentials(rawUrl);
                const connectorId = classifySource(rawUrl);
                addEntry({
                    kind: "database",
                    detail,
                    connector_id: connectorId,
                    configured: false,
                    file: relFile,
                    line: i + 1,
                });
            }
        }
    }
    // ── Cloud SDK imports in source files ─────────────────────────────
    const sourceFiles = walkCodebase(repoRoot, SOURCE_FILE_GLOBS, {
        respectGitignore: false,
    });
    for (const [absPath, content] of Object.entries(sourceFiles)) {
        const relFile = toRelative(absPath);
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            // AWS
            for (const pattern of AWS_PATTERNS) {
                if (line.includes(pattern)) {
                    addEntry({
                        kind: "aws",
                        detail: pattern,
                        connector_id: "aws",
                        configured: false,
                        file: relFile,
                        line: i + 1,
                    });
                    break; // one entry per line per kind
                }
            }
            // GCP
            for (const pattern of GCP_PATTERNS) {
                if (line.includes(pattern)) {
                    addEntry({
                        kind: "gcp",
                        detail: pattern,
                        connector_id: "gcp",
                        configured: false,
                        file: relFile,
                        line: i + 1,
                    });
                    break;
                }
            }
        }
    }
    return entries;
}
