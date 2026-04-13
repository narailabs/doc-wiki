/**
 * Shared fixtures for wiki_db tests — the TypeScript port of `conftest.py`.
 *
 * Fixtures are exposed as plain helper functions (not pytest magic).
 * Tests invoke them inside beforeEach / beforeAll.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Create a fresh temp directory for a single test and return its path.
 * Analogous to pytest's built-in `tmp_path` fixture.
 */
export function makeTmpPath(prefix: string = "wiki-db-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Remove a temp directory (best-effort). Safe to call on nonexistent paths. */
export function cleanupTmpPath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Write a JSON credentials file at `p` with shape {db-<env>: {...}}. */
export function writeCredsFile(p: string, data: unknown): void {
  fs.writeFileSync(p, JSON.stringify(data));
}

/**
 * Transient process.env mutator — sets variables and returns a restore fn.
 * Mirrors pytest's `monkeypatch.setenv` + auto-cleanup on teardown.
 */
export function patchEnv(
  vars: Record<string, string | undefined>,
): () => void {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prior[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  return () => {
    for (const k of Object.keys(vars)) {
      if (prior[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = prior[k];
      }
    }
  };
}
