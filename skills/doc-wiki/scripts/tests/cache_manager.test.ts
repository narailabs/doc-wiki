/**
 * Tests for cache_manager.ts — originally ported from test_cache_manager.py.
 * After the Python removal, the Python parity assertions are gone; the
 * TypeScript-only CLI exercises remain.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  computeHash,
  checkCache,
  storeCache,
  clearCache,
  getCacheVersion,
  setCacheVersion,
} from "../cache_manager.js";
import {
  SCRIPTS_DIR,
  makeTmpPath,
  cleanupTmpPath,
  makeInitializedWiki,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "cache_manager.js");

function runCli(
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      stdout:
        typeof err.stdout === "string"
          ? err.stdout
          : (err.stdout?.toString("utf-8") ?? ""),
      stderr:
        typeof err.stderr === "string"
          ? err.stderr
          : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

/** Mirrors the original `cache_wiki` fixture — initialized wiki with cache
 *  version pre-set to "1". */
function makeCacheWiki(tmpPath: string): string {
  const wikiRoot = makeInitializedWiki(tmpPath);
  setCacheVersion(wikiRoot, "1");
  return wikiRoot;
}

// ── computeHash tests ───────────────────────────────────────────────

describe("TestComputeHash", () => {
  it("test_deterministic", () => {
    const h1 = computeHash("hello world");
    const h2 = computeHash("hello world");
    expect(h1).toBe(h2);
    // Must match Python's hashlib.sha256 hex digest for the same UTF-8 bytes.
    const expected = crypto
      .createHash("sha256")
      .update(Buffer.from("hello world", "utf-8"))
      .digest("hex");
    expect(h1).toBe(expected);
  });

  it("test_different_inputs", () => {
    expect(computeHash("alpha")).not.toBe(computeHash("beta"));
  });

  it("test_body_only_strips_frontmatter", () => {
    const content = "---\ntitle: Test\ntype: concept\n---\nBody text here";
    const bodyHash = computeHash(content, true);
    const plainHash = computeHash("Body text here");
    expect(bodyHash).toBe(plainHash);
  });

  it("test_body_only_no_frontmatter", () => {
    const content = "Just plain text, no frontmatter";
    expect(computeHash(content, true)).toBe(computeHash(content));
  });

  it("test_empty_string", () => {
    const h = computeHash("");
    expect(h.length).toBe(64);
    // All lowercase hex digits
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });
});

// ── checkCache tests ────────────────────────────────────────────────

describe("TestCheckCache", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("cache-check-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_miss", () => {
    const wiki = makeCacheWiki(tmpPath);
    const result = checkCache(wiki, "nonexistenthash");
    expect(result).toBeNull();
  });

  it("test_hit_after_store", () => {
    const wiki = makeCacheWiki(tmpPath);
    const meta = { source: "test.md", pages_created: 2 };
    const h = computeHash("some content");
    storeCache(wiki, h, meta);
    const result = checkCache(wiki, h);
    expect(result).not.toBeNull();
    expect(result?.["source"]).toBe("test.md");
    expect(result?.["pages_created"]).toBe(2);
  });

  it("test_no_cache_dir", () => {
    // No cache dir at all — just an empty tmp path.
    const result = checkCache(tmpPath, "anyhash");
    expect(result).toBeNull();
  });

  it("test_corrupted_file", () => {
    const wiki = makeCacheWiki(tmpPath);
    const h = "abc123";
    const cacheFile = path.join(wiki, ".wiki-cache", `${h}.json`);
    fs.writeFileSync(cacheFile, "not valid json{{{");
    const result = checkCache(wiki, h);
    expect(result).toBeNull();
  });
});

// ── storeCache tests ────────────────────────────────────────────────

describe("TestStoreCache", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("cache-store-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_creates_file", () => {
    const wiki = makeCacheWiki(tmpPath);
    const h = computeHash("test content");
    storeCache(wiki, h, { source: "file.md" });
    const cacheFile = path.join(wiki, ".wiki-cache", `${h}.json`);
    expect(fs.existsSync(cacheFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(cacheFile, { encoding: "utf-8" }));
    expect(data.source).toBe("file.md");
  });

  it("test_overwrites_existing", () => {
    const wiki = makeCacheWiki(tmpPath);
    const h = computeHash("test");
    storeCache(wiki, h, { version: 1 });
    storeCache(wiki, h, { version: 2 });
    const result = checkCache(wiki, h);
    expect(result?.["version"]).toBe(2);
  });

  it("test_creates_cache_dir", () => {
    const wiki = path.join(tmpPath, "new-wiki");
    fs.mkdirSync(wiki, { recursive: true });
    const h = computeHash("data");
    setCacheVersion(wiki, "1");
    storeCache(wiki, h, { key: "val" });
    expect(
      fs.existsSync(path.join(wiki, ".wiki-cache", `${h}.json`)),
    ).toBe(true);
  });
});

