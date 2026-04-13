/**
 * Shared fixture helpers for wiki_orm tests — TypeScript port of
 * `conftest.py` and the per-class pytest fixtures.
 *
 * Fixtures are plain helper functions (not pytest magic). Tests invoke
 * them inside `beforeAll` / inline helper calls. The fixture source files
 * themselves (`fixtures/<profile>/…`) live under `tests/fixtures/` and are
 * NOT modified by the port — they are input data for the extractor.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the `profiles/` directory (shipped YAML files). */
export const PROFILES_DIR = path.resolve(__dirname, "..", "profiles");

/** Absolute path to the `tests/fixtures/` directory. */
export const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

/**
 * Read every file in a fixture subdir (e.g. `jpa`) whose name matches
 * `ext` (e.g. `.java`) and return a `{ absPath: content }` map — the
 * exact shape the Python tests build with `{str(f): f.read_text() for f
 * in fixtures.glob("*.java")}`.
 */
export function readFixtureDir(
  subdir: string,
  ext: string,
): Record<string, string> {
  const dir = path.join(FIXTURES_DIR, subdir);
  if (!fs.existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith(ext)) continue;
    const full = path.join(dir, entry);
    out[full] = fs.readFileSync(full, "utf-8");
  }
  return out;
}

/** Create a fresh temp directory for a single test. Mirrors `tmp_path`. */
export function makeTmpPath(prefix: string = "wiki-orm-test-"): string {
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
