/**
 * Tests for extractor.ts — ported 1:1 from `test_extractor.py`.
 *
 * Python pytest fixtures are rebuilt per-test via local helpers so each
 * `it()` is independent (pytest fixtures are per-test by default).
 */
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { extractEntities } from "../extractor.js";
import { loadProfile, type OrmProfile } from "../profiles.js";
import { PROFILES_DIR, readFixtureDir } from "./fixtures.js";

function loadShippedProfile(basename: string): OrmProfile {
  return loadProfile(path.join(PROFILES_DIR, basename));
}

// ======================================================================
// JPA
// ======================================================================

describe("TestExtractJPA", () => {
  const jpaProfile = () => loadShippedProfile("jpa.yaml");
  const jpaFiles = () => readFixtureDir("jpa", ".java");

  it("test_finds_entity_classes", () => {
    const entities = extractEntities(jpaFiles(), jpaProfile());
    const classNames = entities.map((e) => e.class_name);
    expect(classNames).toContain("User");
    expect(classNames).toContain("Order");
  });

  it("test_extracts_table_name", () => {
    const entities = extractEntities(jpaFiles(), jpaProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    expect(user!.table_name).toBe("users");
  });

  it("test_extracts_schema", () => {
    const entities = extractEntities(jpaFiles(), jpaProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    expect(user!.schema_name).toBe("public");
  });

  it("test_extracts_columns", () => {
    const entities = extractEntities(jpaFiles(), jpaProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    const colNames = user!.columns.map((c) => c.name);
    expect(colNames).toContain("username");
  });

  it("test_extracts_relationships", () => {
    const entities = extractEntities(jpaFiles(), jpaProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    const relTypes = user!.relationships.map((r) => r.type);
    const hasOneToMany = relTypes.includes("one_to_many");
    const hasManyToMany = relTypes.includes("many_to_many");
    expect(hasOneToMany || hasManyToMany).toBe(true);
  });
});

// ======================================================================
// SQLAlchemy
// ======================================================================

describe("TestExtractSQLAlchemy", () => {
  const saProfile = () => loadShippedProfile("sqlalchemy.yaml");
  const saFiles = () => readFixtureDir("sqlalchemy", ".py");

  it("test_finds_entity_classes", () => {
    const entities = extractEntities(saFiles(), saProfile());
    const classNames = entities.map((e) => e.class_name);
    expect(classNames).toContain("User");
  });

  it("test_extracts_table_name", () => {
    const entities = extractEntities(saFiles(), saProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    expect(user!.table_name).toBe("users");
  });
});

// ======================================================================
// Django
// ======================================================================

describe("TestExtractDjango", () => {
  const djangoProfile = () => loadShippedProfile("django.yaml");
  const djangoFiles = () => readFixtureDir("django", ".py");

  it("test_finds_entity_classes", () => {
    const entities = extractEntities(djangoFiles(), djangoProfile());
    const classNames = entities.map((e) => e.class_name);
    expect(classNames).toContain("User");
  });

  it("test_extracts_table_name", () => {
    const entities = extractEntities(djangoFiles(), djangoProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    expect(user!.table_name).toBe("users");
  });

  it("test_detects_relationships", () => {
    const entities = extractEntities(djangoFiles(), djangoProfile());
    const order = entities.find((e) => e.class_name === "Order");
    expect(order).toBeDefined();
    const relTypes = order!.relationships.map((r) => r.type);
    expect(relTypes).toContain("many_to_one");
  });
});

// ======================================================================
// TypeORM
// ======================================================================

describe("TestExtractTypeORM", () => {
  const typeormProfile = () => loadShippedProfile("typeorm.yaml");
  const typeormFiles = () => readFixtureDir("typeorm", ".ts");

  it("test_finds_entity_classes", () => {
    const entities = extractEntities(typeormFiles(), typeormProfile());
    const classNames = entities.map((e) => e.class_name);
    expect(classNames).toContain("User");
    expect(classNames).toContain("Order");
  });

  it("test_extracts_table_name", () => {
    const entities = extractEntities(typeormFiles(), typeormProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    expect(user!.table_name).toBe("users");
  });

  it("test_extracts_relationships", () => {
    const entities = extractEntities(typeormFiles(), typeormProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    const relTypes = user!.relationships.map((r) => r.type);
    expect(relTypes).toContain("one_to_many");
  });

  it("test_extracts_many_to_one", () => {
    const entities = extractEntities(typeormFiles(), typeormProfile());
    const order = entities.find((e) => e.class_name === "Order");
    expect(order).toBeDefined();
    const relTypes = order!.relationships.map((r) => r.type);
    expect(relTypes).toContain("many_to_one");
  });
});

// ======================================================================
// Entity Framework
// ======================================================================

describe("TestExtractEntityFramework", () => {
  const efProfile = () => loadShippedProfile("entity_framework.yaml");
  const efFiles = () => readFixtureDir("entity_framework", ".cs");

  it("test_finds_entity_classes", () => {
    const entities = extractEntities(efFiles(), efProfile());
    const classNames = entities.map((e) => e.class_name);
    expect(classNames).toContain("User");
  });

  it("test_extracts_table_name", () => {
    const entities = extractEntities(efFiles(), efProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    expect(user!.table_name).toBe("users");
  });

  it("test_extracts_columns", () => {
    const entities = extractEntities(efFiles(), efProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    const colNames = user!.columns.map((c) => c.name);
    expect(colNames).toContain("username");
  });

  it("test_extracts_relationships", () => {
    const entities = extractEntities(efFiles(), efProfile());
    const allRelTypes: string[] = [];
    for (const e of entities) {
      for (const r of e.relationships) allRelTypes.push(r.type);
    }
    const hasOneToOne = allRelTypes.includes("one_to_one");
    const hasManyToMany = allRelTypes.includes("many_to_many");
    expect(hasOneToOne || hasManyToMany).toBe(true);
  });
});

// ======================================================================
// ActiveRecord
// ======================================================================

describe("TestExtractActiveRecord", () => {
  const arProfile = () => loadShippedProfile("activerecord.yaml");
  const arFiles = () => readFixtureDir("activerecord", ".rb");

  it("test_finds_entity_classes", () => {
    const entities = extractEntities(arFiles(), arProfile());
    const classNames = entities.map((e) => e.class_name);
    expect(classNames).toContain("User");
    expect(classNames).toContain("Order");
  });

  it("test_infers_table_name", () => {
    const entities = extractEntities(arFiles(), arProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    expect(user!.table_name).toBe("users");
  });

  it("test_extracts_has_many", () => {
    const entities = extractEntities(arFiles(), arProfile());
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeDefined();
    const relTypes = user!.relationships.map((r) => r.type);
    expect(relTypes).toContain("one_to_many");
  });

  it("test_extracts_belongs_to", () => {
    const entities = extractEntities(arFiles(), arProfile());
    const order = entities.find((e) => e.class_name === "Order");
    expect(order).toBeDefined();
    const relTypes = order!.relationships.map((r) => r.type);
    expect(relTypes).toContain("many_to_one");
  });
});

// ======================================================================
// Non-ORM input
// ======================================================================

describe("TestExtractEmpty", () => {
  it("test_no_entities_from_non_orm_code", () => {
    const profile = loadShippedProfile("jpa.yaml");
    const files = { "readme.md": "# No ORM here" };
    const entities = extractEntities(files, profile);
    expect(entities).toEqual([]);
  });
});
