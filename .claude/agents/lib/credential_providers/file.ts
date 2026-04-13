/**
 * file.ts — Plaintext secrets file credential provider.
 *
 * Reads a JSON file shaped like `{ "<secret-name>": "<value>", ... }`.
 * Emits a single `console.warn` on first use to flag that secrets are
 * stored in cleartext. Callers that need at-rest encryption should switch
 * to the `cloud_secrets` or `keychain` provider.
 *
 * Future enhancement: support age/sops-encrypted files. For now the
 * warning makes the trade-off explicit.
 */
import * as fs from "node:fs";
import type { CredentialProvider } from "./index.js";

export interface FileProviderOptions {
  /** Absolute path to the JSON secrets file. */
  path: string;
  /**
   * Suppress the plaintext-warning (for tests). Production callers should
   * leave this at its default.
   */
  suppressWarning?: boolean;
}

export class FileProvider implements CredentialProvider {
  private readonly _path: string;
  private readonly _suppressWarning: boolean;
  private _warned = false;
  private _cache: Record<string, string> | null = null;

  constructor(opts: FileProviderOptions) {
    this._path = opts.path;
    this._suppressWarning = opts.suppressWarning ?? false;
  }

  async getSecret(name: string): Promise<string | null> {
    return this.getSecretSync(name);
  }

  getSecretSync(name: string): string | null {
    this._warnOnce();
    const data = this._load();
    if (data === null) return null;
    const value = data[name];
    return value === undefined ? null : value;
  }

  private _warnOnce(): void {
    if (this._warned || this._suppressWarning) return;
    this._warned = true;
    console.warn(
      `[credential_providers/file] reading secrets from plaintext file ${this._path}; ` +
        "consider using the keychain or cloud_secrets provider instead.",
    );
  }

  private _load(): Record<string, string> | null {
    if (this._cache !== null) return this._cache;
    if (!fs.existsSync(this._path)) return null;
    const raw = fs.readFileSync(this._path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        `file provider: ${this._path} did not contain a JSON object`,
      );
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      out[k] = v;
    }
    this._cache = out;
    return out;
  }
}
