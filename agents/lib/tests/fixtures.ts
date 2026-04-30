/**
 * Shared fixtures for tests in agents/lib/tests/.
 *
 * Mirrors the helper subset used by the moved security_check and
 * parse_config tests. Kept minimal — additional helpers should live
 * next to the test that needs them unless they're genuinely shared.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

/** Absolute path to agents/lib/ (parent of this tests/ folder). */
export const SCRIPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Create a fresh temp directory and return its path. */
export function makeTmpPath(prefix: string = "agents-lib-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Best-effort recursive remove of a temp directory. */
export function cleanupTmpPath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Dump a YAML config to <tmpPath>/<filename> and return the path. */
export function writeConfigYaml(
  tmpPath: string,
  config: Record<string, unknown>,
  filename: string = "wiki.config.yaml",
): string {
  const p = path.join(tmpPath, filename);
  fs.writeFileSync(p, yaml.dump(config));
  return p;
}
