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

import { FileProvider } from "../credential_providers/file.js";
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
export abstract class CredentialProvider {
  /** Return `[username, password]` for the given environment. */
  abstract get(env: string): [string, string];
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
 * Delegates the actual file reading to `credential_providers/FileProvider`
 * so the file-mode safety check (refuses 0644+ on POSIX) and plaintext
 * warning fire here too. Nested `db-<env>.username` / `db-<env>.password`
 * lookups are resolved by FileProvider's dot-path traversal.
 */
export class FileCredentialProvider extends CredentialProvider {
  private readonly _path: string;
  private readonly _provider: FileProvider;

  constructor(filePath: string) {
    super();
    this._path = filePath;
    this._provider = new FileProvider({ path: filePath });
  }

  override get(env: string): [string, string] {
    if (!fs.existsSync(this._path)) {
      const err = new Error(
        `Credentials file not found: ${this._path}`,
      ) as Error & { code?: string };
      err.name = "FileNotFoundError";
      err.code = "ENOENT";
      throw err;
    }
    const key = `db-${env}`;
    const user = this._provider.getSecretSync(`${key}.username`);
    const password = this._provider.getSecretSync(`${key}.password`);
    if (user === null || password === null) {
      const err = new Error(
        `No credentials found for environment '${env}' (key '${key}')`,
      );
      err.name = "KeyError";
      throw err;
    }
    return [user, password];
  }
}

/**
 * Read credentials from `WIKI_DB_{ENV}_USER` / `WIKI_DB_{ENV}_PASSWORD`.
 *
 * Delegates to the shared `EnvVarProvider` so the env lookup logic lives
 * in a single place.
 */
export class EnvVarCredentialProvider extends CredentialProvider {
  private readonly _inner = new EnvVarProvider({ prefix: "WIKI_DB_" });

  override get(env: string): [string, string] {
    const envUpper = env.toUpperCase();
    const user = this._inner.getSecretSync(`${envUpper}_USER`);
    const password = this._inner.getSecretSync(`${envUpper}_PASSWORD`);
    if (user === null || password === null) {
      const missing: string[] = [];
      if (user === null) missing.push(`WIKI_DB_${envUpper}_USER`);
      if (password === null) missing.push(`WIKI_DB_${envUpper}_PASSWORD`);
      const err = new Error(
        `Missing environment variable(s): ${missing.join(", ")}`,
      );
      err.name = "EnvironmentError";
      throw err;
    }
    return [user, password];
  }
}

export interface GetCredentialsOptions {
  /** Either "file" (default) or "env". */
  provider?: "file" | "env";
  /** Path override for the file provider. */
  config?: string | null;
}

/**
 * Convenience function to fetch credentials.
 *
 * @param env       Environment name (e.g. "dev", "prod").
 * @param options.provider  "file" (default) or "env".
 * @param options.config    Path override for the file provider.
 */
export function getCredentials(
  env: string,
  options: GetCredentialsOptions = {},
): [string, string] {
  const provider = options.provider ?? "file";
  const config = options.config ?? null;

  if (provider === "env") {
    return new EnvVarCredentialProvider().get(env);
  }
  // default: file
  const p = config !== null ? config : _DEFAULT_CREDS.path;
  return new FileCredentialProvider(p).get(env);
}
