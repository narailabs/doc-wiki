/**
 * Tests for apply_config.ts — the thin helper that reads the
 * `credentials` block from `wiki.config.yaml` and registers provider
 * instances with the credential-providers registry so downstream
 * `resolveSecret()` calls work.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  applyCredentialsConfig,
  mergeCredentialsConfig,
} from "../apply_config.js";
import {
  clearProviders,
  listProviders,
  getProvider,
} from "../../../../agents/lib/credential_providers/index.js";

describe("applyCredentialsConfig", () => {
  beforeEach(() => {
    clearProviders();
  });

  it("registers the primary provider only when no fallback is given", () => {
    const registered = applyCredentialsConfig({ provider: "keychain" });
    expect(registered).toEqual(["keychain"]);
    expect(listProviders()).toEqual(["keychain"]);
    expect(getProvider("keychain")).toBeDefined();
  });

  it("registers both primary and fallback providers", () => {
    const registered = applyCredentialsConfig({
      provider: "keychain",
      fallback: ["env_var"],
    });
    expect(registered).toContain("keychain");
    expect(registered).toContain("env_var");
    expect(listProviders().sort()).toEqual(["env_var", "keychain"]);
  });

  it("respects the prefix option when building the env_var provider", () => {
    applyCredentialsConfig({ provider: "env_var", prefix: "WIKI_" });
    const provider = getProvider("env_var");
    expect(provider).toBeDefined();
    // Round-trip through a known env var that uses the prefix.
    process.env["WIKI_TEST_SECRET"] = "hello";
    expect(provider?.getSecretSync?.("test.secret")).toBe("hello");
    delete process.env["WIKI_TEST_SECRET"];
  });

  it("uses the configured file path for the file provider", () => {
    applyCredentialsConfig({
      provider: "file",
      path: "/tmp/doc-wiki-apply-config-test-does-not-exist.json",
    });
    const provider = getProvider("file");
    expect(provider).toBeDefined();
    // Non-existent file returns null miss, does not throw.
    expect(provider?.getSecretSync?.("any")).toBeNull();
  });

  it("skips cloud_secrets when sub_provider is missing", () => {
    const registered = applyCredentialsConfig({
      provider: "cloud_secrets",
    });
    expect(registered).toEqual([]);
    expect(getProvider("cloud_secrets")).toBeUndefined();
  });

  it("registers cloud_secrets when sub_provider is set", () => {
    const registered = applyCredentialsConfig({
      provider: "cloud_secrets",
      sub_provider: "aws",
      aws_region: "us-west-2",
    });
    expect(registered).toEqual(["cloud_secrets"]);
    expect(getProvider("cloud_secrets")).toBeDefined();
  });

  it("silently ignores unknown provider names (forward-compat)", () => {
    const registered = applyCredentialsConfig({
      provider: "future_provider_x",
      fallback: ["env_var"],
    });
    expect(registered).toEqual(["env_var"]);
  });

  it("is idempotent when called with the same config twice", () => {
    applyCredentialsConfig({ provider: "keychain", fallback: ["env_var"] });
    applyCredentialsConfig({ provider: "keychain", fallback: ["env_var"] });
    expect(listProviders().sort()).toEqual(["env_var", "keychain"]);
  });
});

describe("mergeCredentialsConfig", () => {
  it("returns an empty object when neither block is present", () => {
    expect(mergeCredentialsConfig({})).toEqual({});
    expect(mergeCredentialsConfig(null)).toEqual({});
    expect(mergeCredentialsConfig(undefined)).toEqual({});
  });

  it("reads from ecosystem.credentials when top-level is missing", () => {
    const merged = mergeCredentialsConfig({
      ecosystem: {
        credentials: { provider: "file", path: "/tmp/eco.json" },
      },
    });
    expect(merged.provider).toBe("file");
    expect(merged.path).toBe("/tmp/eco.json");
  });

  it("reads from top-level when ecosystem is missing", () => {
    const merged = mergeCredentialsConfig({
      credentials: { provider: "keychain", fallback: ["env_var"] },
    });
    expect(merged.provider).toBe("keychain");
    expect(merged.fallback).toEqual(["env_var"]);
  });

  it("top-level wins key-by-key when both blocks are present", () => {
    const merged = mergeCredentialsConfig({
      ecosystem: {
        credentials: {
          provider: "file",
          path: "/tmp/eco.json",
          prefix: "ECO_",
        },
      },
      credentials: {
        provider: "keychain", // overrides ecosystem
        fallback: ["env_var"], // new key from top-level
      },
    });
    expect(merged.provider).toBe("keychain");
    expect(merged.fallback).toEqual(["env_var"]);
    // ecosystem-only keys are preserved when top-level does not mention them
    expect(merged.path).toBe("/tmp/eco.json");
    expect(merged.prefix).toBe("ECO_");
  });

  it("handles non-object or array values defensively", () => {
    expect(
      mergeCredentialsConfig({ credentials: "not-an-object" as unknown }),
    ).toEqual({});
    expect(
      mergeCredentialsConfig({ credentials: [1, 2, 3] as unknown }),
    ).toEqual({});
    expect(
      mergeCredentialsConfig({
        ecosystem: { credentials: "not-an-object" },
        credentials: { provider: "keychain" },
      }),
    ).toEqual({ provider: "keychain" });
  });
});
