/**
 * Tests for FileProvider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { FileProvider } from "../file.js";

describe("credential_providers/file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-file-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("reads a secret from a JSON file", async () => {
    const p = path.join(tmpDir, "secrets.json");
    fs.writeFileSync(p, JSON.stringify({ github_token: "ghp_abc" }));
    const provider = new FileProvider({ path: p, suppressWarning: true });
    expect(await provider.getSecret("github_token")).toBe("ghp_abc");
  });

  it("returns null on missing secret", async () => {
    const p = path.join(tmpDir, "secrets.json");
    fs.writeFileSync(p, JSON.stringify({ a: "1" }));
    const provider = new FileProvider({ path: p, suppressWarning: true });
    expect(await provider.getSecret("missing")).toBeNull();
  });

  it("returns null when the file does not exist", async () => {
    const provider = new FileProvider({
      path: path.join(tmpDir, "nope.json"),
      suppressWarning: true,
    });
    expect(await provider.getSecret("anything")).toBeNull();
  });

  it("throws on non-object JSON", async () => {
    const p = path.join(tmpDir, "secrets.json");
    fs.writeFileSync(p, JSON.stringify(["not", "an", "object"]));
    const provider = new FileProvider({ path: p, suppressWarning: true });
    await expect(provider.getSecret("k")).rejects.toThrow(/JSON object/);
  });

  it("warns once (not every call) when unsuppressed", async () => {
    const p = path.join(tmpDir, "secrets.json");
    fs.writeFileSync(p, JSON.stringify({ x: "1" }));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new FileProvider({ path: p });
    await provider.getSecret("x");
    await provider.getSecret("x");
    await provider.getSecret("missing");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("getSecretSync mirrors getSecret", () => {
    const p = path.join(tmpDir, "secrets.json");
    fs.writeFileSync(p, JSON.stringify({ sync_key: "sync_val" }));
    const provider = new FileProvider({ path: p, suppressWarning: true });
    expect(provider.getSecretSync("sync_key")).toBe("sync_val");
    expect(provider.getSecretSync("missing")).toBeNull();
  });

  it("ignores non-string values", async () => {
    const p = path.join(tmpDir, "secrets.json");
    fs.writeFileSync(
      p,
      JSON.stringify({ strval: "ok", numval: 42, nested: { a: 1 } }),
    );
    const provider = new FileProvider({ path: p, suppressWarning: true });
    expect(await provider.getSecret("strval")).toBe("ok");
    expect(await provider.getSecret("numval")).toBeNull();
    expect(await provider.getSecret("nested")).toBeNull();
  });
});
