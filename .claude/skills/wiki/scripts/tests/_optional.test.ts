/**
 * Tests for _optional.ts — `importOptional` and `isBinaryOnPath`.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  importOptional,
  isBinaryOnPath,
  _resetBinaryProbeCache,
} from "../_optional.js";

describe("importOptional", () => {
  it("returns the module when it resolves", async () => {
    // `node:path` is always available.
    const mod = await importOptional<typeof import("node:path")>("node:path");
    expect(typeof mod.join).toBe("function");
  });

  it("throws a user-friendly error when the module is missing", async () => {
    await expect(
      importOptional("definitely-not-a-real-package-7c3e9a"),
    ).rejects.toThrow(/Missing optional dependency/);
  });

  it("names the install command in the error", async () => {
    try {
      await importOptional("bogus-pkg-no-such-thing");
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as Error).message).toContain("npm install bogus-pkg-no-such-thing");
    }
  });
});

describe("isBinaryOnPath", () => {
  beforeEach(() => {
    _resetBinaryProbeCache();
  });

  it("returns true for `node` (always present in CI)", () => {
    expect(isBinaryOnPath("node")).toBe(true);
  });

  it("returns false for a definitely-absent binary", () => {
    expect(isBinaryOnPath("definitely-not-a-real-cli-7c3e9a")).toBe(false);
  });

  it("caches results within a process", () => {
    // First call populates the cache.
    expect(isBinaryOnPath("node")).toBe(true);
    // Second call returns from cache — just confirming consistency.
    expect(isBinaryOnPath("node")).toBe(true);
  });
});
