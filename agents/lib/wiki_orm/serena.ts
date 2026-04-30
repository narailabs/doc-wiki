/**
 * serena.ts — Contract helpers for the Serena MCP code-navigation path.
 *
 * Per v2 design §5 ("Integration with Serena"): the ORM mapper's canonical
 * code navigation mechanism is the Serena MCP server — specifically
 * `search_for_pattern`, `find_symbol`, and `find_referencing_symbols`.
 * The regex extractor stays as an offline fallback. This module does NOT
 * call Serena itself: Serena lives in Claude Code's tool environment, not
 * in Node. Instead, this module exposes a shape contract so the
 * orchestrator prompt can dispatch the right MCP queries and fold the
 * responses back into our existing `ExtractedEntity` type.
 *
 * Workflow (inside the orchestrator):
 *   1. Load ORM profile.
 *   2. Call `buildExtractionRequest(profile)` → `SerenaQueryPlan`.
 *   3. Dispatch each `patterns[]` entry via `mcp__plugin_serena_serena__search_for_pattern`.
 *   4. Collect responses into `SerenaMatch[]`.
 *   5. Call `parseSerenaMatches(matches, profile)` → `ExtractedEntity[]`.
 *   6. Feed those entities into the usual pipeline (crossValidate + output).
 *
 * Regex fallback stays valid for offline / CI environments without Serena.
 */
import type { OrmProfile } from "./profiles.js";
import {
  makeExtractedColumn,
  makeExtractedEntity,
  makeExtractedRelationship,
  type ExtractedColumn,
  type ExtractedEntity,
  type ExtractedRelationship,
} from "./extractor.js";

/**
 * One search query for the Serena MCP. `kind` tells the orchestrator
 * which Serena primitive to invoke.
 */
export interface SerenaPatternQuery {
  kind: "entity_class" | "table_name" | "column" | "relationship";
  /** Regex the orchestrator should pass to `search_for_pattern`. */
  pattern: string;
  /** Glob restricting which files to search. */
  file_pattern: string;
  /** Optional relationship type, set when kind === "relationship". */
  relationship_type?: string;
}

/**
 * Complete query plan derived from an ORM profile. The orchestrator runs
 * every entry in `patterns[]` through Serena and aggregates the results.
 */
export interface SerenaQueryPlan {
  profile_name: string;
  language: string;
  file_patterns: readonly string[];
  patterns: SerenaPatternQuery[];
}

/**
 * One match returned by Serena's `search_for_pattern`. The Serena MCP
 * response shape is richer than this; `parseSerenaMatches` only needs
 * the minimum we can reconstruct an entity from.
 */
export interface SerenaMatch {
  /** Which `SerenaPatternQuery.kind` produced this match. */
  kind: "entity_class" | "table_name" | "column" | "relationship";
  /** File path the match came from (Serena returns absolute paths). */
  file: string;
  /** First capture group from the pattern. For entity_class: class name;
   *  for table_name: the explicit table name; for column: column name. */
  capture: string;
  /** Schema capture (only populated when the pattern has >=2 groups, e.g.
   *  JPA's `@Table(name="x", schema="s")`). */
  schema_capture?: string;
  /** Relationship type, populated when `kind === "relationship"`. */
  relationship_type?: string;
  /** Entity class this match belongs to. The orchestrator establishes
   *  this by locating the nearest-enclosing `entity_class` match from
   *  Serena's symbol context; callers who can't provide it should leave
   *  undefined and `parseSerenaMatches` will skip the match. */
  enclosing_class?: string;
}

/**
 * Build the Serena query plan for a given ORM profile. Patterns here
 * mirror the ones the regex extractor uses — we don't invent new
 * patterns, we just hand them to Serena instead of running them locally.
 */
export function buildExtractionRequest(profile: OrmProfile): SerenaQueryPlan {
  const patterns: SerenaPatternQuery[] = [];

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
export function parseSerenaMatches(
  matches: readonly SerenaMatch[],
  profile: OrmProfile,
): ExtractedEntity[] {
  const byClass = new Map<string, ExtractedEntity>();
  const classFiles = new Map<string, string>();

  // First pass: establish entities from `entity_class` matches.
  for (const m of matches) {
    if (m.kind === "entity_class") {
      if (!byClass.has(m.capture)) {
        byClass.set(
          m.capture,
          makeExtractedEntity({
            class_name: m.capture,
            source_file: m.file,
          }),
        );
        classFiles.set(m.capture, m.file);
      }
    }
  }

  // Second pass: attach table names, columns, relationships.
  for (const m of matches) {
    if (m.kind === "entity_class") continue;
    const className = m.enclosing_class;
    if (className === undefined) continue;
    const entity = byClass.get(className);
    if (entity === undefined) continue;

    if (m.kind === "table_name") {
      entity.table_name = m.capture;
      if (m.schema_capture) entity.schema_name = m.schema_capture;
    } else if (m.kind === "column") {
      const col: ExtractedColumn = makeExtractedColumn({
        name: m.capture,
        source_field: m.capture,
      });
      // Dedupe — Serena may return the same column match multiple times
      // if `search_for_pattern` overlaps.
      if (!entity.columns.some((c) => c.name === col.name)) {
        entity.columns.push(col);
      }
    } else if (m.kind === "relationship") {
      const rel: ExtractedRelationship = makeExtractedRelationship({
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

function classNameToTable(className: string, profile: OrmProfile): string {
  const convention =
    profile.naming_conventions["table_from_class"] ?? "snake_case";
  if (convention === "lower_case") return className.toLowerCase();
  if (convention === "snake_case") return toSnakeCase(className);
  if (convention === "snake_case_plural") return toSnakeCase(className) + "s";
  return className.toLowerCase();
}

function toSnakeCase(name: string): string {
  return name.replace(/(?<=[a-z0-9])([A-Z])/g, "_$1").toLowerCase();
}
