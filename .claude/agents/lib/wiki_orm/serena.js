import { makeExtractedColumn, makeExtractedEntity, makeExtractedRelationship, } from "./extractor.js";
/**
 * Build the Serena query plan for a given ORM profile. Patterns here
 * mirror the ones the regex extractor uses — we don't invent new
 * patterns, we just hand them to Serena instead of running them locally.
 */
export function buildExtractionRequest(profile) {
    const patterns = [];
    if (profile.class_pattern) {
        for (const fp of profile.file_patterns) {
            patterns.push({
                kind: "entity_class",
                pattern: profile.class_pattern,
                file_pattern: fp,
            });
        }
    }
    if (profile.table_pattern) {
        for (const fp of profile.file_patterns) {
            patterns.push({
                kind: "table_name",
                pattern: profile.table_pattern,
                file_pattern: fp,
            });
        }
    }
    if (profile.column_pattern) {
        for (const fp of profile.file_patterns) {
            patterns.push({
                kind: "column",
                pattern: profile.column_pattern,
                file_pattern: fp,
            });
        }
    }
    for (const rel of profile.relationship_patterns) {
        for (const fp of profile.file_patterns) {
            patterns.push({
                kind: "relationship",
                pattern: rel.pattern,
                file_pattern: fp,
                relationship_type: rel.type,
            });
        }
    }
    return {
        profile_name: profile.name,
        language: profile.language ?? "",
        file_patterns: profile.file_patterns,
        patterns,
    };
}
/**
 * Fold a batch of Serena matches back into `ExtractedEntity[]`. The
 * transformation is the inverse of `buildExtractionRequest`: each
 * `entity_class` match creates (or looks up) an entity; other kinds
 * attach to their `enclosing_class` entity.
 *
 * Matches missing `enclosing_class` are ignored (except `entity_class`,
 * which establishes one). This is deliberate — the orchestrator is
 * responsible for computing enclosure via Serena's symbol-graph tools.
 */
export function parseSerenaMatches(matches, profile) {
    const byClass = new Map();
    const classFiles = new Map();
    // First pass: establish entities from `entity_class` matches.
    for (const m of matches) {
        if (m.kind === "entity_class") {
            if (!byClass.has(m.capture)) {
                byClass.set(m.capture, makeExtractedEntity({
                    class_name: m.capture,
                    source_file: m.file,
                }));
                classFiles.set(m.capture, m.file);
            }
        }
    }
    // Second pass: attach table names, columns, relationships.
    for (const m of matches) {
        if (m.kind === "entity_class")
            continue;
        const className = m.enclosing_class;
        if (className === undefined)
            continue;
        const entity = byClass.get(className);
        if (entity === undefined)
            continue;
        if (m.kind === "table_name") {
            entity.table_name = m.capture;
            if (m.schema_capture)
                entity.schema_name = m.schema_capture;
        }
        else if (m.kind === "column") {
            const col = makeExtractedColumn({
                name: m.capture,
                source_field: m.capture,
            });
            // Dedupe — Serena may return the same column match multiple times
            // if `search_for_pattern` overlaps.
            if (!entity.columns.some((c) => c.name === col.name)) {
                entity.columns.push(col);
            }
        }
        else if (m.kind === "relationship") {
            const rel = makeExtractedRelationship({
                type: m.relationship_type ?? "relationship",
                target_entity: m.capture,
                source_line: m.file,
            });
            entity.relationships.push(rel);
        }
    }
    // Apply naming-convention fallback for entities whose table_name wasn't
    // captured by a `table_name` match (mirrors the regex extractor).
    for (const entity of byClass.values()) {
        if (!entity.table_name) {
            entity.table_name = classNameToTable(entity.class_name, profile);
        }
    }
    return [...byClass.values()];
}
function classNameToTable(className, profile) {
    const convention = profile.naming_conventions["table_from_class"] ?? "snake_case";
    if (convention === "lower_case")
        return className.toLowerCase();
    if (convention === "snake_case")
        return toSnakeCase(className);
    if (convention === "snake_case_plural")
        return toSnakeCase(className) + "s";
    return className.toLowerCase();
}
function toSnakeCase(name) {
    return name.replace(/(?<=[a-z0-9])([A-Z])/g, "_$1").toLowerCase();
}
