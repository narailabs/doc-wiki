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
const _VALID_APPROVAL_MODES = new Set([
    "auto", "confirm-once", "confirm-each", "grant-required",
]);
const _registry = new Map();
/** Register a named environment configuration. */
export function registerEnvironment(name, opts) {
    const { host, port, database, schema = "public", approval_mode = "auto", driver = "postgresql", } = opts;
    if (!_VALID_APPROVAL_MODES.has(approval_mode)) {
        // Python sorts the frozenset; mirror that for parity with pytest-match.
        const sorted = [..._VALID_APPROVAL_MODES].sort();
        const sortedRepr = "[" + sorted.map((s) => `'${s}'`).join(", ") + "]";
        throw new Error(`approval_mode must be one of ${sortedRepr}, got '${approval_mode}'`);
    }
    const cfg = Object.freeze({
        host, port, database, schema, approval_mode, driver,
    });
    _registry.set(name, cfg);
}
/** Return the config for `name`, or throw a KeyError-named Error. */
export function getEnvironment(name) {
    const cfg = _registry.get(name);
    if (cfg === undefined) {
        const err = new Error(`'${name}'`);
        err.name = "KeyError";
        throw err;
    }
    return cfg;
}
/** Return a list of registered environment names. */
export function listEnvironments() {
    return [..._registry.keys()];
}
/** Remove all registered environments. */
export function clearEnvironments() {
    _registry.clear();
}
