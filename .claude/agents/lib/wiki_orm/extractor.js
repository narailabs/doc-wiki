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
    const out = {
        type: init.type,
        target_entity: init.target_entity ?? "",
        source_line: init.source_line ?? "",
    };
    if (init.through_table !== undefined && init.through_table.length > 0) {
        out.through_table = init.through_table;
    }
    return out;
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
        // Pass 1 — collect every class match position in the file. We window
        // table/column/relationship extraction to the character range that
        // belongs to each class (from its own `class` keyword up to the next
        // `class` keyword or EOF). This replaces the earlier "first match
        // wins globally" behaviour, which collapsed a file of N classes with
        // N distinct `__table__` declarations into N entities that all
        // shared the first table. The windowed scan also prevents columns
        // and relationships defined in class B from bleeding into class A.
        classRe.lastIndex = 0;
        const classMatches = [];
        let cm;
        while ((cm = classRe.exec(content)) !== null) {
            if (cm[1] !== undefined) {
                classMatches.push({ className: cm[1], start: cm.index });
            }
            if (cm.index === classRe.lastIndex)
                classRe.lastIndex++;
        }
        // Pass 2 — iterate over each class and scope pattern matching to its
        // own window. Keep the per-class fallback to `classToTable` for
        // profiles whose `table_pattern` doesn't match; the fallback is what
        // lets a BaseModel-style ORM rely purely on naming convention when
        // no explicit `__table__` is declared.
        for (let i = 0; i < classMatches.length; i++) {
            const classMatch = classMatches[i];
            if (classMatch === undefined)
                continue;
            const { className, start } = classMatch;
            const nextClassMatch = classMatches[i + 1];
            const end = nextClassMatch !== undefined ? nextClassMatch.start : content.length;
            const windowText = content.slice(start, end);
            const entity = makeExtractedEntity({
                class_name: className,
                source_file: filePath,
            });
            // Table name — first match of `table_pattern` WITHIN this class's
            // window. Python's `re.search` semantics are preserved at the
            // window level: first match wins for the scope we care about.
            if (tableRe) {
                tableRe.lastIndex = 0;
                const tableMatch = tableRe.exec(windowText);
                if (tableMatch) {
                    entity.table_name = tableMatch[1] ?? "";
                    if (tableMatch.length > 2 && tableMatch[2]) {
                        entity.schema_name = tableMatch[2];
                    }
                }
            }
            if (!entity.table_name) {
                entity.table_name = classToTable(className, profile);
            }
            // Columns — every `column_pattern` match within the class window.
            if (columnRe) {
                columnRe.lastIndex = 0;
                let colMatch;
                while ((colMatch = columnRe.exec(windowText)) !== null) {
                    const colName = colMatch[1];
                    if (colName === undefined) {
                        if (colMatch.index === columnRe.lastIndex)
                            columnRe.lastIndex++;
                        continue;
                    }
                    entity.columns.push(makeExtractedColumn({ name: colName, source_field: colName }));
                    if (colMatch.index === columnRe.lastIndex)
                        columnRe.lastIndex++;
                }
            }
            // Relationships — find every match of each pattern within the class
            // window, then resolve the target entity from the field declaration
            // that follows (generic type argument or simple field type).
            // G-ORM-PROFILE-VALIDATE: patterns are compiled and validated in
            // loadProfile, so RegExp construction here cannot fail on a valid
            // profile. Any throw is a bug in the loader, not user input.
            for (const rel of profile.relationship_patterns) {
                const rre = new RegExp(rel.pattern, "g");
                let relMatch;
                while ((relMatch = rre.exec(windowText)) !== null) {
                    const matchEnd = relMatch.index + relMatch[0].length;
                    const tail = windowText.slice(matchEnd, matchEnd + 300);
                    // P1: profiles can embed a capture group to pull the target
                    // type out of the matched substring directly — useful for ORMs
                    // like Prisma where the type is declared BEFORE the marker
                    // (e.g. `author User @relation(...)` — target is `User`, but
                    // the tail after `@relation` only sees the arg list). We take
                    // the first capture group if present and it looks like a class
                    // identifier (uppercase start); otherwise fall back to the
                    // tail-based resolver so existing profiles (JPA, SQLAlchemy,
                    // TypeORM, etc.) that don't declare a capture group keep their
                    // current behaviour.
                    const captured = relMatch[1];
                    const target = captured && /^[A-Z]/.test(captured)
                        ? captured
                        : _resolveRelationshipTarget(tail);
                    // A1: SQLAlchemy `relationship("Role", secondary=user_roles)` —
                    // when a `secondary=<ident>` kwarg is visible inside the call's
                    // argument tail, capture the bridge-table name and promote the
                    // relationship's effective cardinality to many-to-many. We only
                    // scan the tail since the relationship pattern already anchored
                    // us at the open paren; reading further would risk picking up a
                    // sibling call's `secondary=` on a different line.
                    const through = _resolveSecondaryThroughTable(tail);
                    const built = makeExtractedRelationship({
                        type: through !== "" ? "many_to_many" : rel.type,
                        target_entity: target,
                        source_line: rel.pattern,
                        through_table: through,
                    });
                    entity.relationships.push(built);
                    if (relMatch.index === rre.lastIndex)
                        rre.lastIndex++;
                }
            }
            entities.push(entity);
        }
    }
    return entities;
}
/**
 * Try to resolve the target entity class for a relationship from the code
 * that follows the relationship annotation or call.
 *
 * Recognises three shapes — the order matters only insofar as the most
 * specific (call first-arg) is tried first so the generic/field patterns
 * can't spuriously match the parenthesised argument list:
 *
 *   1. Call first argument — e.g., `relationship("Order", ...)`,
 *      `ForeignKey("users.id")`, `belongs_to(:author)`. The profile's
 *      relationship_pattern is expected to include the opening `(` so
 *      the context starts at the first argument. Works for SQLAlchemy
 *      (`relationship(...)`, `ForeignKey(...)`), ActiveRecord
 *      (`belongs_to :author`), and any other ORM whose relationships
 *      are function-call-shaped.
 *
 *   2. Generic collection types — `List<Foo>`, `Set<Foo>`, `Collection<Foo>`.
 *      The JPA path uses this to recover the target from a field like
 *      `private List<Order> orders;` following `@OneToMany`.
 *
 *   3. Simple field types — `Foo foo;` or modifiers + `Foo foo;`.
 *      JPA fallback for `@ManyToOne private User user;`.
 *
 * For the call-first-arg path, a dotted reference like `"users.id"`
 * (SQLAlchemy ForeignKey) is collapsed to its table part (`users`) since
 * the column qualifier isn't needed for diagram node resolution.
 *
 * Returns "" when no plausible target is visible in the 300-char window.
 */
