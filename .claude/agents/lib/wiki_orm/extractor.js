import { getConnection, releaseConnection, SchemaManager, } from "../wiki_db/index.js";
/** Construct an entity with Python-style defaults. */
export function makeExtractedEntity(init) {
    return {
        class_name: init.class_name,
        table_name: init.table_name ?? "",
        schema_name: init.schema_name ?? "",
        columns: init.columns ?? [],
        relationships: init.relationships ?? [],
        source_file: init.source_file ?? "",
    };
}
/** Construct a column with Python-style defaults. */
export function makeExtractedColumn(init) {
    return {
        name: init.name,
        source_field: init.source_field ?? "",
    };
}
/** Construct a relationship with Python-style defaults. */
export function makeExtractedRelationship(init) {
    return {
        type: init.type,
        target_entity: init.target_entity ?? "",
        source_line: init.source_line ?? "",
    };
}
/**
 * Extract entity definitions from source files using an ORM profile.
 *
 * Mirrors `extractor.extract_entities`: outer loop over files; inner loop
 * over each `class_pattern` match; `table_pattern` is searched globally
 * over the file (first match wins, matching Python's `re.search`).
 */
export function extractEntities(fileContents, profile) {
    const entities = [];
    if (!profile.class_pattern)
        return entities;
    const classRe = new RegExp(profile.class_pattern, "gm");
    const tableRe = profile.table_pattern
        ? new RegExp(profile.table_pattern, "s")
        : null;
    const columnRe = profile.column_pattern
        ? new RegExp(profile.column_pattern, "g")
        : null;
    for (const [filePath, content] of Object.entries(fileContents)) {
        // Reset lastIndex between files — `class_pattern` is a `g` regex and
        // stateful between calls otherwise.
        classRe.lastIndex = 0;
        let match;
        while ((match = classRe.exec(content)) !== null) {
            const className = match[1];
            if (className === undefined) {
                // Defensive: class_pattern is expected to have >=1 capture group;
                // if somehow missing, skip so we don't emit `undefined` downstream.
                continue;
            }
            const entity = makeExtractedEntity({
                class_name: className,
                source_file: filePath,
            });
            // Table name — first match of `table_pattern` anywhere in the file.
            // This exactly matches Python's `re.search` (which is called ONCE
            // per class iteration but always returns the SAME first match, since
            // the content does not change across iterations).
            if (tableRe) {
                const tableMatch = tableRe.exec(content);
                if (tableMatch) {
                    entity.table_name = tableMatch[1] ?? "";
                    if (tableMatch.length > 2 && tableMatch[2]) {
                        entity.schema_name = tableMatch[2];
                    }
                }
            }
            // If no explicit table name, fall back to naming convention.
            if (!entity.table_name) {
                entity.table_name = classToTable(className, profile);
            }
            // Columns — every `column_pattern` match in the file.
            if (columnRe) {
                columnRe.lastIndex = 0;
                let colMatch;
                while ((colMatch = columnRe.exec(content)) !== null) {
                    const colName = colMatch[1];
                    if (colName === undefined) {
                        // Advance the regex if the pattern matched zero-width to avoid
                        // an infinite loop.
                        if (colMatch.index === columnRe.lastIndex)
                            columnRe.lastIndex++;
                        continue;
                    }
                    entity.columns.push(makeExtractedColumn({ name: colName, source_field: colName }));
                    // Guard against zero-width matches stalling the loop.
                    if (colMatch.index === columnRe.lastIndex)
                        columnRe.lastIndex++;
                }
            }
            // Relationships — each pattern is tested with `re.search` (truthy
            // check) against the whole file.
            for (const rel of profile.relationship_patterns) {
                try {
                    const rre = new RegExp(rel.pattern);
                    if (rre.test(content)) {
                        entity.relationships.push(makeExtractedRelationship({
                            type: rel.type,
                            source_line: rel.pattern,
                        }));
                    }
                }
                catch {
                    // Invalid regex — Python would raise `re.error`. Skip silently
                    // to keep the loop going; the Python source does not catch this
                    // either, but shipped patterns are all valid.
                }
            }
            entities.push(entity);
        }
    }
    return entities;
}
/** Infer table name from class name based on naming conventions. */
function classToTable(className, profile) {
    const convention = profile.naming_conventions["table_from_class"] ?? "snake_case";
    if (convention === "lower_case")
        return className.toLowerCase();
    if (convention === "snake_case")
        return toSnakeCase(className);
    if (convention === "snake_case_plural")
        return toSnakeCase(className) + "s";
    return className.toLowerCase();
}
/**
 * Convert CamelCase to snake_case.
 *
 * Python implementation:
 *   re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", name).lower()
 *
 * JS supports lookbehind since ES2018 (Node >= 10) so this port is literal.
 */
