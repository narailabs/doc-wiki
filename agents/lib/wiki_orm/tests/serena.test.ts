/**
 * Tests for serena.ts — the Serena MCP contract helpers for G7.
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildExtractionRequest,
  parseSerenaMatches,
  type SerenaMatch,
  type SerenaQueryPlan,
} from "../serena.js";
import { loadProfile } from "../profiles.js";
import { PROFILES_DIR } from "./fixtures.js";

function loadProfileByName(basename: string) {
  return loadProfile(path.join(PROFILES_DIR, basename));
}

describe("buildExtractionRequest", () => {
  it("emits entity_class, table_name, column, and relationship queries for JPA", () => {
    const profile = loadProfileByName("jpa.yaml");
    const plan: SerenaQueryPlan = buildExtractionRequest(profile);
    expect(plan.profile_name).toBe("jpa");
    const kinds = new Set(plan.patterns.map((p) => p.kind));
    expect(kinds.has("entity_class")).toBe(true);
    expect(kinds.has("table_name")).toBe(true);
    expect(kinds.has("column")).toBe(true);
    expect(kinds.has("relationship")).toBe(true);
  });

  it("applies the profile's class_pattern as the entity_class pattern", () => {
    const profile = loadProfileByName("jpa.yaml");
    const plan = buildExtractionRequest(profile);
    const entityQuery = plan.patterns.find((p) => p.kind === "entity_class");
    expect(entityQuery).toBeDefined();
    expect(entityQuery!.pattern).toBe(profile.class_pattern);
  });

  it("tags relationship queries with their type", () => {
    const profile = loadProfileByName("jpa.yaml");
    const plan = buildExtractionRequest(profile);
    const rels = plan.patterns.filter((p) => p.kind === "relationship");
    expect(rels.length).toBeGreaterThan(0);
    for (const r of rels) {
      expect(r.relationship_type).toBeDefined();
    }
  });

  it("pairs every pattern with a file_pattern from the profile", () => {
    const profile = loadProfileByName("sqlalchemy.yaml");
    const plan = buildExtractionRequest(profile);
    for (const p of plan.patterns) {
      expect(profile.file_patterns).toContain(p.file_pattern);
    }
  });
});

describe("parseSerenaMatches", () => {
  it("builds a minimal entity from entity_class, table_name, and column matches", () => {
    const profile = loadProfileByName("jpa.yaml");
    const matches: SerenaMatch[] = [
      { kind: "entity_class", file: "src/User.java", capture: "User" },
      {
        kind: "table_name",
        file: "src/User.java",
        capture: "users",
        enclosing_class: "User",
      },
      {
        kind: "column",
        file: "src/User.java",
        capture: "email",
        enclosing_class: "User",
      },
      {
        kind: "column",
        file: "src/User.java",
        capture: "id",
        enclosing_class: "User",
      },
    ];
    const entities = parseSerenaMatches(matches, profile);
    expect(entities.length).toBe(1);
    const u = entities[0]!;
    expect(u.class_name).toBe("User");
    expect(u.table_name).toBe("users");
    expect(u.columns.map((c) => c.name).sort()).toEqual(["email", "id"]);
  });

  it("dedupes repeated column matches", () => {
    const profile = loadProfileByName("jpa.yaml");
    const matches: SerenaMatch[] = [
      { kind: "entity_class", file: "src/U.java", capture: "U" },
      {
        kind: "column",
        file: "src/U.java",
        capture: "id",
        enclosing_class: "U",
      },
      {
        kind: "column",
        file: "src/U.java",
        capture: "id",
        enclosing_class: "U",
      },
    ];
    const entities = parseSerenaMatches(matches, profile);
    expect(entities[0]!.columns.length).toBe(1);
  });

  it("attaches relationships with their type", () => {
    const profile = loadProfileByName("jpa.yaml");
    const matches: SerenaMatch[] = [
      { kind: "entity_class", file: "src/U.java", capture: "User" },
      {
        kind: "relationship",
        file: "src/U.java",
        capture: "Order",
        relationship_type: "one_to_many",
        enclosing_class: "User",
      },
    ];
    const entities = parseSerenaMatches(matches, profile);
    expect(entities[0]!.relationships.length).toBe(1);
    expect(entities[0]!.relationships[0]!.type).toBe("one_to_many");
  });

  it("falls back to naming-convention table name when none matched", () => {
    const profile = loadProfileByName("jpa.yaml");
    const matches: SerenaMatch[] = [
      { kind: "entity_class", file: "src/U.java", capture: "User" },
    ];
    const entities = parseSerenaMatches(matches, profile);
    // jpa profile uses snake_case plural ("users")
    expect(entities[0]!.table_name.length).toBeGreaterThan(0);
  });

  it("ignores non-entity_class matches that lack enclosing_class", () => {
    const profile = loadProfileByName("jpa.yaml");
    const matches: SerenaMatch[] = [
      { kind: "entity_class", file: "src/U.java", capture: "User" },
      {
        kind: "column",
        file: "src/U.java",
        capture: "orphan_col",
        // no enclosing_class
      },
    ];
    const entities = parseSerenaMatches(matches, profile);
    expect(entities[0]!.columns).toEqual([]);
  });
});
