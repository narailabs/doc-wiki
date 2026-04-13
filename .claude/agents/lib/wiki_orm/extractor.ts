/**
 * extractor.ts — regex-based entity/relationship extraction.
 *
 * Ported 1:1 from `extractor.py`. The profile YAMLs contain Python-flavoured
 * regex strings, but no shipped pattern uses Python-only features, so each
 * pattern compiles cleanly into a JavaScript `RegExp`. The flag choices
 * mirror the Python call sites:
 *
 *   - `class_pattern`  → `gm`  (re.MULTILINE + finditer)
 *   - `table_pattern`  → `s`   (re.DOTALL + search, first match only)
 *   - `column_pattern` → `g`   (finditer, default flags)
 *   - relationship patterns → no flags (re.search truthiness)
 */
import type { OrmProfile } from "./profiles.js";

/** One column on an extracted entity. */
export interface ExtractedColumn {
  name: string;
  source_field: string;
}

/** One relationship (has_many / belongs_to / @OneToMany etc.) */
export interface ExtractedRelationship {
  /** one_to_many | many_to_one | many_to_many | one_to_one | relationship | foreign_key */
  type: string;
  target_entity: string;
  source_line: string;
}

/** One entity / table mapping. */
export interface ExtractedEntity {
  class_name: string;
  table_name: string;
  schema_name: string;
  columns: ExtractedColumn[];
  relationships: ExtractedRelationship[];
  source_file: string;
}

/** Construct an entity with Python-style defaults. */
export function makeExtractedEntity(
  init: Partial<ExtractedEntity> & { class_name: string },
): ExtractedEntity {
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
export function makeExtractedColumn(
  init: { name: string; source_field?: string },
): ExtractedColumn {
  return {
    name: init.name,
    source_field: init.source_field ?? "",
  };
}

/** Construct a relationship with Python-style defaults. */
export function makeExtractedRelationship(
  init: { type: string; target_entity?: string; source_line?: string },
): ExtractedRelationship {
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
export function extractEntities(
  fileContents: Record<string, string>,
  profile: OrmProfile,
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  if (!profile.class_pattern) return entities;

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

    let match: RegExpExecArray | null;
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
        let colMatch: RegExpExecArray | null;
        while ((colMatch = columnRe.exec(content)) !== null) {
          const colName = colMatch[1];
          if (colName === undefined) {
            // Advance the regex if the pattern matched zero-width to avoid
            // an infinite loop.
            if (colMatch.index === columnRe.lastIndex) columnRe.lastIndex++;
            continue;
          }
          entity.columns.push(
            makeExtractedColumn({ name: colName, source_field: colName }),
          );
          // Guard against zero-width matches stalling the loop.
          if (colMatch.index === columnRe.lastIndex) columnRe.lastIndex++;
        }
      }

      // Relationships — each pattern is tested with `re.search` (truthy
      // check) against the whole file.
      for (const rel of profile.relationship_patterns) {
        try {
          const rre = new RegExp(rel.pattern);
          if (rre.test(content)) {
            entity.relationships.push(
              makeExtractedRelationship({
                type: rel.type,
                source_line: rel.pattern,
              }),
            );
          }
        } catch {
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
function classToTable(className: string, profile: OrmProfile): string {
  const convention =
    profile.naming_conventions["table_from_class"] ?? "snake_case";
  if (convention === "lower_case") return className.toLowerCase();
  if (convention === "snake_case") return toSnakeCase(className);
  if (convention === "snake_case_plural") return toSnakeCase(className) + "s";
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
function toSnakeCase(name: string): string {
  return name.replace(/(?<=[a-z0-9])([A-Z])/g, "_$1").toLowerCase();
}