function _resolveRelationshipTarget(context) {
    // T3: TypeORM arrow-function — `@OneToMany(() => Book, (book) => book.author)`.
    // The relationship pattern anchors us at the open paren, so `context`
    // begins with `() => ClassName, ...`. The leading `(` breaks the
    // call-first-arg regex below (which expects an identifier or quote),
    // so we try the arrow-function shape first: match `(<anything>) => Name`
    // and capture the ClassName token. The class name must begin with an
    // uppercase letter, matching TypeScript/JS convention for class
    // identifiers — this prevents over-matching on `() => someHelper(...)`.
    const arrowFnMatch = /^\s*\([^)]*\)\s*=>\s*([A-Z][A-Za-z_]\w*)\s*[,)]/.exec(context);
    if (arrowFnMatch && arrowFnMatch[1]) {
        return arrowFnMatch[1];
    }
    // 1. Call first argument — quoted string, bare identifier, or Ruby symbol.
    // Accept the common quote/symbol prefixes (", ', :) then capture the
    // identifier (including dots for "table.column" FK refs), then expect a
    // closing quote/comma/paren so we don't over-match.
    const callArgMatch = /^\s*(?:[:"'])?([A-Za-z_][\w.]*)(?:["'])?\s*[,)]/.exec(context);
    if (callArgMatch && callArgMatch[1]) {
        const raw = callArgMatch[1];
        // FK-style "table.column" → take the table part only.
        const target = raw.includes(".") ? (raw.split(".")[0] ?? raw) : raw;
        // Reject lowercase-only keyword-ish captures like `lazy` or `true` so
        // we don't mis-classify a non-target argument as the target.
        if (/^[A-Z]/.test(target) || target.length > 3) {
            return target;
        }
    }
    // 2. Generic type argument — JPA collection shape.
    const genericMatch = /<\s*(\w+)\s*>/.exec(context);
    if (genericMatch && genericMatch[1]) {
        return genericMatch[1];
    }
    // 3. Simple field declaration — JPA scalar shape.
    const fieldMatch = /(?:private|protected|public|final|static|\s)+([A-Z]\w+)\s+\w+\s*[;=]/.exec(context);
    if (fieldMatch && fieldMatch[1]) {
        return fieldMatch[1];
    }
    return "";
}
/**
 * A1: extract the bridge-table identifier from a `secondary=<ident>` kwarg
 * inside a SQLAlchemy `relationship(...)` call's argument list.
 *
 * The relationship-extraction loop hands us the 300-char tail STARTING right
 * after the opening `relationship(` paren. To avoid sibling calls bleeding in
 * (e.g., `roles = relationship("Role", secondary=user_roles)` on the next
 * line picking up "user_roles" for the previous call), we scan only up to
 * the matching close paren of THIS call. The matcher tracks paren depth so
 * nested function arguments like `secondary=Table(...)` stay scoped.
 *
 * Two value shapes are accepted for the kwarg:
 *   secondary=user_roles       → bare identifier (Python variable reference,
 *                                the canonical SQLAlchemy idiom)
 *   secondary="user_roles"     → quoted string (legacy form, kept for
 *                                back-compat with older fixtures)
 *
 * Returns "" when no `secondary=` is visible inside the current call. Callers
 * treat the empty-string sentinel as "no bridge table"; output.ts then
 * renders the default cardinality without the `%%` bridge-comment.
 */
function _resolveSecondaryThroughTable(context) {
    // Walk forward from the start of the argument list, counting parens, so
    // we can stop the search at the matching `)` of THIS relationship call.
    // We start at depth 1 because the caller's tail begins inside the open
    // paren — so the call's own close-paren takes us back to 0.
    let depth = 1;
    let endIdx = context.length;
    for (let i = 0; i < context.length; i++) {
        const ch = context[i];
        if (ch === "(") {
            depth++;
        }
        else if (ch === ")") {
            depth--;
            if (depth === 0) {
                endIdx = i;
                break;
            }
        }
    }
    const scope = context.slice(0, endIdx);
    const m = /\bsecondary\s*=\s*(?:["']([\w.]+)["']|([A-Za-z_]\w*))/.exec(scope);
    if (!m)
        return "";
    return m[1] ?? m[2] ?? "";
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
export async function crossValidate(entities, envName, tableFilter, dbProvider) {
    const report = {
        matched: [],
        column_mismatches: [],
        unmapped_tables: [],
        orphan_entities: [],
    };
    if (!dbProvider) {
        report.error = "Database provider not available for cross-validation";
        report.orphan_entities = entities.map((ent) => ent.class_name);
        return report;
    }
    let tables;
    try {
        tables = await dbProvider.getSchema(envName, tableFilter);
    }
    catch (e) {
        report.error = e.message;
        report.orphan_entities = entities.map((ent) => ent.class_name);
        return report;
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
