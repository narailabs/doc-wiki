/**
 * Shared fixtures for wiki skill script tests.
 *
 * This is the TypeScript port of conftest.py. Fixtures are exposed as plain
 * helper functions that Vitest tests can invoke inside beforeEach/beforeAll,
 * instead of as pytest's magic function-name auto-wiring.
 *
 * Only the fixtures needed for security_check and parse_config tests are
 * ported in Phase 1. More will be added in later phases.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";

/** Resolve the absolute path to the scripts directory (parent of tests/).
 *  Compiled .js files sit next to their .ts siblings, so the same path
 *  works for both source imports and CLI invocations. */
export const SCRIPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

/**
 * Create a fresh temp directory for a single test and return its path.
 * Analogous to pytest's built-in `tmp_path` fixture.
 */
export function makeTmpPath(prefix: string = "wiki-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Remove a temp directory (best-effort). Safe to call on nonexistent paths.
 */
export function cleanupTmpPath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Return the path to a temp file containing a dumped YAML config.
 * Mirrors the per-test `valid_config_yaml`/`minimal_config_yaml` fixtures
 * in test_parse_config.py.
 */
export function writeConfigYaml(
  tmpPath: string,
  config: Record<string, unknown>,
  filename: string = "wiki.config.yaml",
): string {
  const p = path.join(tmpPath, filename);
  fs.writeFileSync(p, yaml.dump(config));
  return p;
}

/**
 * Create a fresh, empty edges.jsonl inside `tmpPath` and return its path.
 * Mirrors the `edges_file` pytest fixture.
 */
export function makeEmptyEdgesFile(tmpPath: string): string {
  const p = path.join(tmpPath, "edges.jsonl");
  fs.writeFileSync(p, "");
  return p;
}

/**
 * Populate an edges.jsonl at `tmpPath/edges.jsonl` with the small fixture
 * graph used by graph_ops tests, and return its path. Mirrors the
 * `populated_edges` pytest fixture.
 *
 * Topology:
 *   A -> B -> C -> D
 *   A -> E -> D
 *   E -> F
 */
export function makePopulatedEdgesFile(tmpPath: string): string {
  const edges = [
    { from: "A", to: "B", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "B", to: "C", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "C", to: "D", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "A", to: "E", type: "supports", provenance: "INFERRED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "E", to: "D", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "E", to: "F", type: "contradicts", provenance: "AMBIGUOUS",
      evidence: "", source_file: "", date: "2026-04-10" },
  ];
  const p = path.join(tmpPath, "edges.jsonl");
  fs.writeFileSync(
    p,
    edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  return p;
}
