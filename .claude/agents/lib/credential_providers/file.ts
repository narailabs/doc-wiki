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
  private _cache: Record<string, unknown> | null = null;

  constructor(opts: FileProviderOptions) {
    this._path = opts.path;
    this._suppressWarning = opts.suppressWarning ?? false;
  }

  async getSecret(name: string): Promise<string | null> {
    return this.getSecretSync(name);
  }

  /**
   * Return the value for `name`. Two lookup strategies, in order:
   *   1. Literal top-level key — preserves the original flat
   *      `{ "<name>": "<value>" }` contract and lets users have
   *      key names that contain dots.
   *   2. Dot-path traversal — if the literal key doesn't resolve to a
   *      string, treat `name` as a path (e.g. `db-prod.username`) and
   *      walk the nested JSON. Returns null if any segment is missing
   *      or the leaf is not a string. Lets nested credential layouts
   *      (used by wiki_db's `db-<env>.username` shape) reuse the same
   *      file/mode/warning machinery.
   */
  getSecretSync(name: string): string | null {
    this._warnOnce();
    const data = this._load();
    if (data === null) return null;
    const literal = data[name];
    if (typeof literal === "string") return literal;
    if (name.includes(".")) {
      const parts = name.split(".");
      let cur: unknown = data;
      for (const part of parts) {
        if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
          return null;
        }
        cur = (cur as Record<string, unknown>)[part];
      }
      if (typeof cur === "string") return cur;
    }
    return null;
  }

  private _warnOnce(): void {
    if (this._warned || this._suppressWarning) return;
    this._warned = true;
    console.warn(
      `[credential_providers/file] reading secrets from plaintext file ${this._path}; ` +
        "consider using the keychain or cloud_secrets provider instead.",
    );
  }

  /**
   * Refuse to read the file if its mode is group- or world-accessible
   * on POSIX systems (matches the OpenSSH posture for private keys).
   * Skipped on Windows where stat().mode does not carry Unix permission
   * bits in a portable way.
   */
  private _checkFileMode(): void {
    if (process.platform === "win32") return;
    if (this._suppressWarning) return;
    const st = fs.statSync(this._path);
    const insecureBits = st.mode & 0o077;
    if (insecureBits !== 0) {
      const octal = (st.mode & 0o777).toString(8).padStart(3, "0");
      throw new Error(
        `[credential_providers/file] refusing to read ${this._path}: ` +
          `file mode ${octal} is group- or world-accessible. ` +
          `Run 'chmod 600 ${this._path}' to restrict to the owner.`,
      );
    }
  }

  /**
   * Parse the credentials JSON. Stores the raw nested structure so
   * dot-path traversal can find values inside subobjects (the wiki_db
   * `db-<env>: {username, password}` layout); literal-key lookups still
   * filter to strings in `getSecretSync`.
   */
  private _load(): Record<string, unknown> | null {
    if (this._cache !== null) return this._cache;
    if (!fs.existsSync(this._path)) return null;
    this._checkFileMode();
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
    this._cache = parsed as Record<string, unknown>;
    return this._cache;
  }
}
