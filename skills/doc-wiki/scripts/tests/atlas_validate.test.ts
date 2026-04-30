/**
 * Tests for atlas_validate.ts — the (page-hash, source-hash) cache backing
 * `/doc-wiki:atlas` Phase 5's semantic validation. Structural-check
 * invocation of `lint_checks.js` is exercised end-to-end when the
 * orchestrator runs; here we focus on the deterministic cache layer.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  computeValidationKey,
  checkValidationCache,
  storeValidationCache,
  clearValidationCache,
  VALIDATE_CACHE_SUBDIR,
  VALIDATE_CACHE_VERSION,
} from "../atlas_validate.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

describe("computeValidationKey", () => {
  it("is deterministic for identical inputs", () => {
    const a = computeValidationKey("p1", "s1");
    const b = computeValidationKey("p1", "s1");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("changes when either half changes", () => {
    const base = computeValidationKey("p1", "s1");
    expect(computeValidationKey("p2", "s1")).not.toBe(base);
    expect(computeValidationKey("p1", "s2")).not.toBe(base);
  });

  it("does not collide on key reordering (uses delimiter)", () => {
    // Without a delimiter, ("ab","cd") and ("a","bcd") would both hash "abcd".
    const a = computeValidationKey("ab", "cd");
    const b = computeValidationKey("a", "bcd");
    expect(a).not.toBe(b);
  });
});

describe("validation cache CRUD", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-validate-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null on miss", () => {
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("round-trips a structured result", () => {
    const result = { ok: true, divergences: ["foo", "bar"] };
    storeValidationCache(tmpPath, "p1", "s1", result);
    const got = checkValidationCache(tmpPath, "p1", "s1");
    expect(got).not.toBeNull();
    expect(got?.result).toEqual(result);
    expect(got?.pageHash).toBe("p1");
    expect(got?.sourceHash).toBe("s1");
    expect(got?.cache_version).toBe(VALIDATE_CACHE_VERSION);
    expect(got?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns null on cache_version mismatch", () => {
    storeValidationCache(tmpPath, "p1", "s1", "ok");
    const key = computeValidationKey("p1", "s1");
    const file = path.join(tmpPath, VALIDATE_CACHE_SUBDIR, `${key}.json`);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    raw["cache_version"] = "0";
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("returns null on hash-half mismatch in the on-disk record", () => {
    storeValidationCache(tmpPath, "p1", "s1", "ok");
    const key = computeValidationKey("p1", "s1");
    const file = path.join(tmpPath, VALIDATE_CACHE_SUBDIR, `${key}.json`);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    raw["pageHash"] = "evil";
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("clearValidationCache removes every .json entry and counts them", () => {
    storeValidationCache(tmpPath, "p1", "s1", "a");
    storeValidationCache(tmpPath, "p2", "s2", "b");
    storeValidationCache(tmpPath, "p3", "s3", "c");
    expect(clearValidationCache(tmpPath)).toBe(3);
    expect(checkValidationCache(tmpPath, "p1", "s1")).toBeNull();
  });

  it("clearValidationCache returns 0 when the cache dir does not exist", () => {
    expect(clearValidationCache(tmpPath)).toBe(0);
  });

  it("cache writes go to the dedicated subdir, not the parent .wiki-cache", () => {
    storeValidationCache(tmpPath, "p1", "s1", "ok");
    const dir = path.join(tmpPath, VALIDATE_CACHE_SUBDIR);
    expect(fs.existsSync(dir)).toBe(true);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
  });

  it("overwrites an existing entry on re-store", () => {
    storeValidationCache(tmpPath, "p1", "s1", "first");
    storeValidationCache(tmpPath, "p1", "s1", "second");
    expect(checkValidationCache(tmpPath, "p1", "s1")?.result).toBe("second");
  });
});
