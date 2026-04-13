/**
 * Tests for output.ts — ported 1:1 from `test_output.py`.
 *
 * `sample_entities` in Python is a per-test pytest fixture; here it is a
 * helper function invoked inside each `it()`.
 */
import { describe, expect, it } from "vitest";

import {
  makeExtractedColumn,
  makeExtractedEntity,
  makeExtractedRelationship,
  type ExtractedEntity,
} from "../extractor.js";
import { generateMappingMarkdown } from "../output.js";

function sampleEntities(): ExtractedEntity[] {
  return [
    makeExtractedEntity({
      class_name: "User",
      table_name: "users",
      schema_name: "public",
      columns: [
        makeExtractedColumn({ name: "id" }),
        makeExtractedColumn({ name: "username" }),
        makeExtractedColumn({ name: "email" }),
      ],
      relationships: [
        makeExtractedRelationship({ type: "one_to_many" }),
        makeExtractedRelationship({ type: "many_to_many" }),
      ],
      source_file: "src/model/User.java",
    }),
    makeExtractedEntity({
      class_name: "Order",
      table_name: "orders",
      columns: [
        makeExtractedColumn({ name: "id" }),
        makeExtractedColumn({ name: "total_amount" }),
      ],
      relationships: [makeExtractedRelationship({ type: "many_to_one" })],
      source_file: "src/model/Order.java",
    }),
  ];
}

describe("TestGenerateMarkdown", () => {
  it("test_has_frontmatter", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    expect(md.startsWith("---")).toBe(true);
    expect(md).toContain("title: Database Mapping");
    expect(md).toContain("type: entity");
    expect(md).toContain("orm_profile: jpa");
  });

  it("test_has_entity_table_mapping", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    expect(md).toContain("## Entity-Table Mapping");
    expect(md).toContain("| User |");
    expect(md).toContain("| Order |");
  });

  it("test_schema_table_format", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    expect(md).toContain("public.users");
  });

  it("test_has_mermaid_er_diagram", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    expect(md).toContain("```mermaid");
    expect(md).toContain("erDiagram");
  });

  it("test_mermaid_includes_tables", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    // Matches Python's `assert "users {" in md or "users" in md`.
    const ok = md.includes("users {") || md.includes("users");
    expect(ok).toBe(true);
  });

  it("test_unmapped_tables_section", () => {
    const md = generateMappingMarkdown(
      sampleEntities(),
      "TestProject",
      "jpa",
      ["audit_log", "migrations"],
    );
    expect(md).toContain("## Unmapped Tables");
    expect(md).toContain("`audit_log`");
    expect(md).toContain("`migrations`");
  });

  it("test_dual_access_section", () => {
    const md = generateMappingMarkdown(
      sampleEntities(),
      "TestProject",
      "jpa",
      undefined,
      ["users"],
    );
    expect(md).toContain("## Dual-Access Tables");
    expect(md).toContain("`users`");
  });

  it("test_no_unmapped_section_when_empty", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    expect(md).not.toContain("## Unmapped Tables");
  });

  it("test_empty_entities_no_crash", () => {
    const md = generateMappingMarkdown([], "TestProject", "jpa");
    expect(md).toContain("## Entity-Table Mapping");
    // No diagram for empty entities.
    expect(md).not.toContain("erDiagram");
  });

  it("test_column_count_in_table", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    // User has 3 columns — Python test accepts `| 3 |` OR just `3`.
    const ok = md.includes("| 3 |") || md.includes("3");
    expect(ok).toBe(true);
  });

  it("test_tags_include_orm_profile", () => {
    const md = generateMappingMarkdown(sampleEntities(), "TestProject", "jpa");
    expect(md).toContain("jpa");
    expect(md).toContain("database");
  });
});
