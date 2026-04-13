/**
 * credentials.ts — Credential providers for wiki_db.
 *
 * Thin compatibility shim: the legacy `FileCredentialProvider` /
 * `EnvVarCredentialProvider` / `getCredentials()` surface is retained
 * (imported by `connection.ts` and the Phase E drivers arriving later),
 * but the implementations now delegate to the new
 * `lib/credential_providers/` package.
 *
 * Contract:
 *  - `FileCredentialProvider` reads a JSON file keyed by `db-<env>`.
 *  - `EnvVarCredentialProvider` reads `WIKI_DB_<ENV>_USER` / `..._PASSWORD`.
 *  - `getCredentials(env, {provider, config})` is the convenience dispatcher.
 *
 * The return type is `[string, string]` (username, password) — unchanged
 * from the Python port so existing tests pass verbatim.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EnvVarProvider } from "../credential_providers/env_var.js";
/**
 * Default credentials file location — `~/.config/wiki_db/credentials.json`.
 * Exported as a mutable object wrapper so tests can monkeypatch it at
 * runtime (Python tests use `monkeypatch.setattr` on the module-level
 * `_DEFAULT_CREDS_PATH`). Direct reassignment of the exported name would
 * not work in strict-ESM, so we expose `.path` instead.
 */
export const _DEFAULT_CREDS = {
    path: path.join(os.homedir(), ".config", "wiki_db", "credentials.json"),
};
/** Abstract base class — mirrors Python's ABC + `@abstractmethod`. */
export class CredentialProvider {
}
/**
 * Read credentials from a JSON file.
 *
 * Expected format:
 *   {
 *     "db-<env>": {"username": "...", "password": "..."},
 *     ...
 *   }
 *
 * Implementation note: the new `credential_providers/FileProvider` stores
 * flat `name → value` pairs; the wiki_db file format nests
 * `username`/`password` under `db-<env>`. So we still do the JSON parse
 * ourselves here rather than routing through `FileProvider`.
 */
export class FileCredentialProvider extends CredentialProvider {
    _path;
    constructor(filePath) {
        super();
        this._path = filePath;
    }
    get(env) {
        if (!fs.existsSync(this._path)) {
            const err = new Error(`Credentials file not found: ${this._path}`);
            err.name = "FileNotFoundError";
            err.code = "ENOENT";
            throw err;
        }
        const raw = fs.readFileSync(this._path, "utf-8");
        const data = JSON.parse(raw);
        const key = `db-${env}`;
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
            // Python repr: single-quoted.
            const err = new Error(`No credentials found for environment '${env}' (key '${key}')`);
            err.name = "KeyError";
            throw err;
        }
        const entry = data[key];
        return [entry.username, entry.password];
    }
}
/**
 * Read credentials from `WIKI_DB_{ENV}_USER` / `WIKI_DB_{ENV}_PASSWORD`.
 *
 * Delegates to the shared `EnvVarProvider` so the env lookup logic lives
 * in a single place.
 */
export class EnvVarCredentialProvider extends CredentialProvider {
    _inner = new EnvVarProvider({ prefix: "WIKI_DB_" });
    get(env) {
        const envUpper = env.toUpperCase();
        const user = this._inner.getSecretSync(`${envUpper}_USER`);
        const password = this._inner.getSecretSync(`${envUpper}_PASSWORD`);
        if (user === null || password === null) {
            const missing = [];
            if (user === null)
                missing.push(`WIKI_DB_${envUpper}_USER`);
            if (password === null)
                missing.push(`WIKI_DB_${envUpper}_PASSWORD`);
            const err = new Error(`Missing environment variable(s): ${missing.join(", ")}`);
            err.name = "EnvironmentError";
            throw err;
        }
        return [user, password];
    }
}
/**
 * Convenience function to fetch credentials.
 *
 * @param env       Environment name (e.g. "dev", "prod").
 * @param options.provider  "file" (default) or "env".
 * @param options.config    Path override for the file provider.
 */
export function getCredentials(env, options = {}) {
    const provider = options.provider ?? "file";
    const config = options.config ?? null;
    if (provider === "env") {
        return new EnvVarCredentialProvider().get(env);
    }
    // default: file
    const p = config !== null ? config : _DEFAULT_CREDS.path;
    return new FileCredentialProvider(p).get(env);
}
