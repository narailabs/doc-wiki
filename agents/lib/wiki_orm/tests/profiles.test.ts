/**
 * Tests for profiles.ts — ported 1:1 from `test_profiles.py`.
 *
 * Class-based pytest structure → `describe` blocks; each `def test_*` maps
 * to a Vitest `it()`. Fixtures (`PROFILES_DIR`, `FIXTURES_DIR`) come from
 * `fixtures.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectOrm, loadAllProfiles, loadProfile } from "../profiles.js";
import {
  FIXTURES_DIR,
  PROFILES_DIR,
  cleanupTmpPath,
  makeTmpPath,
  readFixtureDir,
} from "./fixtures.js";

describe("TestLoadProfile", () => {
  it("test_load_jpa_profile", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "jpa.yaml"));
    expect(p.name).toBe("jpa");
    expect(p.language).toBe("java");
    expect(p.markers.length).toBeGreaterThanOrEqual(2);
  });

  it("test_load_sqlalchemy_profile", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "sqlalchemy.yaml"));
    expect(p.name).toBe("sqlalchemy");
    expect(p.language).toBe("python");
  });

  it("test_load_django_profile", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "django.yaml"));
    expect(p.name).toBe("django");
    expect(p.language).toBe("python");
  });

  it("test_load_prisma_profile", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "prisma.yaml"));
    expect(p.name).toBe("prisma");
    expect(p.language).toBe("typescript");
  });

  it("test_load_typeorm_profile", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "typeorm.yaml"));
    expect(p.name).toBe("typeorm");
    expect(p.language).toBe("typescript");
    expect(p.markers.length).toBeGreaterThanOrEqual(2);
  });

  it("test_load_entity_framework_profile", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "entity_framework.yaml"));
    expect(p.name).toBe("entity_framework");
    expect(p.language).toBe("csharp");
    expect(p.markers.length).toBeGreaterThanOrEqual(2);
  });

  it("test_load_activerecord_profile", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "activerecord.yaml"));
    expect(p.name).toBe("activerecord");
    expect(p.language).toBe("ruby");
    expect(p.markers.length).toBeGreaterThanOrEqual(2);
  });

  it("test_missing_file_raises", () => {
    expect(() => loadProfile("/nonexistent/profile.yaml")).toThrow(
      /Profile not found/,
    );
  });

  it("test_missing_required_fields", () => {
    const tmp = makeTmpPath();
    try {
      const bad = path.join(tmp, "bad.yaml");
      fs.writeFileSync(bad, "name: test\nlanguage: python\n");
      expect(() => loadProfile(bad)).toThrow(/missing required fields/);
    } finally {
      cleanupTmpPath(tmp);
    }
  });

  // G-ORM-PROFILE-VALIDATE: invalid regex in any pattern field used to
  // be silently swallowed by extractor.ts. Load-time validation makes
  // the error visible to the profile author.
  it("test_invalid_regex_in_class_pattern_raises", () => {
    const tmp = makeTmpPath();
    try {
      const bad = path.join(tmp, "bad.yaml");
      fs.writeFileSync(
        bad,
        [
          "name: badregex",
          "language: python",
          "detection:",
          "  markers: []",
          "entity_extraction:",
          "  class_pattern: '[unclosed'",
          "",
        ].join("\n"),
      );
      expect(() => loadProfile(bad)).toThrow(/invalid regex in class_pattern/);
      expect(() => loadProfile(bad)).toThrow(/badregex|bad\.yaml/);
    } finally {
      cleanupTmpPath(tmp);
    }
  });

  it("test_invalid_regex_in_relationship_pattern_raises", () => {
    const tmp = makeTmpPath();
    try {
      const bad = path.join(tmp, "bad.yaml");
      fs.writeFileSync(
        bad,
        [
          "name: badrel",
          "language: python",
          "detection:",
          "  markers: []",
          "entity_extraction:",
          "  class_pattern: '^class'",
          "relationship_detection:",
          "  patterns:",
          "    - pattern: '(unclosed'",
          "      type: one_to_many",
          "",
        ].join("\n"),
      );
      expect(() => loadProfile(bad)).toThrow(
        /invalid regex in relationship_patterns\[0\]/,
      );
    } finally {
      cleanupTmpPath(tmp);
    }
  });

  it("test_profile_has_markers", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "jpa.yaml"));
    const markerTypes = p.markers.map((m) => m.type);
    expect(markerTypes).toContain("entity_class");
  });

  it("test_profile_has_relationship_patterns", () => {
    const p = loadProfile(path.join(PROFILES_DIR, "jpa.yaml"));
    expect(p.relationship_patterns.length).toBeGreaterThanOrEqual(1);
  });
});

describe("TestLoadAllProfiles", () => {
  it("test_loads_shipped_profiles", () => {
    const profiles = loadAllProfiles(PROFILES_DIR);
    const names = profiles.map((p) => p.name);
    for (const n of [
      "jpa",
      "sqlalchemy",
      "django",
      "prisma",
      "typeorm",
      "entity_framework",
      "activerecord",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("test_empty_dir_returns_empty", () => {
    const tmp = makeTmpPath();
    try {
      const profiles = loadAllProfiles(tmp);
      expect(profiles).toEqual([]);
    } finally {
      cleanupTmpPath(tmp);
    }
  });
});

describe("TestDetectOrm", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("test_detect_jpa", () => {
    const contents = readFixtureDir("jpa", ".java");
    expect(Object.keys(contents).length).toBeGreaterThan(0);
    const profiles = loadAllProfiles(PROFILES_DIR);
    const matches = detectOrm(contents, profiles);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]?.name).toBe("jpa");
  });

  it("test_detect_sqlalchemy", () => {
    const contents = readFixtureDir("sqlalchemy", ".py");
    const profiles = loadAllProfiles(PROFILES_DIR);
    const matches = detectOrm(contents, profiles);
    const names = matches.map((m) => m.name);
    expect(names).toContain("sqlalchemy");
  });

  it("test_detect_django", () => {
    const contents = readFixtureDir("django", ".py");
    const profiles = loadAllProfiles(PROFILES_DIR);
    const matches = detectOrm(contents, profiles);
    const names = matches.map((m) => m.name);
    expect(names).toContain("django");
  });

  it("test_detect_typeorm", () => {
    const contents = readFixtureDir("typeorm", ".ts");
    const profiles = loadAllProfiles(PROFILES_DIR);
    const matches = detectOrm(contents, profiles);
    const names = matches.map((m) => m.name);
    expect(names).toContain("typeorm");
  });

  it("test_detect_entity_framework", () => {
    const contents = readFixtureDir("entity_framework", ".cs");
    const profiles = loadAllProfiles(PROFILES_DIR);
    const matches = detectOrm(contents, profiles);
    const names = matches.map((m) => m.name);
    expect(names).toContain("entity_framework");
  });

  it("test_detect_activerecord", () => {
    const contents = readFixtureDir("activerecord", ".rb");
    const profiles = loadAllProfiles(PROFILES_DIR);
    const matches = detectOrm(contents, profiles);
    const names = matches.map((m) => m.name);
    expect(names).toContain("activerecord");
  });

  it("test_no_match_returns_empty", () => {
    const contents = { "readme.md": "# Just a readme\nNo ORM here." };
    const profiles = loadAllProfiles(PROFILES_DIR);
    const matches = detectOrm(contents, profiles);
    expect(matches).toEqual([]);
  });

  it("FIXTURES_DIR_exists", () => {
    // Sanity: every Python test references FIXTURES_DIR; if it's missing
    // the detection tests silently become no-ops. Assert explicitly.
    expect(fs.existsSync(FIXTURES_DIR)).toBe(true);
  });
});