// ── clearCache tests ────────────────────────────────────────────────

describe("TestClearCache", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("cache-clear-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_removes_entries", () => {
    const wiki = makeCacheWiki(tmpPath);
    for (let i = 0; i < 3; i++) {
      storeCache(wiki, computeHash(`content${i}`), { i });
    }
    const count = clearCache(wiki);
    expect(count).toBe(3);
  });

  it("test_empty", () => {
    const wiki = makeCacheWiki(tmpPath);
    const count = clearCache(wiki);
    expect(count).toBe(0);
  });

  it("test_preserves_version_file", () => {
    const wiki = makeCacheWiki(tmpPath);
    storeCache(wiki, computeHash("x"), { x: 1 });
    clearCache(wiki);
    expect(fs.existsSync(path.join(wiki, ".wiki-cache", "VERSION"))).toBe(true);
  });
});

// ── Cache version tests ────────────────────────────────────────────

describe("TestCacheVersion", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("cache-ver-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_set_and_get", () => {
    const wiki = makeInitializedWiki(tmpPath);
    setCacheVersion(wiki, "42");
    expect(getCacheVersion(wiki)).toBe("42");
  });

  it("test_get_version_missing", () => {
    // Bare tmp_path with no cache dir at all.
    expect(getCacheVersion(tmpPath)).toBe("0");
  });

  it("test_version_mismatch_invalidates", () => {
    const wiki = makeCacheWiki(tmpPath);
    const h = computeHash("content");
    storeCache(wiki, h, { data: "old" });
    // Change the version; the entry's embedded cache_version no longer matches.
    setCacheVersion(wiki, "99");
    expect(checkCache(wiki, h)).toBeNull();
  });
});

// ── CLI tests ──────────────────────────────────────────────────────

describe("TestCacheManagerCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("cache-cli-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_check_miss", () => {
    const wiki = makeCacheWiki(tmpPath);
    const r = runCli(["check", "--wiki-root", wiki, "--content", "unknown"]);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.hit).toBe(false);
  });

  it("test_cli_store_and_check", () => {
    const wiki = makeCacheWiki(tmpPath);
    runCli([
      "store",
      "--wiki-root",
      wiki,
      "--content",
      "hello",
      "--metadata",
      '{"source": "test.md"}',
    ]);
    const r = runCli(["check", "--wiki-root", wiki, "--content", "hello"]);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.hit).toBe(true);
  });

  it("test_cli_clear", () => {
    const wiki = makeCacheWiki(tmpPath);
    storeCache(wiki, computeHash("a"), { a: 1 });
    storeCache(wiki, computeHash("b"), { b: 2 });
    const r = runCli(["clear", "--wiki-root", wiki]);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.removed).toBe(2);
  });
});

// ── CLI smoke tests (TS-only) ───────────────────────────────────────
//
// These exercise the compiled cache_manager.js end-to-end and assert
// stdout shape (JSON, hit/miss flags). Originally a parity comparison
// against python3 cache_manager.py — the Python half was retired with
// the Phase 9 cleanup, so we now just confirm the TS CLI behaves.

describe("CacheManagerCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("cache-cli-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("cli_check_miss_returns_hit_false", () => {
    const wiki = makeCacheWiki(tmpPath);
    const js = runCli([
      "check",
      "--wiki-root",
      wiki,
      "--content",
      "hello world",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(data.hit).toBe(false);
  });

  it("cli_store_then_check_returns_hit_true", () => {
    const wiki = makeCacheWiki(tmpPath);
    runCli([
      "store",
      "--wiki-root",
      wiki,
      "--content",
      "hello world",
      "--metadata",
      '{"k":"v"}',
    ]);
    const js = runCli([
      "check",
      "--wiki-root",
      wiki,
      "--content",
      "hello world",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(data.hit).toBe(true);
    // `store` attaches the current cache_version alongside caller metadata.
    expect(data.metadata.k).toBe("v");
    expect(data.metadata.cache_version).toBe("1");
  });

  it("cli_version_reports_set_value", () => {
    const wiki = makeCacheWiki(tmpPath);
    const js = runCli(["version", "--wiki-root", wiki]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(data.version).toBe("1");
  });

  it("cli_body_only_strips_frontmatter", () => {
    const wiki = makeCacheWiki(tmpPath);
    const content = "---\ntitle: x\n---\nbody only";
    const js = runCli([
      "check",
      "--wiki-root",
      wiki,
      "--content",
      content,
      "--body-only",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(data.hit).toBe(false);
    // Hash should be of "body only" (frontmatter stripped). Confirm by
    // comparing with the same digest computed via the public helper.
    const expected = computeHash("body only");
    expect(data.hash).toBe(expected);
  });
});
