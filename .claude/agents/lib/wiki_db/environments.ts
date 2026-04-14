/**
 * environments.ts — Environment configuration registry for wiki_db.
 *
 * Mirrors `environments.py`:
 *  - `EnvironmentConfig` is an immutable plain object (frozen).
 *  - `registerEnvironment` / `getEnvironment` / `listEnvironments` /
 *    `clearEnvironments` operate on a module-level `Map`.
 *
 * Note: Python uses hyphenated approval modes for the environment layer
 * (`confirm-once`, not `confirm_once`). This matches the existing Python
 * tests, which assert on the hyphenated form. The Policy class continues
 * to accept underscores only; the env layer is purely metadata.
 */

/** Valid approval modes for env registration (hyphenated, per Python). */
const _VALID_APPROVAL_MODES: ReadonlySet<string> = new Set([
  "auto", "confirm-once", "confirm-each", "grant-required",
]);

/** Immutable configuration for a database environment. */
export interface EnvironmentConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly schema: string;
  readonly approval_mode: string;
  readonly driver: string;
  /**
   * Duration of a read grant issued via `grant-required` approval mode,
   * in hours. Consumed by `grantFromEnv()` in policy.ts. Per v2 design §4,
   * the default is 8 hours; callers may override per-environment.
   */
  readonly grant_duration_hours?: number;
}

const _registry: Map<string, EnvironmentConfig> = new Map();

export interface RegisterEnvironmentOptions {
  host: string;
  port: number;
  database: string;
  schema?: string;
  approval_mode?: string;
  driver?: string;
  grant_duration_hours?: number;
}

/** Register a named environment configuration. */
export function registerEnvironment(
  name: string,
  opts: RegisterEnvironmentOptions,
): void {
  const {
    host,
    port,
    database,
    schema = "public",
    approval_mode = "auto",
    driver = "postgresql",
    grant_duration_hours,
  } = opts;
  if (!_VALID_APPROVAL_MODES.has(approval_mode)) {
    // Python sorts the frozenset; mirror that for parity with pytest-match.
    const sorted = [..._VALID_APPROVAL_MODES].sort();
    const sortedRepr = "[" + sorted.map((s) => `'${s}'`).join(", ") + "]";
    throw new Error(
      `approval_mode must be one of ${sortedRepr}, got '${approval_mode}'`,
    );
  }
  const base = { host, port, database, schema, approval_mode, driver };
  const cfg: EnvironmentConfig = Object.freeze(
    grant_duration_hours === undefined
      ? base
      : { ...base, grant_duration_hours },
  );
  _registry.set(name, cfg);
}

/** Return the config for `name`, or throw a KeyError-named Error. */
export function getEnvironment(name: string): EnvironmentConfig {
  const cfg = _registry.get(name);
  if (cfg === undefined) {
    const err = new Error(`'${name}'`);
    err.name = "KeyError";
    throw err;
  }
  return cfg;
}

/** Return a list of registered environment names. */
export function listEnvironments(): string[] {
  return [..._registry.keys()];
}

/** Remove all registered environments. */
export function clearEnvironments(): void {
  _registry.clear();
}
