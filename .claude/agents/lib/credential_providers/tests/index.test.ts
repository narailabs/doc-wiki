/**
 * Tests for the provider registry + resolveSecret helper.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearProviders,
  getProvider,
  listProviders,
  registerProvider,
  resolveSecret,
  type CredentialProvider,
} from "../index.js";

function makeProvider(
  data: Record<string, string>,
  throwOn?: string,
): CredentialProvider {
  return {
    async getSecret(name: string): Promise<string | null> {
      if (throwOn !== undefined && name === throwOn) {
        throw new Error(`boom on ${name}`);
      }
      return data[name] ?? null;
    },
  };
}

describe("credential_providers/index", () => {
  beforeEach(() => {
    clearProviders();
  });

  afterEach(() => {
    clearProviders();
  });

  it("registers and retrieves providers", () => {
    const p = makeProvider({});
    registerProvider("stub", p);
    expect(getProvider("stub")).toBe(p);
    expect(listProviders()).toEqual(["stub"]);
  });

  it("clearProviders empties the registry", () => {
    registerProvider("a", makeProvider({}));
    registerProvider("b", makeProvider({}));
    clearProviders();
    expect(listProviders()).toEqual([]);
  });

  it("resolveSecret returns the primary provider hit", async () => {
    registerProvider("primary", makeProvider({ foo: "1" }));
    registerProvider("secondary", makeProvider({ foo: "2" }));
    const value = await resolveSecret("foo", { provider: "primary" });
    expect(value).toBe("1");
  });

  it("resolveSecret falls back through the chain", async () => {
    registerProvider("primary", makeProvider({}));
    registerProvider("secondary", makeProvider({ foo: "from-secondary" }));
    const value = await resolveSecret("foo", {
      provider: "primary",
      fallback: ["secondary"],
    });
    expect(value).toBe("from-secondary");
  });

  it("resolveSecret returns null when every provider misses", async () => {
    registerProvider("a", makeProvider({}));
    registerProvider("b", makeProvider({}));
    expect(
      await resolveSecret("foo", { provider: "a", fallback: ["b"] }),
    ).toBeNull();
  });

  it("resolveSecret ignores thrown errors and keeps searching", async () => {
    registerProvider("broken", makeProvider({}, "foo"));
    registerProvider("good", makeProvider({ foo: "value" }));
    const value = await resolveSecret("foo", {
      provider: "broken",
      fallback: ["good"],
    });
    expect(value).toBe("value");
  });

  it("resolveSecret surfaces the last error if every provider throws", async () => {
    registerProvider("a", makeProvider({}, "foo"));
    registerProvider("b", makeProvider({}, "foo"));
    await expect(
      resolveSecret("foo", { provider: "a", fallback: ["b"] }),
    ).rejects.toThrow(/boom/);
  });

  it("resolveSecret with no provider specified iterates the registry", async () => {
    registerProvider("a", makeProvider({}));
    registerProvider("b", makeProvider({ foo: "b-val" }));
    expect(await resolveSecret("foo")).toBe("b-val");
  });

  it("skips unknown provider names gracefully", async () => {
    registerProvider("good", makeProvider({ foo: "v" }));
    const value = await resolveSecret("foo", {
      provider: "missing",
      fallback: ["good"],
    });
    expect(value).toBe("v");
  });
});
