/**
 * _optional.ts — shared helpers for graceful degradation when an optional
 * dependency is missing.
 *
 * Two primitives:
 *   - `importOptional(modName, installName?)`: wrap a dynamic `import(x)` so
 *     an unresolvable module raises a user-friendly `Error` naming the
 *     npm package and the exact install command, matching the Python
 *     reference's `ImportError` style. Promoted from `extract_binary.ts`
 *     so `extract_multimodal.ts` can reuse it.
 *   - `isBinaryOnPath(binaryName)`: probe `PATH` for an external CLI tool
 *     (e.g. `faster-whisper`, `yt-dlp`) by running `<bin> --version` via
 *     `spawnSync` and returning whether the exit code was 0. Suppresses
 *     stdio, safe to call in hot paths. Backbone of the multimodal
 *     feature flag (`multimodal.enabled: optional`) — callers surface a
 *     warning when this returns false instead of erroring out.
 */
import { spawnSync } from "node:child_process";

// ── Optional-dep loader ────────────────────────────────────────────

/**
 * Wrap a dynamic `import(modName)` so that `ERR_MODULE_NOT_FOUND` (and the
 * older CommonJS `MODULE_NOT_FOUND`) becomes a friendly error matching the
 * Python `ImportError` style: the user sees the package name and the exact
 * `npm install` command needed.
 *
 * Anything other than a not-found error is rethrown unchanged — we don't
 * want to swallow real import failures (syntax errors, etc.).
 */
export async function importOptional<T>(
  modName: string,
  installName?: string,
): Promise<T> {
  try {
    return (await import(modName)) as T;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const msg = typeof err.message === "string" ? err.message : "";
    // Match both Node's native loader (`ERR_MODULE_NOT_FOUND`) and
    // Vitest/Vite's loader (message-shaped errors). Real syntax errors
    // from inside a resolved module produce `SyntaxError` (name), which
    // we intentionally do NOT rewrite — rewriting would hide user bugs.
    const notFound =
      err.code === "ERR_MODULE_NOT_FOUND" ||
      err.code === "MODULE_NOT_FOUND" ||
      (err.name !== "SyntaxError" && (
        msg.includes("Failed to load url") ||
        msg.includes("Cannot find module") ||
        msg.includes("Cannot find package") ||
        msg.includes("does not provide an export")
      ));
    if (notFound) {
      const pkgName =
        installName ??
        (modName.startsWith("@")
          ? modName.split("/").slice(0, 2).join("/")
          : (modName.split("/")[0] ?? modName));
      throw new Error(
        `Missing optional dependency '${pkgName}'. Install with: npm install ${pkgName}`,
      );
    }
    throw e;
  }
}

// ── PATH probing ────────────────────────────────────────────────────

/**
 * Return true when `binaryName` is resolvable on `PATH` (i.e. the user's
 * shell could run it). Implementation: invoke `<binaryName> --version`
 * via `spawnSync` with stdio suppressed.
 *
 * `spawnSync` returns an object with:
 *   - `error` populated when the binary isn't found (ENOENT).
 *   - `status` set when the binary ran (even if `--version` isn't a real
 *     flag — we only care that the process launched, not its exit code).
 *
 * So presence = no error AND status is a number. Non-zero statuses still
 * count as "present" because some legacy tools use `--version` for help.
 *
 * Never throws. Caches the result per binary name for the lifetime of
 * the Node process (PATH doesn't change mid-run).
 */
const _probeCache = new Map<string, boolean>();

export function isBinaryOnPath(binaryName: string): boolean {
  const cached = _probeCache.get(binaryName);
  if (cached !== undefined) return cached;

  const result = spawnSync(binaryName, ["--version"], {
    stdio: "ignore",
    // Guard against a binary that hangs on --version: cap at 5s.
    timeout: 5_000,
  });
  // spawnSync returns `error` set when the binary isn't found (ENOENT),
  // or a non-null `status` / `signal` when it ran.
  const present = result.error === undefined || result.error === null
    ? result.status !== null || result.signal !== null
    : false;
  _probeCache.set(binaryName, present);
  return present;
}

/** Test helper — wipe the PATH probe cache between tests. */
export function _resetBinaryProbeCache(): void {
  _probeCache.clear();
}
