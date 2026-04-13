/**
 * env_var.ts — `process.env` credential provider.
 *
 * Lookup strategy:
 *  1. Try the secret name verbatim (e.g. `GITHUB_TOKEN`).
 *  2. If that misses, normalize: uppercase and replace every non-[A-Za-z0-9]
 *     run with a single underscore (e.g. `github.token` → `GITHUB_TOKEN`).
 *
 * The optional `prefix` lets callers scope a family of secrets (wiki_db's
 * existing `WIKI_DB_` + `<ENV>_USER/_PASSWORD` pattern is implemented on
 * top of this class in `wiki_db/credentials.ts`).
 */
import type { CredentialProvider } from "./index.js";

export interface EnvVarProviderOptions {
  /** Optional prefix applied to the normalized name. */
  prefix?: string;
}

export class EnvVarProvider implements CredentialProvider {
  private readonly _prefix: string;

  constructor(opts: EnvVarProviderOptions = {}) {
    this._prefix = opts.prefix ?? "";
  }

  async getSecret(name: string): Promise<string | null> {
    return this.getSecretSync(name);
  }

  getSecretSync(name: string): string | null {
    const literal = process.env[name];
    if (literal !== undefined && literal !== "") return literal;

    const normalized = this._prefix + _normalize(name);
    const value = process.env[normalized];
    if (value !== undefined && value !== "") return value;
    return null;
  }
}

function _normalize(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}
