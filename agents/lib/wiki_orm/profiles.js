/**
 * profiles.ts — ORM profile loader.
 *
 * Ported 1:1 from `agents/lib/wiki_orm/profiles.py`. Reads the same
 * seven YAML files under `profiles/` via `js-yaml`, producing the same
 * `OrmProfile` shape the Python dataclass exposes.
 *
 * The YAML files themselves are NOT edited for the TS port. Regex patterns
 * are authored for Python's `re` module; they are re-used verbatim and fed
 * to JavaScript `RegExp` by `extractor.ts`. Python-only features (e.g.
 * `(?P<name>...)` named groups) are not present in the shipped profiles, so
 * the patterns port cleanly to ECMAScript 2018+. See each profile YAML for
 * details.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
export const REQUIRED_FIELDS = [
    "name",
    "language",
    "detection",
    "entity_extraction",
];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROFILES_DIR = path.join(__dirname, "profiles");
/**
 * Raised when a profile YAML cannot be parsed or is missing required keys.
 * Mirrors Python's `ValueError` — the Python tests match on the "missing
 * required fields" substring, so keep the wording identical.
 */
export class ProfileValueError extends Error {
    constructor(message) {
        super(message);
        this.name = "ProfileValueError";
    }
}
function toString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function toMarkerList(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object")
            continue;
        const m = entry;
        const pattern = typeof m.pattern === "string" ? m.pattern : "";
        const type = typeof m.type === "string" ? m.type : "";
        out.push({ pattern, type });
    }
    return out;
}
function toStringArray(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const entry of raw) {
        if (typeof entry === "string")
            out.push(entry);
    }
    return out;
}
function toStringMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string")
            out[k] = v;
    }
    return out;
}
/**
 * Load a single ORM profile from a YAML file on disk.
 *
 * @throws FileNotFoundError (here a `Error` with `code: "ENOENT"`) if the
 *   file does not exist.
 * @throws ProfileValueError if the YAML is invalid or missing required keys.
 */
export function loadProfile(filePath) {
    if (!fs.existsSync(filePath)) {
        const err = new Error(`Profile not found: ${filePath}`);
        err.code = "ENOENT";
        throw err;
    }
    const text = fs.readFileSync(filePath, "utf-8");
    let data;
    try {
        data = yaml.load(text);
    }
    catch (e) {
        throw new ProfileValueError(`Invalid profile format in ${filePath}: ${String(e)}`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new ProfileValueError(`Invalid profile format in ${filePath}`);
    }
    const raw = data;
    const keys = new Set(Object.keys(raw));
    const missing = REQUIRED_FIELDS.filter((k) => !keys.has(k));
    if (missing.length > 0) {
        // Format matches Python's `repr(set)` enough for the test's
        // `match="missing required fields"` regex to hit.
        const pretty = "{" + missing.map((k) => `'${k}'`).join(", ") + "}";
        throw new ProfileValueError(`Profile ${filePath} missing required fields: ${pretty}`);
    }
    const detection = raw.detection ?? {};
    const extraction = raw.entity_extraction ?? {};
    const relationships = raw.relationship_detection ?? {};
    const profile = {
        name: toString(raw.name),
        language: toString(raw.language),
        description: toString(raw.description, ""),
        file_patterns: toStringArray(detection.file_patterns),
        markers: toMarkerList(detection.markers),
        class_pattern: toString(extraction.class_pattern, ""),
        table_pattern: toString(extraction.table_pattern, ""),
        column_pattern: toString(extraction.column_pattern, ""),
        relationship_patterns: toMarkerList(relationships.patterns),
        naming_conventions: toStringMap(raw.naming_conventions),
    };
    // G-ORM-PROFILE-VALIDATE: compile every regex-valued pattern at
    // load time so authors see typos immediately instead of having them
    // silently swallowed by the extractor's runtime catch. Flags must
    // match the ones used in extractor.ts where each pattern is applied.
    _validateProfileRegexes(profile, filePath);
    return profile;
}
function _compilePattern(pattern, flags, filePath, field) {
    if (pattern === "")
        return;
    try {
        // Constructed for validation only — the extractor builds its own
        // RegExp at use-time with the right flags.
        new RegExp(pattern, flags);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new ProfileValueError(`Profile ${filePath} has invalid regex in ${field}: ${JSON.stringify(pattern)} (${msg})`);
    }
}
function _validateProfileRegexes(profile, filePath) {
    _compilePattern(profile.class_pattern, "gm", filePath, "class_pattern");
    _compilePattern(profile.table_pattern, "s", filePath, "table_pattern");
    _compilePattern(profile.column_pattern, "g", filePath, "column_pattern");
    profile.relationship_patterns.forEach((rel, i) => {
        _compilePattern(rel.pattern, "g", filePath, `relationship_patterns[${i}].pattern`);
    });
}
/**
 * Load every `*.yaml` profile from a directory. Failed profiles are silently
 * dropped (same as Python's `except (ValueError, yaml.YAMLError): continue`).
 */
export function loadAllProfiles(profilesDir) {
    const dir = profilesDir ?? PROFILES_DIR;
    if (!fs.existsSync(dir))
        return [];
    const entries = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".yaml"))
        .sort();
    const profiles = [];
    for (const name of entries) {
        const full = path.join(dir, name);
        try {
            profiles.push(loadProfile(full));
        }
        catch (e) {
            if (e instanceof ProfileValueError)
                continue;
            // yaml.YAMLError is wrapped by ProfileValueError above; other
            // unexpected errors should propagate.
            const err = e;
            if (err && err.code === "ENOENT")
                continue;
            throw e;
        }
    }
    return profiles;
}
/**
 * Substring-score ORM detection: for each profile, count markers that
 * appear as substrings in ANY file content, then sort descending. Matches
 * Python's `detect_orm` semantics exactly (note: markers are matched as
 * literal substrings — they are NOT compiled as regex here, even when the
 * YAML pattern contains regex metacharacters).
 */
export function detectOrm(fileContents, profiles) {
    const pool = profiles ?? loadAllProfiles();
    const matches = [];
    let order = 0;
    for (const profile of pool) {
        let score = 0;
        for (const marker of profile.markers) {
            for (const content of Object.values(fileContents)) {
                if (content.includes(marker.pattern)) {
                    score += 1;
                    break;
                }
            }
        }
        if (score > 0) {
            matches.push({ score, order: order++, profile });
        }
    }
    // Stable sort by score desc, keeping insertion order for ties — Python's
    // list.sort is stable so this mirrors it.
    matches.sort((a, b) => b.score - a.score || a.order - b.order);
    return matches.map((m) => m.profile);
}
