/**
 * output.ts — produces `database-mapping.md` with a Mermaid ER diagram.
 *
 * Byte-for-byte match against the Python reference (`output.py`). String
 * concatenation is used throughout — there is no JSON or number formatting
 * involved, so the `_json_py` helper is intentionally not imported here.
 */
import type { ExtractedEntity, CrossValidationReport } from "./extractor.js";

export interface GenerateMappingOptions {
  project_name?: string;
  orm_profile?: string;
  unmapped_tables?: string[];
  dual_access_tables?: string[];
  cross_validation?: CrossValidationReport;
  /**
   * G-ORM-DEEPER: environment name used by the "How to Go Deeper"
   * `wiki agent db-query <env> ...` commands. Defaults to "dev" when
   * omitted — matches the example in v2 §5 of the design report.
   */
  env?: string;
}

/** G-ORM-DEEPER: cap on sample queries emitted in "How to Go Deeper". */
const HOW_TO_GO_DEEPER_MAX_ENTITIES = 10;

/**
 * Generate the `database-mapping.md` contents.
 *
 * The second positional parameter in the Python signature (`project_name`)
 * becomes the `project_name` option here. The TS call sites pass them by
 * name, which is clearer than the three-positional Python form.
 */
export function generateMappingMarkdown(
  entities: ExtractedEntity[],
  projectName: string = "Project",
  ormProfile: string = "unknown",
  unmappedTables?: string[],
  dualAccessTables?: string[],
  crossValidation?: CrossValidationReport,
  env: string = "dev",
): string {
  const today = isoToday();
  const unmapped = unmappedTables ?? [];
  const dual = dualAccessTables ?? [];

  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`title: Database Mapping \u2014 ${projectName}`);
  lines.push("type: entity");
  const tags = ["database", "orm", ormProfile];
  lines.push(`tags: [${tags.join(", ")}]`);
  lines.push("generated_by: orm-mapper");
  lines.push(`orm_profile: ${ormProfile}`);
  lines.push(`created: ${today}`);
  lines.push(`updated: ${today}`);
  lines.push(
    `summary: "Auto-generated database mapping for ${projectName} using ${ormProfile} ORM profile."`,
  );
  lines.push("---");
  lines.push("");

  // Entity-Table Mapping
  lines.push("## Entity-Table Mapping");
  lines.push("");
  lines.push("| Entity Class | Schema.Table | Columns | Relationships |");
  lines.push("|---|---|---|---|");

  for (const entity of entities) {
    const schemaTable = entity.schema_name
      ? `${entity.schema_name}.${entity.table_name}`
      : entity.table_name;
    const colCount = entity.columns.length;
    const relTypes = entity.relationships.map((r) => r.type);
    const relStr = relTypes.length > 0 ? relTypes.join(", ") : "\u2014";
    lines.push(
      `| ${entity.class_name} | ${schemaTable} | ${colCount} | ${relStr} |`,
    );
  }

  lines.push("");

  // Unmapped tables
  if (unmapped.length > 0) {
    lines.push("## Unmapped Tables");
    lines.push("");
    lines.push("Tables in the database with no corresponding entity:");
    lines.push("");
    for (const table of unmapped) lines.push(`- \`${table}\``);
    lines.push("");
  }

  // Dual access
  if (dual.length > 0) {
    lines.push("## Dual-Access Tables");
    lines.push("");
    lines.push("Tables accessed by BOTH ORM entities AND direct queries:");
    lines.push("");
    for (const table of dual) lines.push(`- \`${table}\``);
    lines.push("");
  }

  // Cross-validation against live DB (G2). Emitted AFTER Dual-Access and
  // BEFORE the Mermaid ER diagram. Per §5 of the v2 report: flag tables
  // present in DB but unmapped, entities with no matching table, and
  // per-column mismatches.
  if (crossValidation !== undefined) {
    lines.push("## Cross-Validation");
    lines.push("");
    if (crossValidation.error !== undefined) {
      lines.push(
        `Validation could not run: \`${crossValidation.error}\`. ` +
          "Entity ↔ DB schema diff is unavailable.",
      );
      lines.push("");
    } else {
      if (crossValidation.unmapped_tables.length > 0) {
        lines.push("### Unmapped DB Tables");
        lines.push("");
        lines.push("Tables present in the live DB with no matching entity:");
        lines.push("");
        for (const t of crossValidation.unmapped_tables) {
          lines.push(`- \`${t}\``);
        }
        lines.push("");
      }
      if (crossValidation.orphan_entities.length > 0) {
        lines.push("### Orphan Entities");
        lines.push("");
        lines.push(
          "Entities extracted from code with no matching table in the DB:",
        );
        lines.push("");
        for (const e of crossValidation.orphan_entities) {
          lines.push(`- \`${e}\``);
        }
        lines.push("");
      }
      if (crossValidation.column_mismatches.length > 0) {
        lines.push("### Column Mismatches");
        lines.push("");
        lines.push("| Entity | Table | Field | Reason |");
        lines.push("|---|---|---|---|");
        for (const m of crossValidation.column_mismatches) {
          lines.push(
            `| ${m.entity} | ${m.table} | ${m.entity_field} | ${m.reason} |`,
          );
        }
        lines.push("");
      }
      if (
        crossValidation.unmapped_tables.length === 0 &&
        crossValidation.orphan_entities.length === 0 &&
        crossValidation.column_mismatches.length === 0
      ) {
        lines.push(
          "All extracted entities match the live DB schema. No mismatches detected.",
        );
        lines.push("");
      }
    }
  }

  // Mermaid ER diagram
  if (entities.length > 0) {
    lines.push("## Entity Relationship Diagram");
    lines.push("");
    lines.push("```mermaid");
    lines.push("erDiagram");
    for (const entity of entities) {
      const table = entity.table_name;
      if (entity.columns.length > 0) {
        lines.push(`    ${table} {`);
        for (const col of entity.columns) {
          lines.push(`        string ${col.name}`);
        }
        lines.push("    }");
      }
    }

    // Relationships + stubs for external targets.
    //
    // Any relationship type with a resolvable cardinality gets an edge.
    // Earlier iterations only rendered `one_to_many` and `many_to_many`,
    // which meant SQLAlchemy's generic `relationship` type, `foreign_key`
    // declarations, `many_to_one`, and `one_to_one` all produced zero
    // Mermaid edges — a class with 3 relationship() declarations would
    // show as 3 isolated nodes. The table below maps every extractor
    // relationship type to a Mermaid cardinality so the diagram matches
    // the entity-table mapping markdown above it.
    const CARDINALITY: Record<string, string> = {
      one_to_one: "||--||",
      one_to_many: "||--o{",
      many_to_one: "}o--||",
      many_to_many: "}o--o{",
      foreign_key: "}o--||",
      relationship: "||--o{",
    };

    const tableByClass = new Map<string, string>();
    for (const e of entities) tableByClass.set(e.class_name, e.table_name);

    // When a relationship's `target_entity` names a class that WASN'T
    // extracted, emit a minimal stub declaration so every endpoint in
    // the diagram resolves to a real node (otherwise the rendered
    // diagram shows a nameless empty box where the stub should be).
    const externalStubs = new Set<string>();
    for (const entity of entities) {
      for (const rel of entity.relationships) {
        if (!(rel.type in CARDINALITY)) continue;
        if (rel.target_entity && !tableByClass.has(rel.target_entity)) {
          externalStubs.add(rel.target_entity.toLowerCase());
        }
      }
    }
    for (const stub of Array.from(externalStubs).sort()) {
      lines.push(`    ${stub} {`);
      lines.push(`        string _external "not-in-scan"`);
      lines.push(`    }`);
    }

    // Edge emission with two layers of dedup:
    //
    //   1. (src, tgt, rel_type) — guards against the same relationship being
    //      declared twice on one class (e.g., two `@OneToMany` to the same
    //      target). This is the historical dedup.
    //
    //   2. A2: bidirectional pair canonicalization — when we have BOTH
    //      `User.one_to_many → Order` AND `Order.many_to_one → User`, both
    //      describe the same underlying FK. The Mermaid diagram should show
    //      one edge, not two arrows in opposite directions. We canonicalize
    //      by the unordered pair {table_a, table_b} and prefer the side that
    //      reads more naturally (one_to_many > many_to_one; many_to_many
    //      always wins because it's symmetric anyway). When neither side is
    //      "natural-form" we keep the first one we saw — stable, matches
    //      pre-A2 ordering for unrelated edges.
    //
    // The bridge-table comment (A1, SQLAlchemy `secondary=`) is rendered as a
    // `%%`-prefixed Mermaid comment on the line above the edge so it travels
    // with the diagram across renderers without altering the parsed graph.

    /** Order one_to_many before its inverse so we prefer the readable side. */
    const directionRank: Record<string, number> = {
      many_to_many: 0,
      one_to_many: 1,
      one_to_one: 2,
      relationship: 3,
      many_to_one: 4,
      foreign_key: 5,
    };

    interface EdgeEmission {
      src: string;
      tgt: string;
      relType: string;
      cardinality: string;
      through?: string;
    }

    const seenRels = new Set<string>();
    const candidates: EdgeEmission[] = [];
    for (const entity of entities) {
      for (const rel of entity.relationships) {
        const cardinality = CARDINALITY[rel.type];
        if (cardinality === undefined) continue;
        const targetTable = rel.target_entity
          ? (tableByClass.get(rel.target_entity) ??
            rel.target_entity.toLowerCase())
          : `${entity.table_name}_rel`;
        const relKey = `${entity.table_name}\x00${targetTable}\x00${rel.type}`;
        if (seenRels.has(relKey)) continue;
        seenRels.add(relKey);
        candidates.push({
          src: entity.table_name,
          tgt: targetTable,
          relType: rel.type,
          cardinality,
          through: rel.through_table,
        });
      }
    }

    // A2: canonicalize bidirectional pairs. Bucket by unordered pair-key,
    // pick the highest-ranked emission per bucket.
    const pairBuckets = new Map<string, EdgeEmission[]>();
    for (const c of candidates) {
      const a = c.src;
      const b = c.tgt;
      const key = a < b ? `${a}\x00${b}` : `${b}\x00${a}`;
      const bucket = pairBuckets.get(key);
      if (bucket === undefined) pairBuckets.set(key, [c]);
      else bucket.push(c);
    }
    const emittedKeys = new Set<string>();
    for (const c of candidates) {
      const a = c.src;
      const b = c.tgt;
      const pairKey = a < b ? `${a}\x00${b}` : `${b}\x00${a}`;
      if (emittedKeys.has(pairKey)) continue;
      const bucket = pairBuckets.get(pairKey) ?? [c];
      // Select the lowest-rank (highest-priority) emission. Tie-break on
      // insertion order via stable sort.
      const winner = [...bucket].sort(
        (x, y) =>
          (directionRank[x.relType] ?? 99) - (directionRank[y.relType] ?? 99),
      )[0];
      if (winner === undefined) continue;
      emittedKeys.add(pairKey);
      if (winner.through !== undefined && winner.through.length > 0) {
        // A1: surface the bridge table as a Mermaid comment so the diagram
        // documents WHICH join object brokers the m2m relationship. `%%`
        // is the Mermaid comment marker — ignored by the parser, visible
        // in the source.
        lines.push(`    %% via ${winner.through}`);
      }
      lines.push(
        `    ${winner.src} ${winner.cardinality} ${winner.tgt} : ""`,
      );
    }

    lines.push("```");
    lines.push("");
  }

  // G-ORM-DEEPER: "How to Go Deeper" section.
  //
  // Per v2 §5 (example) and §8 (self-describing docs), DB-backed pages must
  // include per-entity commands for live verification. Omit entirely when
  // there are no entities (nothing to reference).
  if (entities.length > 0) {
    lines.push("## How to Go Deeper");
    lines.push("");
    lines.push(
      "This page was compiled from ORM source files. Use these commands to " +
        "verify or update the information against the live database:",
    );
    lines.push("");

    const sample = entities.slice(0, HOW_TO_GO_DEEPER_MAX_ENTITIES);
    for (const entity of sample) {
      const qualified = entity.schema_name
        ? `${entity.schema_name}.${entity.table_name}`
        : entity.table_name;
      lines.push(`- **${entity.class_name}** (\`${qualified}\`)`);
      lines.push(
        `  - Columns: \`wiki agent db-query ${env} ` +
          `"SELECT column_name, data_type FROM information_schema.columns ` +
          `WHERE table_name = '${entity.table_name}'"\``,
      );
      lines.push(
        `  - Sample rows: \`wiki agent db-query ${env} ` +
          `"SELECT * FROM ${qualified} LIMIT 5"\``,
      );
    }
    if (entities.length > HOW_TO_GO_DEEPER_MAX_ENTITIES) {
      lines.push(
        `- ... and ${entities.length - HOW_TO_GO_DEEPER_MAX_ENTITIES} more ` +
          "entities (see the Entity-Table Mapping table above).",
      );
    }

    // Source files — one bullet per unique source so the reader can Read
    // the original ORM definition and regenerate the map if drift is
    // suspected.
    const uniqueSources = new Set(
      entities
        .map((e) => e.source_file)
        .filter((f): f is string => typeof f === "string" && f.length > 0),
    );
    if (uniqueSources.size > 0) {
      lines.push(
        `- **Live code:** Read ${[...uniqueSources]
          .slice(0, 5)
          .map((f) => `\`${f}\``)
          .join(", ")}${
          uniqueSources.size > 5 ? ` (+${uniqueSources.size - 5} more)` : ""
        } — ORM source files this mapping was extracted from.`,
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Overload-like struct form that matches the Python kwarg style. Kept
 * separate so tests can prefer whichever spelling reads best.
 */
export function generateMappingMarkdownOpts(
  entities: ExtractedEntity[],
  opts: GenerateMappingOptions = {},
): string {
  return generateMappingMarkdown(
    entities,
    opts.project_name,
    opts.orm_profile,
    opts.unmapped_tables,
    opts.dual_access_tables,
    opts.cross_validation,
    opts.env,
  );
}

/**
 * Mirror of Python's `date.today().isoformat()` in the caller's local
 * timezone — `output.py` uses naive `date.today()`, which is local.
 */
function isoToday(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
