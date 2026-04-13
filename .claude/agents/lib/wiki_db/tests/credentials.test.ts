/**
 * Tests for credentials.ts — ported 1:1 from `test_credentials.py`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";

import {
  _DEFAULT_CREDS,
  EnvVarCredentialProvider,
  FileCredentialProvider,
  getCredentials,
} from "../credentials.js";
import {
  cleanupTmpPath,
  makeTmpPath,
  patchEnv,
  writeCredsFile,
} from "./fixtures.js";

describe("wiki_db.credentials", () => {
  let tmpPath: string;
  let restoreEnv: (() => void) | null = null;

  beforeEach(() => {
    tmpPath = makeTmpPath("wiki-db-creds-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
    if (restoreEnv) {
      restoreEnv();
      restoreEnv = null;
    }
  });

  // ---------- 1. file_provider_reads_json ----------
  it("test_file_provider_reads_json", () => {
    const credsFile = path.join(tmpPath, "creds.json");
    writeCredsFile(credsFile, {
      "db-dev": { username: "admin", password: "s3cret" },
    });
    const provider = new FileCredentialProvider(credsFile);
    const [user, pw] = provider.get("dev");
    expect(user).toBe("admin");
    expect(pw).toBe("s3cret");
  });

  // ---------- 2. file_provider_returns_tuple ----------
  it("test_file_provider_returns_tuple", () => {
    const credsFile = path.join(tmpPath, "creds.json");
    writeCredsFile(credsFile, {
      "db-dev": { username: "u", password: "p" },
    });
    const provider = new FileCredentialProvider(credsFile);
    const result = provider.get("dev");
    // Python returns a 2-tuple; TS returns a [string, string] array.
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });

  // ---------- 3. file_provider_missing_file ----------
  it("test_file_provider_missing_file", () => {
    const provider = new FileCredentialProvider("/no/such/file.json");
    expect(() => provider.get("dev")).toThrow(/Credentials file not found/);
  });

  // ---------- 4. file_provider_missing_key ----------
  it("test_file_provider_missing_key", () => {
    const credsFile = path.join(tmpPath, "creds.json");
    writeCredsFile(credsFile, {
      "db-dev": { username: "u", password: "p" },
    });
    const provider = new FileCredentialProvider(credsFile);
    try {
      provider.get("staging");
      throw new Error("expected KeyError to be thrown");
    } catch (e) {
      expect((e as Error).name).toBe("KeyError");
    }
  });

  // ---------- 5. file_provider_per_env_keys ----------
  it("test_file_provider_per_env_keys", () => {
    const credsFile = path.join(tmpPath, "creds.json");
    writeCredsFile(credsFile, {
      "db-dev": { username: "dev_user", password: "dev_pw" },
      "db-prod": { username: "prod_user", password: "prod_pw" },
    });
    const provider = new FileCredentialProvider(credsFile);
    expect(provider.get("dev")).toEqual(["dev_user", "dev_pw"]);
    expect(provider.get("prod")).toEqual(["prod_user", "prod_pw"]);
  });

  // ---------- 6. env_var_provider ----------
  it("test_env_var_provider", () => {
    restoreEnv = patchEnv({
      WIKI_DB_DEV_USER: "env_user",
      WIKI_DB_DEV_PASSWORD: "env_pass",
    });
    const provider = new EnvVarCredentialProvider();
    expect(provider.get("dev")).toEqual(["env_user", "env_pass"]);
  });

  // ---------- 7. env_var_missing_var ----------
  it("test_env_var_missing_var", () => {
    restoreEnv = patchEnv({
      WIKI_DB_DEV_USER: undefined,
      WIKI_DB_DEV_PASSWORD: undefined,
    });
    const provider = new EnvVarCredentialProvider();
    try {
      provider.get("dev");
      throw new Error("expected EnvironmentError to be thrown");
    } catch (e) {
      // Python raises EnvironmentError, we label it similarly.
      expect((e as Error).name).toBe("EnvironmentError");
    }
  });

  // ---------- 8. get_credentials_dispatches ----------
  it("test_get_credentials_dispatches", () => {
    restoreEnv = patchEnv({
      WIKI_DB_CI_USER: "ci_u",
      WIKI_DB_CI_PASSWORD: "ci_p",
    });
    const [user, pw] = getCredentials("ci", { provider: "env" });
    expect([user, pw]).toEqual(["ci_u", "ci_p"]);
  });

  // ---------- 9. default_provider_is_file ----------
  it("test_default_provider_is_file", () => {
    const credsFile = path.join(tmpPath, "creds.json");
    writeCredsFile(credsFile, {
      "db-local": { username: "loc_u", password: "loc_p" },
    });
    const prior = _DEFAULT_CREDS.path;
    _DEFAULT_CREDS.path = credsFile;
    try {
      const [user, pw] = getCredentials("local");
      expect([user, pw]).toEqual(["loc_u", "loc_p"]);
    } finally {
      _DEFAULT_CREDS.path = prior;
    }
  });
});
