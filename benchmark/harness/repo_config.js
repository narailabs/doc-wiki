import { readFileSync } from "node:fs";
import { load } from "js-yaml";
function isoDate(v) {
    // js-yaml's default schema parses unquoted YAML timestamps into Date objects.
    if (v instanceof Date)
        return v.toISOString().slice(0, 10);
    return String(v);
}
export function loadRepoConfig(path) {
    const raw = load(readFileSync(path, "utf8"));
    if (typeof raw !== "object" || raw === null)
        throw new Error(`${path}: not a YAML mapping`);
    const cfg = raw;
    const required = [
        "id", "github", "clone_url", "language", "ticket_source",
        "install", "test_command", "test_patterns", "ticket_after", "toolchain",
    ];
    for (const k of required) {
        if (cfg[k] === undefined || cfg[k] === null)
            throw new Error(`${path}: missing required key "${k}"`);
    }
    if (cfg.ticket_source !== "github" && cfg.ticket_source !== "trac-commits") {
        throw new Error(`${path}: ticket_source must be "github" or "trac-commits"`);
    }
    if (typeof cfg.test_command !== "string" || !cfg.test_command.includes("{test_files}")) {
        throw new Error(`${path}: test_command must contain the "{test_files}" placeholder`);
    }
    if (!Array.isArray(cfg.test_patterns) || cfg.test_patterns.length === 0) {
        throw new Error(`${path}: test_patterns must be a non-empty list`);
    }
    if (!Array.isArray(cfg.install))
        throw new Error(`${path}: install must be a list`);
    if (!cfg.install.every((e) => typeof e === "string")) {
        throw new Error(`${path}: every install entry must be a string`);
    }
    if (!Array.isArray(cfg.toolchain))
        throw new Error(`${path}: toolchain must be a list`);
    if (!cfg.toolchain.every((e) => typeof e === "string")) {
        throw new Error(`${path}: every toolchain entry must be a string`);
    }
    const ticketAfter = isoDate(cfg.ticket_after);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ticketAfter)) {
        throw new Error(`${path}: ticket_after must be YYYY-MM-DD, got "${ticketAfter}"`);
    }
    const retries = cfg.test_retries === undefined ? 0 : Number(cfg.test_retries);
    if (!Number.isInteger(retries) || retries < 0) {
        throw new Error(`${path}: test_retries must be a non-negative integer`);
    }
    return {
        id: String(cfg.id),
        github: String(cfg.github),
        clone_url: String(cfg.clone_url),
        language: String(cfg.language),
        ticket_source: cfg.ticket_source,
        install: cfg.install.map(String),
        test_command: cfg.test_command,
        test_patterns: cfg.test_patterns.map(String),
        test_retries: retries,
        ticket_after: ticketAfter,
        wiki_commit: cfg.wiki_commit === undefined ? "" : String(cfg.wiki_commit),
        toolchain: cfg.toolchain.map(String),
        services: Array.isArray(cfg.services) ? cfg.services.map(String) : [],
    };
}
