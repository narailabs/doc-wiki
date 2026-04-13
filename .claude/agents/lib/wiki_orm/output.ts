/**
 * output.ts — produces `database-mapping.md` with a Mermaid ER diagram.
 *
 * Byte-for-byte match against the Python reference (`output.py`). String
 * concatenation is used throughout — there is no JSON or number formatting
 * involved, so the `_json_py` helper is intentionally not imported here.
 */
import type { ExtractedEntity } from "./extractor.js";

export interface GenerateMappingOptions {
  project_name?: string;
  orm_profile?: string;
  unmapped_tables?: string[];
  dual_access_tables?: string[];
}

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

    // Relationships — dedupe by (table_name, rel_type) pair.
    const seenRels = new Set<string>();
    for (const entity of entities) {
      for (const rel of entity.relationships) {
        if (rel.type === "one_to_many" || rel.type === "many_to_many") {
          const relKey = `${entity.table_name}\x00${rel.type}`;
          if (!seenRels.has(relKey)) {
            seenRels.add(relKey);
            const cardinality =
              rel.type === "one_to_many" ? "||--o{" : "}o--o{";
            lines.push(
              `    ${entity.table_name} ${cardinality} ${entity.table_name}_rel : ""`,
            );
          }
        }
      }
    }

    lines.push("```");
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
