/**
 * Tests for environments.ts — ported 1:1 from `test_environments.py`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearEnvironments,
  getEnvironment,
  listEnvironments,
  registerEnvironment,
} from "../environments.js";

describe("wiki_db.environments", () => {
  // pytest: autouse=True _clean_registry
  beforeEach(() => {
    clearEnvironments();
  });
  afterEach(() => {
    clearEnvironments();
  });

  // ---------- 1. register_environment ----------
  it("test_register_environment", () => {
    registerEnvironment("dev", {
      host: "localhost",
      port: 5432,
      database: "wiki_dev",
    });
    const env = getEnvironment("dev");
    expect(env.host).toBe("localhost");
    expect(env.port).toBe(5432);
    expect(env.database).toBe("wiki_dev");
  });

  // ---------- 2. list_environments ----------
  it("test_list_environments", () => {
    registerEnvironment("dev", {
      host: "localhost",
      port: 5432,
      database: "wiki_dev",
    });
    registerEnvironment("staging", {
      host: "staging-db",
      port: 5432,
      database: "wiki_stg",
    });
    const names = [...listEnvironments()].sort();
    expect(names).toEqual(["dev", "staging"]);
  });

  // ---------- 3. get_environment ----------
  it("test_get_environment", () => {
    registerEnvironment("prod", {
      host: "prod-db",
      port: 5432,
      database: "wiki_prod",
    });
    const env = getEnvironment("prod");
    expect(env.host).toBe("prod-db");
    expect(env.database).toBe("wiki_prod");
  });

  // ---------- 4. get_missing_raises ----------
  it("test_get_missing_raises", () => {
    try {
      getEnvironment("nonexistent");
      throw new Error("expected KeyError");
    } catch (e) {
      expect((e as Error).name).toBe("KeyError");
    }
  });

  // ---------- 5. default_approval_mode ----------
  it("test_default_approval_mode", () => {
    registerEnvironment("dev", {
      host: "localhost",
      port: 5432,
      database: "wiki_dev",
    });
    const env = getEnvironment("dev");
    expect(env.approval_mode).toBe("auto");
  });

  // ---------- 6. register_with_all_modes ----------
  for (const mode of ["auto", "confirm-once", "confirm-each", "grant-required"]) {
    it(`test_register_with_all_modes[${mode}]`, () => {
      registerEnvironment("test", {
        host: "localhost",
        port: 5432,
        database: "db",
        approval_mode: mode,
      });
      const env = getEnvironment("test");
      expect(env.approval_mode).toBe(mode);
      clearEnvironments();
    });
  }

  // ---------- 7. invalid_mode_raises ----------
  it("test_invalid_mode_raises", () => {
    expect(() =>
      registerEnvironment("dev", {
        host: "localhost",
        port: 5432,
        database: "wiki_dev",
        approval_mode: "yolo",
      }),
    ).toThrow(/approval_mode/);
  });

  // ---------- 8. clear_environments ----------
  it("test_clear_environments", () => {
    registerEnvironment("dev", {
      host: "localhost",
      port: 5432,
      database: "wiki_dev",
    });
    expect(listEnvironments().length).toBe(1);
    clearEnvironments();
    expect(listEnvironments()).toEqual([]);
  });
});