function toSnakeCase(name) {
    return name.replace(/(?<=[a-z0-9])([A-Z])/g, "_$1").toLowerCase();
}
/** Compose a table's full name — `<schema>.<name>` when schema is set. */
function tableKey(schema, name) {
    return schema ? `${schema}.${name}` : name;
}
/**
 * Compare entities extracted from code against the live database schema
 * for `envName`. Connects via wiki_db's connection pool, queries the
 * schema via `SchemaManager`, and diffs the two.
 *
 * NEVER throws — connection / query failures yield a report whose
 * `error` field is set and whose arrays are empty (except `orphan_entities`
 * which is all of `entities`, because nothing validated).
 */
export async function crossValidate(entities, envName, tableFilter = null) {
    const report = {
        matched: [],
        column_mismatches: [],
        unmapped_tables: [],
        orphan_entities: [],
    };
    let conn = null;
    let tables;
    try {
        conn = getConnection(envName);
        const mgr = new SchemaManager(conn.driver);
        tables = await mgr.getSchema(conn.native, envName, "", tableFilter);
    }
    catch (e) {
        report.error = e.message;
        report.orphan_entities = entities.map((ent) => ent.class_name);
        if (conn) {
            try {
                releaseConnection(envName, conn);
            }
            catch { /* best-effort */ }
        }
        return report;
    }
    finally {
        if (conn) {
            try {
                releaseConnection(envName, conn);
            }
            catch { /* best-effort */ }
        }
    }
    // Build lookup structures from the DB schema.
    const dbTablesByKey = new Map();
    for (const t of tables)
        dbTablesByKey.set(tableKey(t.schema, t.name), t);
    const dbTablesByName = new Map();
    for (const t of tables) {
        if (!dbTablesByName.has(t.name))
            dbTablesByName.set(t.name, t);
    }
    const matchedTableKeys = new Set();
    for (const ent of entities) {
        const direct = tableKey(ent.schema_name, ent.table_name);
        let dbTable = dbTablesByKey.get(direct);
        if (dbTable === undefined && !ent.schema_name) {
            dbTable = dbTablesByName.get(ent.table_name);
        }
        if (dbTable === undefined) {
            report.orphan_entities.push(ent.class_name);
            continue;
        }
        const fullKey = tableKey(dbTable.schema, dbTable.name);
        matchedTableKeys.add(fullKey);
        report.matched.push({ entity: ent.class_name, table: fullKey });
        const dbCols = new Set(dbTable.columns.map((c) => c.name));
        const codeCols = new Set(ent.columns.map((c) => c.name));
        for (const field of codeCols) {
            if (!dbCols.has(field)) {
                report.column_mismatches.push({
                    entity: ent.class_name,
                    table: fullKey,
                    entity_field: field,
                    reason: "missing_in_db",
                });
            }
        }
        for (const col of dbCols) {
            if (!codeCols.has(col)) {
                report.column_mismatches.push({
                    entity: ent.class_name,
                    table: fullKey,
                    entity_field: col,
                    reason: "missing_in_code",
                });
            }
        }
    }
    for (const [key] of dbTablesByKey) {
        if (!matchedTableKeys.has(key))
            report.unmapped_tables.push(key);
    }
    report.unmapped_tables.sort();
    report.orphan_entities.sort();
    report.column_mismatches.sort((a, b) => {
        if (a.entity !== b.entity)
            return a.entity < b.entity ? -1 : 1;
        if (a.entity_field !== b.entity_field) {
            return a.entity_field < b.entity_field ? -1 : 1;
        }
        return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
    });
    return report;
}
