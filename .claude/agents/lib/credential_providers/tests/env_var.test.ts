/**
 * Tests for EnvVarProvider.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvVarProvider } from "../env_var.js";

describe("credential_providers/env_var", () => {
  const saved: Record<string, string | undefined> = {};

  function setEnv(k: string, v: string | undefined): void {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  beforeEach(() => {
    for (const k of Object.keys(saved)) delete saved[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("finds a literal match", async () => {
    setEnv("GITHUB_TOKEN", "ghp_xyz");
    const p = new EnvVarProvider();
    expect(await p.getSecret("GITHUB_TOKEN")).toBe("ghp_xyz");
  });

  it("normalizes to upper-snake-case", async () => {
    setEnv("GITHUB_TOKEN", "ghp_abc");
    const p = new EnvVarProvider();
    expect(await p.getSecret("github.token")).toBe("ghp_abc");
    expect(await p.getSecret("github-token")).toBe("ghp_abc");
    expect(await p.getSecret("Github Token")).toBe("ghp_abc");
  });

  it("returns null when nothing matches", async () => {
    setEnv("PRESENT_VAR", "x");
    setEnv("ABSENT_VAR", undefined);
    const p = new EnvVarProvider();
    expect(await p.getSecret("absent-var")).toBeNull();
  });

  it("treats empty string as a miss", async () => {
    setEnv("EMPTY_VAR", "");
    const p = new EnvVarProvider();
    expect(await p.getSecret("empty-var")).toBeNull();
  });

  it("honors prefix when provided", async () => {
    setEnv("WIKI_DB_DEV_USER", "admin");
    const p = new EnvVarProvider({ prefix: "WIKI_DB_" });
    expect(await p.getSecret("dev_user")).toBe("admin");
  });

  it("getSecretSync returns without await", () => {
    setEnv("PLAIN", "v");
    const p = new EnvVarProvider();
    expect(p.getSecretSync("plain")).toBe("v");
    expect(p.getSecretSync("absent")).toBeNull();
  });
});
