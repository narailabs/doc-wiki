/**
 * credentials.ts — Credential providers for wiki_db.
 *
 * Mirrors `credentials.py`:
 *  - `FileCredentialProvider`  reads a JSON file keyed by `db-<env>`.
 *  - `EnvVarCredentialProvider` reads `WIKI_DB_<ENV>_USER` / `..._PASSWORD`.
 *  - `getCredentials(env, {provider, config})` is the convenience dispatcher.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
 */
export class FileCredentialProvider extends CredentialProvider {
  private readonly _path: string;

  constructor(filePath: string) {
    super();
    this._path = filePath;
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
    const raw = fs.readFileSync(this._path, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const key = `db-${env}`;
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      // Python repr: single-quoted.
      const err = new Error(
        `No credentials found for environment '${env}' (key '${key}')`,
      );
      err.name = "KeyError";
      throw err;
    }
    const entry = data[key] as { username: string; password: string };
    return [entry.username, entry.password];
  }
}

/**
 * Read credentials from `WIKI_DB_{ENV}_USER` / `WIKI_DB_{ENV}_PASSWORD`.
 */
export class EnvVarCredentialProvider extends CredentialProvider {
  override get(env: string): [string, string] {
    const envUpper = env.toUpperCase();
    const userVar = `WIKI_DB_${envUpper}_USER`;
    const passVar = `WIKI_DB_${envUpper}_PASSWORD`;
    const user = process.env[userVar];
    const password = process.env[passVar];
    if (user === undefined || password === undefined) {
      const missing: string[] = [];
      for (const v of [userVar, passVar]) {
        if (process.env[v] === undefined) missing.push(v);
      }
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
