/**
 * Tests for extractor.ts — ported 1:1 from `test_extractor.py`.
 *
 * Python pytest fixtures are rebuilt per-test via local helpers so each
 * `it()` is independent (pytest fixtures are per-test by default).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  crossValidate,
  extractEntities,
  makeExtractedColumn,
  makeExtractedEntity,
  type ExtractedEntity,
} from "../extractor.js";
import { loadProfile, type OrmProfile } from "../profiles.js";
import { PROFILES_DIR, readFixtureDir } from "./fixtures.js";
import {
  clearEnvironments,
  registerEnvironment,
  SQLiteDriver,
} from "../../wiki_db/index.js";

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

// ======================================================================
// Cross-validation against live DB (G2)
// ======================================================================

function seedSqliteFile(dbPath: string, sql: string): void {
  // Use a fresh SQLiteDriver connection to set up the file-backed DB.
  const driver = new SQLiteDriver();
  const conn = driver.connect({ database: dbPath });
  conn.exec(sql);
  driver.close(conn);
}

describe("crossValidate (G2)", () => {
  let tmpDir: string;
  let dbPath: string;
  let envName: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crossvalidate-"));
    dbPath = path.join(tmpDir, "db.sqlite");
    envName = `orm-test-${Math.random().toString(36).slice(2, 8)}`;

    // Register a sqlite driver factory keyed by the env's `driver` field.
    // wiki_db already registers a default "sqlite" factory at import time;
    // we don't need to re-register here — just register the env itself.
    registerEnvironment(envName, {
      host: dbPath,
      port: 0,
      database: dbPath,
      driver: "sqlite",
    });
  });

  afterEach(() => {
    clearEnvironments();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("matches entities whose columns agree with the DB schema", async () => {
    seedSqliteFile(
      dbPath,
      `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
       CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER);`,
    );
    const entities: ExtractedEntity[] = [
      makeExtractedEntity({
        class_name: "User",
        table_name: "users",
        columns: [
          makeExtractedColumn({ name: "id" }),
          makeExtractedColumn({ name: "email" }),
        ],
      }),
      makeExtractedEntity({
        class_name: "Order",
        table_name: "orders",
        columns: [
          makeExtractedColumn({ name: "id" }),
          makeExtractedColumn({ name: "user_id" }),
        ],
      }),
    ];
    const report = await crossValidate(entities, envName);
    expect(report.error).toBeUndefined();
    expect(report.matched.map((m) => m.entity).sort()).toEqual(
      ["Order", "User"],
    );
    expect(report.unmapped_tables).toEqual([]);
    expect(report.orphan_entities).toEqual([]);
    expect(report.column_mismatches).toEqual([]);
  });

  it("flags columns missing in the DB", async () => {
    seedSqliteFile(
      dbPath,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)",
    );
    const entities: ExtractedEntity[] = [
      makeExtractedEntity({
        class_name: "User",
        table_name: "users",
        columns: [
          makeExtractedColumn({ name: "id" }),
          makeExtractedColumn({ name: "email" }),
          makeExtractedColumn({ name: "phantom_field" }),
        ],
      }),
    ];
    const report = await crossValidate(entities, envName);
    const mismatch = report.column_mismatches.find(
      (m) => m.entity_field === "phantom_field",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.reason).toBe("missing_in_db");
  });

  it("flags columns missing in code", async () => {
    seedSqliteFile(
      dbPath,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, extra_col TEXT)",
    );
    const entities: ExtractedEntity[] = [
      makeExtractedEntity({
        class_name: "User",
        table_name: "users",
        columns: [
          makeExtractedColumn({ name: "id" }),
          makeExtractedColumn({ name: "email" }),
        ],
      }),
    ];
    const report = await crossValidate(entities, envName);
    const mismatch = report.column_mismatches.find(
      (m) => m.entity_field === "extra_col",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.reason).toBe("missing_in_code");
  });

  it("lists unmapped DB tables and orphan entities", async () => {
    seedSqliteFile(
      dbPath,
      `CREATE TABLE users (id INTEGER PRIMARY KEY);
       CREATE TABLE audit_log (id INTEGER PRIMARY KEY, message TEXT);`,
    );
    const entities: ExtractedEntity[] = [
      makeExtractedEntity({
        class_name: "User",
        table_name: "users",
        columns: [makeExtractedColumn({ name: "id" })],
      }),
      makeExtractedEntity({
        class_name: "GhostEntity",
        table_name: "nonexistent_table",
        columns: [],
      }),
    ];
    const report = await crossValidate(entities, envName);
    expect(report.unmapped_tables).toEqual(["audit_log"]);
    expect(report.orphan_entities).toEqual(["GhostEntity"]);
  });

  it("never throws on a bad env — surfaces error in report", async () => {
    const entities: ExtractedEntity[] = [
      makeExtractedEntity({ class_name: "X", table_name: "x" }),
    ];
    const report = await crossValidate(entities, "nonexistent-env");
    expect(report.error).toBeDefined();
    expect(report.orphan_entities).toEqual(["X"]);
    expect(report.matched).toEqual([]);
  });
});
