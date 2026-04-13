/**
 * keychain.ts — OS-native keychain provider.
 *
 * Backends (selected by platform):
 *   - darwin  → `security find-generic-password -s "<name>" -w`
 *   - linux   → `secret-tool lookup name "<name>"` (libsecret).
 *               If `secret-tool` is missing, throws a clear error.
 *   - win32   → unsupported (throws). Windows Credential Manager would
 *               require a different shell-out (`cmdkey`) or a native
 *               binding; intentionally out of scope for this phase.
 */
import { execFileSync } from "node:child_process";
import type { CredentialProvider } from "./index.js";

export interface KeychainProviderOptions {
  /**
   * Override the platform detection (for tests). Accepts any Node
   * `process.platform` value.
   */
  platform?: NodeJS.Platform;
  /**
   * macOS Keychain "account" field (optional). If given, passed as
   * `-a <account>` to `security find-generic-password`.
   */
  account?: string;
  /**
   * macOS Keychain "service" prefix. If set, the lookup name is
   * `<servicePrefix>.<name>` so wiki_db secrets can be grouped under a
   * single service name (e.g. `com.doc-wiki`).
   */
  servicePrefix?: string;
}

export class KeychainProvider implements CredentialProvider {
  private readonly _platform: NodeJS.Platform;
  private readonly _account: string | undefined;
  private readonly _servicePrefix: string;

  constructor(opts: KeychainProviderOptions = {}) {
    this._platform = opts.platform ?? process.platform;
    this._account = opts.account;
    this._servicePrefix = opts.servicePrefix ?? "";
  }

  async getSecret(name: string): Promise<string | null> {
    return this.getSecretSync(name);
  }

  getSecretSync(name: string): string | null {
    const service = this._servicePrefix
      ? `${this._servicePrefix}.${name}`
      : name;

    switch (this._platform) {
      case "darwin":
        return this._macos(service);
      case "linux":
        return this._linux(service);
      case "win32":
        throw new Error("keychain provider unsupported on Windows");
      default:
        throw new Error(
          `keychain provider unsupported on platform '${this._platform}'`,
        );
    }
  }

  private _macos(service: string): string | null {
    const args = ["find-generic-password", "-s", service, "-w"];
    if (this._account) {
      args.splice(1, 0, "-a", this._account);
    }
    try {
      const out = execFileSync("security", args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const trimmed = out.replace(/\n$/, "");
      return trimmed === "" ? null : trimmed;
    } catch (err) {
      // `security` exits non-zero if the item is not found. Surface a
      // null-miss rather than an error so the fallback chain can proceed.
      if (_isMissingKeychainItem(err)) return null;
      throw _wrapKeychainError(err, "security");
    }
  }

  private _linux(service: string): string | null {
    try {
      const out = execFileSync("secret-tool", ["lookup", "name", service], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const trimmed = out.replace(/\n$/, "");
      return trimmed === "" ? null : trimmed;
    } catch (err) {
      if (_isCommandNotFound(err)) {
        throw new Error(
          "keychain provider on Linux requires `secret-tool` (libsecret). " +
            "Install with `apt install libsecret-tools` or equivalent.",
        );
      }
      if (_isMissingKeychainItem(err)) return null;
      throw _wrapKeychainError(err, "secret-tool");
    }
  }
}

// ---------------------------------------------------------------------------

interface ExecError extends Error {
  status?: number;
  code?: string;
  stderr?: Buffer | string;
}

function _isMissingKeychainItem(err: unknown): boolean {
  const e = err as ExecError;
  // macOS `security` returns 44 for "item not found"; libsecret's
  // `secret-tool lookup` returns 1 with empty stdout when missing.
  return e.status === 44 || e.status === 1;
}

function _isCommandNotFound(err: unknown): boolean {
  const e = err as ExecError;
  return e.code === "ENOENT";
}

function _wrapKeychainError(err: unknown, command: string): Error {
  const e = err as ExecError;
  const stderr =
    e.stderr instanceof Buffer ? e.stderr.toString("utf-8") : e.stderr ?? "";
  return new Error(
    `keychain provider: ${command} failed (status=${e.status}): ${stderr || e.message}`,
  );
}
